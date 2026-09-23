import { Router, Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs/promises";
import { prisma } from "../db";
import { upload, UPLOADS_DIR } from "../lib/upload";
import { readExif } from "../lib/exif";
import { storeImage } from "../lib/images";
import { requires } from "../middleware/requireAuth";
import { can } from "../lib/permissions";
import { isOnCrew } from "../lib/crew";
import { logActivity } from "../lib/activity";

export const photosRouter = Router();

// Technicians may only touch photos on issues they are on — as lead or as one of the crew.
async function mayEditIssue(req: Request, issue: { id: string }): Promise<boolean> {
  const user = req.user!;
  return user.role === "admin" || (user.role === "technician" && (await isOnCrew(issue.id, user.technicianId)));
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

photosRouter.post("/", requires("issue.write"), acceptPhoto, async (req, res) => {
  const { issueId } = req.body;
  const file = req.file;

  if (!file) return res.status(400).json({ error: "photo file is required" });
  if (!issueId || typeof issueId !== "string") {
    return res.status(400).json({ error: "issueId is required" });
  }

  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue) return res.status(404).json({ error: "issue not found" });
  if (!(await mayEditIssue(req, issue))) return res.status(403).json({ error: "You can only add photos to issues assigned to you." });

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

/**
 * A photo belongs to one of three things, and each has its own rule about who
 * may remove it. This used to assume an issue, which meant a photo taken during
 * an inspection could not be deleted at all — the route refused it with a
 * message about guest reports.
 */
photosRouter.delete("/:id", requires("issue.write"), async (req, res) => {
  const photo = await prisma.photo.findUnique({
    where: { id: req.params.id },
    include: { issue: true, check: { include: { inspection: { select: { id: true, status: true, roomName: true, propertyId: true } } } } },
  });
  if (!photo) return res.status(404).json({ error: "not found" });

  if (photo.check) {
    // Evidence on a finding. Follows the same rule as the finding itself: only
    // while the walk is open, so a signed-off report cannot quietly lose a photo.
    if (!can(req.user!.role, "inspection.run")) {
      return res.status(403).json({ error: "You don't have permission to change an inspection." });
    }
    if (photo.check.inspection.status !== "in_progress") {
      return res.status(400).json({ error: "That inspection is finished. Reopen it to remove a photo." });
    }
    if (photo.check.issueId) {
      return res.status(400).json({ error: "That finding has already been raised as work — remove the photo from the issue instead." });
    }
    await prisma.photo.delete({ where: { id: photo.id } });
    await logActivity(req, {
      action: "photo.removed",
      entityType: "photo",
      entityId: photo.id,
      propertyId: photo.check.inspection.propertyId,
      summary: `Removed a photo from "${photo.check.label}" in ${photo.check.inspection.roomName}`,
    });
    await fs.unlink(path.join(UPLOADS_DIR, photo.filename)).catch(() => {});
    if (photo.thumbFilename) await fs.unlink(path.join(UPLOADS_DIR, photo.thumbFilename)).catch(() => {});
    return res.status(204).end();
  }

  // A photo still attached to a guest report goes when the report is declined or deleted,
  // so there is nothing to do here and no issue to check permission against.
  if (!photo.issue) return res.status(400).json({ error: "That photo belongs to a guest report, not an issue." });
  if (!(await mayEditIssue(req, photo.issue))) return res.status(403).json({ error: "You can only remove photos from issues assigned to you." });
  await prisma.photo.delete({ where: { id: req.params.id } });
  await logActivity(req, { action: "photo.removed", entityType: "photo", entityId: photo.id, issueId: photo.issueId, propertyId: photo.issue.propertyId, summary: `Removed a photo from "${photo.issue.title}"` });
  await fs.unlink(path.join(UPLOADS_DIR, photo.filename)).catch(() => {});
  if (photo.thumbFilename) {
    await fs.unlink(path.join(UPLOADS_DIR, photo.thumbFilename)).catch(() => {});
  }
  res.status(204).end();
});
