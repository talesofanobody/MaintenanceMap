import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { prisma } from "../db";
import { BACKUP_DIR, backupPath, createBackup, isBackupName } from "./backup";
import { UPLOADS_DIR } from "./upload";

const run = promisify(execFile);

/**
 * Putting a backup back.
 *
 * A backup nobody has ever restored is a backup you only think you have, so this
 * exists to be rehearsed as much as used. It is also the most destructive thing
 * in the app, so the order of operations matters more than the speed:
 *
 *   1. read the archive and check it is really one of ours, before touching anything
 *   2. take a backup of what is about to be overwritten
 *   3. swap the database and the photos into place
 *   4. reconnect and prove the restored database actually answers
 *
 * Step 4 matters because SQLite keeps state in -wal and -shm files beside the
 * database; those have to go with it or the new file is read through the old
 * write-ahead log. Reconnecting rather than restarting keeps the app up and does
 * not depend on the host choosing to bring a stopped container back.
 */

export interface RestorePlan {
  /** Where the extracted, validated contents are waiting. */
  staging: string;
  hasDatabase: boolean;
  photoCount: number;
  bytes: number;
}

export class RestoreError extends Error {}

/**
 * Where the SQLite file actually is.
 *
 * Prisma resolves a relative `file:` URL against the directory holding
 * schema.prisma, not the working directory. Getting that wrong writes the
 * restored database next to the real one and reports success — which is exactly
 * what happened the first time this was rehearsed, and the reason the drill
 * exists.
 */
function databasePath(): string {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const file = url.replace(/^file:/, "");
  if (path.isAbsolute(file)) return file;
  return path.resolve(__dirname, "../../prisma", file);
}

/** SQLite files all start with the same 16 bytes. Anything else is not a database. */
async function looksLikeSqlite(file: string): Promise<boolean> {
  const handle = await fs.promises.open(file, "r");
  try {
    const buf = Buffer.alloc(16);
    await handle.read(buf, 0, 16, 0);
    return buf.toString("latin1").startsWith("SQLite format 3");
  } finally {
    await handle.close();
  }
}

/**
 * Unpacks an archive somewhere safe and checks it before a single live file is
 * touched. Returns what was found so the caller can say so and ask again.
 */
export async function prepareRestore(archive: string): Promise<RestorePlan> {
  if (!fs.existsSync(archive)) throw new RestoreError("That backup file is not there any more.");
  const staging = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mm-restore-"));

  if (archive.endsWith(".db")) {
    // A bare database, from a machine that had no tar.
    const target = path.join(staging, "maintenancemap.db");
    await fs.promises.copyFile(archive, target);
    if (!(await looksLikeSqlite(target))) throw new RestoreError("That file is not a MaintenanceMap database.");
    const { size } = await fs.promises.stat(target);
    return { staging, hasDatabase: true, photoCount: 0, bytes: size };
  }

  try {
    // No absolute paths, no "..": only ever unpack what this app packed.
    await run("tar", ["-xzf", archive, "-C", staging]);
  } catch {
    throw new RestoreError("That archive could not be opened. It may be truncated or not a MaintenanceMap backup.");
  }

  const db = path.join(staging, "maintenancemap.db");
  if (!fs.existsSync(db)) throw new RestoreError("That archive has no database in it.");
  if (!(await looksLikeSqlite(db))) throw new RestoreError("The database inside that archive is not readable.");

  const uploads = path.join(staging, "uploads");
  const photoCount = fs.existsSync(uploads) ? (await fs.promises.readdir(uploads)).length : 0;
  const { size } = await fs.promises.stat(archive);
  return { staging, hasDatabase: true, photoCount, bytes: size };
}

/** Everything SQLite keeps beside the database, which must go with it. */
async function clearSidecars(dbFile: string): Promise<void> {
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    await fs.promises.rm(dbFile + suffix, { force: true });
  }
}

/**
 * Does the swap. Takes its own backup first, so a restore of the wrong archive is
 * itself recoverable — the mistake people actually make is restoring the right
 * file to the wrong place, or the wrong file to the right one.
 */
export async function applyRestore(plan: RestorePlan): Promise<{ safetyCopy: string; issues: number }> {
  const safety = await createBackup(new Date(), "before-restore");

  const dbFile = databasePath();
  await fs.promises.mkdir(path.dirname(dbFile), { recursive: true });

  // Release SQLite's handle so the swap lands cleanly.
  await prisma.$disconnect().catch(() => {});

  await fs.promises.copyFile(path.join(plan.staging, "maintenancemap.db"), dbFile + ".incoming");
  await clearSidecars(dbFile);
  await fs.promises.rename(dbFile + ".incoming", dbFile);

  const incomingUploads = path.join(plan.staging, "uploads");
  if (fs.existsSync(incomingUploads)) {
    const aside = `${UPLOADS_DIR}.replaced-${Date.now()}`;
    if (fs.existsSync(UPLOADS_DIR)) await fs.promises.rename(UPLOADS_DIR, aside);
    await fs.promises.cp(incomingUploads, UPLOADS_DIR, { recursive: true });
    // The photos that were there are inside the safety backup, so the copy left
    // on disk is only a convenience. Remove it rather than double the volume.
    await fs.promises.rm(aside, { recursive: true, force: true });
  }

  await fs.promises.rm(plan.staging, { recursive: true, force: true });

  // Prove it. A restore that leaves an unreadable database has to say so now,
  // not the next time somebody opens a property.
  await prisma.$connect();
  const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*) AS n FROM "Issue"`);

  return { safetyCopy: safety.name, issues: Number(n) };
}

/** A backup already sitting on the volume, by name. */
export function resolveExisting(name: string): string {
  if (!isBackupName(name)) throw new RestoreError("That is not a backup name.");
  const target = backupPath(name);
  if (!target || !fs.existsSync(target)) throw new RestoreError("There is no backup by that name.");
  if (path.dirname(target) !== BACKUP_DIR) throw new RestoreError("That is not a backup name.");
  return target;
}
