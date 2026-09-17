import { Router } from "express";
import fs from "fs";
import { ADMIN_ONLY } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { backupPath, createBackup, deleteBackup, listBackups, BACKUP_DIR } from "../lib/backup";

export const backupsRouter = Router();

backupsRouter.use(ADMIN_ONLY);

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

backupsRouter.delete("/:name", async (req, res) => {
  const removed = await deleteBackup(req.params.name);
  if (!removed) return res.status(404).json({ error: "not found" });
  await logActivity(req, { action: "backup.deleted", entityType: "system", entityId: req.params.name, summary: `Deleted backup ${req.params.name}` });
  res.status(204).end();
});
