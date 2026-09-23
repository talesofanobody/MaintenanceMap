import { Router } from "express";
import fs from "fs";
import multer from "multer";
import os from "os";
import path from "path";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { backupPath, createBackup, deleteBackup, listBackups, BACKUP_DIR } from "../lib/backup";
import { applyRestore, prepareRestore, resolveExisting, RestoreError } from "../lib/restore";

export const backupsRouter = Router();

// Reading, running and downloading a backup is ordinary operational work. Only
// deleting one, or restoring over the live database, is admin-only.
backupsRouter.use(requires("backup.manage"));

backupsRouter.get("/", async (_req, res) => {
  res.json({ directory: BACKUP_DIR, backups: await listBackups() });
});

backupsRouter.post("/run", async (req, res) => {
  try {
    const file = await createBackup();
    await logActivity(req, { action: "backup.created", entityType: "system", entityId: file.name, summary: `Backup created (${Math.round(file.bytes / 1024)} KB)` });
    res.status(201).json(file);
  } catch (err) {
    console.error("backup failed", err);
    res.status(500).json({ error: "Backup failed — check the server log and that the backups folder is writable." });
  }
});

backupsRouter.get("/:name", async (req, res) => {
  const target = backupPath(req.params.name);
  if (!target || !fs.existsSync(target)) return res.status(404).json({ error: "not found" });
  res.download(target, req.params.name);
});

backupsRouter.delete("/:name", requires("backup.delete"), async (req, res) => {
  const removed = await deleteBackup(req.params.name);
  if (!removed) return res.status(404).json({ error: "not found" });
  await logActivity(req, { action: "backup.deleted", entityType: "system", entityId: req.params.name, summary: `Deleted backup ${req.params.name}` });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Putting a backup back is the one action in this app that can destroy
 * everything, so it is deliberately awkward: it names what it found, it insists
 * on being told again, it copies the current state aside first, and it stops the
 * process afterwards so nothing carries on against a half-swapped database.
 */
const CONFIRM = "restore";

const acceptArchive = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(tar\.gz|tgz|db)$/i.test(file.originalname)) return cb(null, true);
    cb(new Error("Upload a .tar.gz or .db backup taken by this app."));
  },
}).single("archive");

/** Says what is inside an archive without touching anything. */
backupsRouter.post("/:name/inspect", async (req, res) => {
  try {
    const plan = await prepareRestore(resolveExisting(req.params.name));
    await fs.promises.rm(plan.staging, { recursive: true, force: true });
    res.json({ name: req.params.name, hasDatabase: plan.hasDatabase, photoCount: plan.photoCount, bytes: plan.bytes });
  } catch (err) {
    if (err instanceof RestoreError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

async function doRestore(req: any, res: any, archivePath: string, label: string) {
  if (req.body?.confirm !== CONFIRM) {
    return res.status(400).json({ error: `This replaces the whole database and every photo. Send confirm: "${CONFIRM}" to go ahead.` });
  }
  let plan;
  try {
    plan = await prepareRestore(archivePath);
  } catch (err) {
    if (err instanceof RestoreError) return res.status(400).json({ error: err.message });
    throw err;
  }

  // Written before the swap, because afterwards this log is whatever the backup
  // said it was — the record of the restore has to live in the restored data.
  await logActivity(req, {
    action: "backup.restored",
    entityType: "system",
    entityId: label,
    summary: `Restored from ${label} (${plan.photoCount} photo${plan.photoCount === 1 ? "" : "s"})`,
  });

  try {
    const { safetyCopy, issues } = await applyRestore(plan);
    res.json({
      restored: label,
      photoCount: plan.photoCount,
      issues,
      safetyCopy,
      message:
        `Restored from ${label} — ${issues} issue${issues === 1 ? "" : "s"} and ${plan.photoCount} photo${plan.photoCount === 1 ? "" : "s"}. ` +
        `What was here was saved as ${safetyCopy} first. Sessions came from the backup too, so you may need to sign in again.`,
    });
  } catch (err) {
    console.error("restore failed", err);
    // The database on disk is whatever the swap left. Stopping is the honest
    // thing: a restart re-reads it cleanly, and the safety copy is right there.
    res.status(500).json({
      error: "The restore failed part-way through. The app is stopping so it comes back on a clean read — check the log, and the safety copy in the backups folder.",
    });
    setTimeout(() => process.exit(1), 750);
  }
}

/** Restore from a backup already on the volume. */
backupsRouter.post("/:name/restore", requires("backup.restore"), async (req, res) => {
  try {
    await doRestore(req, res, resolveExisting(req.params.name), req.params.name);
  } catch (err) {
    if (err instanceof RestoreError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/** Restore from an archive uploaded from somewhere else — the off-site copy. */
backupsRouter.post("/restore", requires("backup.restore"), (req, res, next) => {
  acceptArchive(req, res, async (err: unknown) => {
    if (err) return res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
    if (!req.file) return res.status(400).json({ error: "No archive was uploaded." });
    try {
      await doRestore(req, res, req.file.path, req.file.originalname);
    } catch (e) {
      next(e);
    } finally {
      await fs.promises.rm(req.file.path, { force: true }).catch(() => {});
    }
  });
});
