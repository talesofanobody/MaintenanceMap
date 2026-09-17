import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { prisma } from "../db";
import { upload } from "../lib/upload";
import { readExif } from "../lib/exif";
import { storeImage } from "../lib/images";
import { logActivity } from "../lib/activity";
import { adminUserIds, notifyUsers } from "../lib/notify";
import { CATEGORIES, CATEGORY_KEYS, categoryLabel } from "../lib/taxonomy";

/**
 * The public side of guest reporting. Nothing here requires a session: the secret in
 * the link is the only credential, so every handler is deliberately narrow about what
 * it reads and what it gives back.
 */
export const intakeRouter = Router();

const MAX_PHOTOS = 4;
const MAX_DESCRIPTION = 2000;
/** Stops one property's link from being used to bury the review queue. */
const MAX_PENDING_PER_PROPERTY = 200;

export function newIntakeToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

// Submitting is the expensive path (image processing, disk), so it is capped harder
// than reading the form. Both are per-IP.
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "That's a lot of reports from one device. Try again in an hour, or call the front desk." },
});

const openLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again shortly." },
});

/**
 * Resolves the link's token. A disabled or unknown token gets the same 404 either way,
 * so the link can't be used to probe which properties exist.
 */
async function openProperty(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const property = await prisma.property.findUnique({
    where: { intakeToken: token },
    select: { id: true, name: true, intakeEnabled: true, centerLat: true, centerLng: true },
  });
  if (!property || !property.intakeEnabled) return null;
  return property;
}

function acceptPhotos(req: Request, res: Response, next: NextFunction) {
  upload.array("photos", MAX_PHOTOS)(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      return res.status(400).json({ error: message });
    }
    next();
  });
}

// What the form needs to render: the property it belongs to and the list of issue types.
intakeRouter.get("/:token", openLimiter, async (req, res) => {
  const property = await openProperty(req.params.token);
  if (!property) return res.status(404).json({ error: "This reporting link isn't active. Please contact the front desk." });
  res.json({ property: { name: property.name }, categories: CATEGORIES });
});

intakeRouter.post("/:token", submitLimiter, acceptPhotos, async (req, res) => {
  const property = await openProperty(req.params.token);
  if (!property) return res.status(404).json({ error: "This reporting link isn't active. Please contact the front desk." });

  const roomName = typeof req.body.roomName === "string" ? req.body.roomName.trim().slice(0, 120) : "";
  const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
  const category = typeof req.body.category === "string" && CATEGORY_KEYS.has(req.body.category as any) ? req.body.category : null;
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  if (!roomName) return res.status(400).json({ error: "Tell us which room or area it's in." });
  if (!description) return res.status(400).json({ error: "Describe what's wrong so we know what to bring." });
  if (description.length > MAX_DESCRIPTION) return res.status(400).json({ error: "That description is too long — a couple of sentences is plenty." });

  const pending = await prisma.guestReport.count({ where: { propertyId: property.id, status: "pending" } });
  if (pending >= MAX_PENDING_PER_PROPERTY) {
    return res.status(503).json({ error: "We can't take more reports right now. Please contact the front desk." });
  }

  // Process the photos before writing anything, so a bad image doesn't leave a half-made report.
  const stored: { filename: string; thumbFilename: string; hasGps: boolean; gpsLat: number | null; gpsLng: number | null; takenAt: Date | null }[] = [];
  for (const file of files) {
    const exif = await readExif(file.buffer);
    try {
      const image = await storeImage(file.buffer, file.originalname);
      stored.push({ ...image, hasGps: exif.hasGps, gpsLat: exif.gpsLat, gpsLng: exif.gpsLng, takenAt: exif.takenAt });
    } catch (err) {
      console.error("guest photo processing failed", err);
      return res.status(400).json({ error: "One of those photos couldn't be read. Try taking it again." });
    }
  }

  // The first photo taken on site puts the pin roughly where the problem is; the
  // reviewer moves it before the issue is created.
  const located = stored.find((p) => p.hasGps && p.gpsLat !== null && p.gpsLng !== null);

  const report = await prisma.guestReport.create({
    data: {
      propertyId: property.id,
      roomName,
      description,
      category,
      lat: located?.gpsLat ?? null,
      lng: located?.gpsLng ?? null,
      photos: { create: stored.map(({ hasGps, gpsLat, gpsLng, takenAt, filename, thumbFilename }) => ({ filename, thumbFilename, hasGps, gpsLat, gpsLng, takenAt })) },
    },
    include: { photos: true },
  });

  const what = category ? categoryLabel(category) : "Maintenance";
  await logActivity(null, {
    action: "intake.submitted",
    entityType: "guest_report",
    entityId: report.id,
    propertyId: property.id,
    username: "guest",
    summary: `Guest report from ${roomName}: ${what.toLowerCase()}`,
  });
  await notifyUsers(await adminUserIds(), {
    kind: "guest_report",
    title: `New guest report · ${roomName}`,
    body: `${property.name} · ${what} — ${description.slice(0, 120)}`,
    propertyId: property.id,
  });

  // Deliberately thin: a reference the guest can quote, and nothing about the property.
  res.status(201).json({ ok: true, reference: report.id.slice(-6).toUpperCase(), photos: report.photos.length });
});
