import { Router, Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs/promises";
import { prisma } from "../db";
import { upload, UPLOADS_DIR } from "../lib/upload";
import { readExif } from "../lib/exif";
import { storeImage } from "../lib/images";
import { CAN_EDIT } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";

export const photosRouter = Router();

// Technicians may only touch photos on issues assigned to them.
function mayEditIssue(req: Request, issue: { technicianId: string | null }): boolean {
  const user = req.user!;
  return user.role === "admin" || (user.role === "technician" && issue.technicianId === user.technicianId);
}

const IMMUTABLE = "private, max-age=31536000, immutable";

function acceptPhoto(req: Request, res: Response, next: NextFunction) {
  upload.single("photo")(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      return res.status(400).json({ error: message });
    }
    next();
  });
}

photosRouter.post("/", CAN_EDIT, acceptPhoto, async (req, res) => {
  const { issueId } = req.body;
  const file = req.file;

  if (!file) return res.status(400).json({ error: "photo file is required" });
  if (!issueId || typeof issueId !== "string") {
    return res.status(400).json({ error: "issueId is required" });
  }

  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue) return res.status(404).json({ error: "issue not found" });
  if (!mayEditIssue(req, issue)) return res.status(403).json({ error: "You can only add photos to issues assigned to you." });

  const exif = await readExif(file.buffer);

  let stored;
  try {
    stored = await storeImage(file.buffer, file.originalname);
  } catch (err) {
    console.error("image processing failed", err);
    return res.status(400).json({ error: "Could not read that image. Try a JPEG, PNG or HEIC photo." });
  }

  const photo = await prisma.photo.create({
    data: {
      issueId,
      filename: stored.filename,
      thumbFilename: stored.thumbFilename,
      hasGps: exif.hasGps,
      gpsLat: exif.gpsLat,
      gpsLng: exif.gpsLng,
      takenAt: exif.takenAt,
    },
  });

  await logActivity(req, { action: "photo.added", entityType: "photo", entityId: photo.id, issueId: issue.id, propertyId: issue.propertyId, summary: `Added a photo to "${issue.title}"` });
  res.status(201).json(photo);
});

photosRouter.get("/:id/file", async (req, res) => {
  const photo = await prisma.photo.findUnique({ where: { id: req.params.id } });
  if (!photo) return res.status(404).json({ error: "not found" });
  res.set("Cache-Control", IMMUTABLE);
  res.sendFile(path.join(UPLOADS_DIR, photo.filename));
});

photosRouter.get("/:id/thumb", async (req, res) => {
  const photo = await prisma.photo.findUnique({ where: { id: req.params.id } });
  if (!photo) return res.status(404).json({ error: "not found" });
  res.set("Cache-Control", IMMUTABLE);
  res.sendFile(path.join(UPLOADS_DIR, photo.thumbFilename ?? photo.filename));
});

photosRouter.delete("/:id", CAN_EDIT, async (req, res) => {
  const photo = await prisma.photo.findUnique({ where: { id: req.params.id }, include: { issue: true } });
  if (!photo) return res.status(404).json({ error: "not found" });
  // A photo still attached to a guest report goes when the report is declined or deleted,
  // so there is nothing to do here and no issue to check permission against.
  if (!photo.issue) return res.status(400).json({ error: "That photo belongs to a guest report, not an issue." });
  if (!mayEditIssue(req, photo.issue)) return res.status(403).json({ error: "You can only remove photos from issues assigned to you." });
  await prisma.photo.delete({ where: { id: req.params.id } });
  await logActivity(req, { action: "photo.removed", entityType: "photo", entityId: photo.id, issueId: photo.issueId, propertyId: photo.issue.propertyId, summary: `Removed a photo from "${photo.issue.title}"` });
  await fs.unlink(path.join(UPLOADS_DIR, photo.filename)).catch(() => {});
  if (photo.thumbFilename) {
    await fs.unlink(path.join(UPLOADS_DIR, photo.thumbFilename)).catch(() => {});
  }
  res.status(204).end();
});
