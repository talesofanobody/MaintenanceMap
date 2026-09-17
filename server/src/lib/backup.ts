import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { prisma } from "../db";

const run = promisify(execFile);

export const BACKUP_DIR = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.resolve(process.cwd(), "backups");
const UPLOADS_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.resolve(process.cwd(), "uploads");
/** How many backups to keep; older ones are deleted after each successful run. */
const KEEP = Number(process.env.BACKUP_KEEP) > 0 ? Number(process.env.BACKUP_KEEP) : 14;

export interface BackupFile {
  name: string;
  bytes: number;
  createdAt: string;
  /** True when the archive holds the photos as well as the database. */
  includesPhotos: boolean;
}

/** Only ever touch files this module created: no path traversal, no other extensions. */
export function isBackupName(name: string): boolean {
  return /^maintenancemap-\d{4}-\d{2}-\d{2}T\d{6}Z\.(tar\.gz|db)$/.test(name);
}

export function backupPath(name: string): string | null {
  if (!isBackupName(name)) return null;
  return path.join(BACKUP_DIR, name);
}

export async function listBackups(): Promise<BackupFile[]> {
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
  const names = await fs.promises.readdir(BACKUP_DIR);
  const files: BackupFile[] = [];
  for (const name of names) {
    if (!isBackupName(name)) continue;
    const stat = await fs.promises.stat(path.join(BACKUP_DIR, name));
    files.push({ name, bytes: stat.size, createdAt: stat.mtime.toISOString(), includesPhotos: name.endsWith(".tar.gz") });
  }
  return files.sort((a, b) => b.name.localeCompare(a.name));
}

function timestamp(now = new Date()): string {
  return now.toISOString().replace(/[-:]/g, "").replace("T", "T").replace(/\.\d+Z$/, "Z").replace(/^(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
}

/**
 * Takes a consistent copy of the database (SQLite's VACUUM INTO, safe while the app is
 * running) and, when tar is available, wraps it with the photo uploads in one archive.
 */
export async function createBackup(now = new Date()): Promise<BackupFile> {
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = timestamp(now);
  const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mm-backup-"));
  const snapshot = path.join(work, "maintenancemap.db");

  try {
    // Single-quote escaping keeps a path with an apostrophe from breaking the statement.
    await prisma.$executeRawUnsafe(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);

    const hasUploads = fs.existsSync(UPLOADS_DIR);
    if (hasUploads) {
      await fs.promises.symlink(UPLOADS_DIR, path.join(work, "uploads")).catch(async () => {
        // Symlinks can be unavailable; copying is slower but always works.
        await fs.promises.cp(UPLOADS_DIR, path.join(work, "uploads"), { recursive: true });
      });
    }

    const name = `maintenancemap-${stamp}.tar.gz`;
    const target = path.join(BACKUP_DIR, name);
    // Build in the work directory and move it into place: a rename is atomic, so a
    // listing or a download can never catch a half-written archive.
    const staging = path.join(work, "archive.tar.gz");
    try {
      const args = ["-czhf", staging, "-C", work, "maintenancemap.db"];
      if (hasUploads) args.push("uploads");
      await run("tar", args);
      await moveInto(staging, target);
      const stat = await fs.promises.stat(target);
      await prune();
      return { name, bytes: stat.size, createdAt: stat.mtime.toISOString(), includesPhotos: hasUploads };
    } catch {
      // No tar on this machine: keep the database copy on its own rather than nothing.
      const dbName = `maintenancemap-${stamp}.db`;
      const dbTarget = path.join(BACKUP_DIR, dbName);
      await moveInto(snapshot, dbTarget);
      await fs.promises.rm(target, { force: true });
      const stat = await fs.promises.stat(dbTarget);
      await prune();
      return { name: dbName, bytes: stat.size, createdAt: stat.mtime.toISOString(), includesPhotos: false };
    }
  } finally {
    await fs.promises.rm(work, { recursive: true, force: true });
  }
}

/** Rename when the temp directory is on the same filesystem, copy through a
 * .partial name when it isn't, so the final name only ever appears complete. */
async function moveInto(from: string, to: string): Promise<void> {
  try {
    await fs.promises.rename(from, to);
  } catch {
    const partial = `${to}.partial`;
    await fs.promises.copyFile(from, partial);
    await fs.promises.rename(partial, to);
  }
}

async function prune(): Promise<void> {
  const files = await listBackups();
  for (const file of files.slice(KEEP)) {
    await fs.promises.rm(path.join(BACKUP_DIR, file.name), { force: true });
  }
}

export async function deleteBackup(name: string): Promise<boolean> {
  const target = backupPath(name);
  if (!target || !fs.existsSync(target)) return false;
  await fs.promises.rm(target, { force: true });
  return true;
}

/** Runs one backup a day, on the first check after 02:00 local time. */
export async function maybeRunDaily(now = new Date()): Promise<BackupFile | null> {
  if (now.getHours() < 2) return null;
  const files = await listBackups();
  const today = now.toISOString().slice(0, 10);
  if (files.some((f) => f.name.includes(today))) return null;
  return createBackup(now);
}

export function startBackupSchedule(intervalMs = 60 * 60 * 1000): void {
  const tick = () =>
    maybeRunDaily()
      .then((file) => {
        if (file) console.log(`Backup written: ${file.name} (${Math.round(file.bytes / 1024)} KB)`);
      })
      .catch((err) => console.error("backup failed", err));
  setTimeout(tick, 10_000).unref();
  setInterval(tick, intervalMs).unref();
}
