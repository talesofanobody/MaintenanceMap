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

export interface RestoreResult {
  safetyCopy: string;
  issues: number;
  /** Migrations the restored database was missing, and has now been brought up by. */
  migrationsApplied: number;
  /** Set when the schema could not be squared with the code. */
  schemaWarning?: string;
}

const MIGRATIONS_DIR = path.resolve(__dirname, "../../prisma/migrations");
/** Where `prisma` expects to be run from: the directory holding prisma/. */
const SERVER_ROOT = path.resolve(__dirname, "../..");

function migrationsOnDisk(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** What the database currently open says it has applied; empty when it cannot say. */
async function appliedMigrations(): Promise<Set<string>> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
    );
    return new Set(rows.map((r) => r.migration_name));
  } catch {
    return new Set();
  }
}

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
    /**
     * An archive is chosen by an admin, but it is still a file from outside.
     *
     * Escaping the staging directory is already handled, and not by us: tar
     * strips a leading "/" and refuses outright to extract a member whose name
     * contains "..", exiting non-zero — checked against GNU tar 1.35 with an
     * archive built to try it. So the two things left worth saying are that the
     * archive does not get to choose who owns what it unpacks, or what mode it
     * lands with, since this runs as root in the container.
     */
    await run("tar", ["-xzf", archive, "-C", staging, "--no-same-owner", "--no-same-permissions"]);
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
export async function applyRestore(plan: RestorePlan): Promise<RestoreResult> {
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

  /**
   * An archive carries the schema it had on the day it was taken, and the code
   * running now may have moved on. Migrations otherwise only run when the
   * container boots, so a restore could leave the database a version behind the
   * app — every query touching a column added since would fail, and the restore
   * would still have reported success. Square it here, while the safety copy
   * taken above is the newest thing on the volume.
   */
  await prisma.$connect();
  const before = await appliedMigrations();
  const onDisk = migrationsOnDisk();
  const pending = onDisk.filter((name) => !before.has(name));

  let migrationsApplied = 0;
  let schemaWarning: string | undefined;

  if (pending.length > 0) {
    await prisma.$disconnect().catch(() => {});
    try {
      await run("npx", ["prisma", "migrate", "deploy"], { cwd: SERVER_ROOT });
    } catch (err) {
      schemaWarning =
        `The data is restored, but ${pending.length} migration(s) could not be applied to it, so the ` +
        `database may be a version behind the app: ${(err as Error)?.message ?? err}`;
    }
    await prisma.$connect();
    const after = await appliedMigrations();
    migrationsApplied = onDisk.filter((name) => after.has(name) && !before.has(name)).length;
  }

  // The other direction: an archive from a newer version of the app than this one.
  // No migration can fix that, and pretending otherwise would be worse than saying so.
  const unknown = [...before].filter((name) => !onDisk.includes(name));
  if (unknown.length > 0) {
    schemaWarning =
      `This archive is from a newer version of the app than the one running (${unknown.length} migration(s) ` +
      `it knows are not in this build). Deploy the matching version before relying on it.`;
  }

  // Prove it. A restore that leaves an unreadable database has to say so now,
  // not the next time somebody opens a property.
  const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*) AS n FROM "Issue"`);

  return { safetyCopy: safety.name, issues: Number(n), migrationsApplied, schemaWarning };
}

/** A backup already sitting on the volume, by name. */
export function resolveExisting(name: string): string {
  if (!isBackupName(name)) throw new RestoreError("That is not a backup name.");
  const target = backupPath(name);
  if (!target || !fs.existsSync(target)) throw new RestoreError("There is no backup by that name.");
  if (path.dirname(target) !== BACKUP_DIR) throw new RestoreError("That is not a backup name.");
  return target;
}
