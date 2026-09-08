import { Router, Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs/promises";
import { prisma } from "../db";
import { upload, UPLOADS_DIR } from "../lib/upload";
import { readExif } from "../lib/exif";
import { storeImage } from "../lib/images";

export const photosRouter = Router();

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

photosRouter.post("/", acceptPhoto, async (req, res) => {
  const { issueId } = req.body;
  const file = req.file;

  if (!file) return res.status(400).json({ error: "photo file is required" });
  if (!issueId || typeof issueId !== "string") {
    return res.status(400).json({ error: "issueId is required" });
  }

  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue) return res.status(404).json({ error: "issue not found" });

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

photosRouter.delete("/:id", async (req, res) => {
  const photo = await prisma.photo.findUnique({ where: { id: req.params.id } });
  if (!photo) return res.status(404).json({ error: "not found" });
  await prisma.photo.delete({ where: { id: req.params.id } });
  await fs.unlink(path.join(UPLOADS_DIR, photo.filename)).catch(() => {});
  if (photo.thumbFilename) {
    await fs.unlink(path.join(UPLOADS_DIR, photo.thumbFilename)).catch(() => {});
  }
  res.status(204).end();
});
