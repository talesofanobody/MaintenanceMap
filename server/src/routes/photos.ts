import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import { prisma } from "../db";
import { upload, UPLOADS_DIR } from "../lib/upload";
import { readExif } from "../lib/exif";

export const photosRouter = Router();

photosRouter.post("/", upload.single("photo"), async (req, res) => {
  const { issueId } = req.body;
  const file = req.file;

  if (!file) return res.status(400).json({ error: "photo file is required" });
  if (!issueId || typeof issueId !== "string") {
    await fs.unlink(file.path).catch(() => {});
    return res.status(400).json({ error: "issueId is required" });
  }

  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue) {
    await fs.unlink(file.path).catch(() => {});
    return res.status(404).json({ error: "issue not found" });
  }

  const exif = await readExif(file.path);

  const photo = await prisma.photo.create({
    data: {
      issueId,
      filename: file.filename,
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
  res.sendFile(path.join(UPLOADS_DIR, photo.filename));
});

photosRouter.delete("/:id", async (req, res) => {
  const photo = await prisma.photo.findUnique({ where: { id: req.params.id } });
  if (!photo) return res.status(404).json({ error: "not found" });
  await prisma.photo.delete({ where: { id: req.params.id } });
  await fs.unlink(path.join(UPLOADS_DIR, photo.filename)).catch(() => {});
  res.status(204).end();
});
