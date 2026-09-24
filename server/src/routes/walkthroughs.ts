import { Router } from "express";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { upload } from "../lib/upload";
import { readExif } from "../lib/exif";
import { storeImage } from "../lib/images";
import { logActivity } from "../lib/activity";
import { getSettings } from "../lib/settings";
import { computeDeadline } from "../lib/validation";

/**
 * Walking a building with a phone.
 *
 * The order is the point. On an inspection you answer a checklist as you go; on
 * a walk-through you photograph what you see and sort it out afterwards, because
 * stopping to write up each finding is how people stop bothering to record them.
 *
 * So photographs land here first, belonging to the walk and to nothing else.
 * Grouping a few of them mints an issue and moves those photos onto it — the
 * reconciliation step — and what is left is a record of who covered which areas
 * and when, with the work it produced hanging off it.
 */
export const walkthroughsRouter = Router();

const MAX_PHOTOS_PER_UPLOAD = 12;

const withDetail = {
  property: { select: { id: true, name: true, centerLat: true, centerLng: true } },
  technician: { select: { id: true, name: true, color: true } },
  // Only the ones still waiting to be sorted: grouping moves a photo to its issue.
  photos: { orderBy: { createdAt: "asc" } },
  issues: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true, title: true, description: true, priority: true, status: true,
      roomName: true, category: true, lat: true, lng: true, createdAt: true,
      photos: { select: { id: true, thumbFilename: true, filename: true } },
    },
  },
} as const;

walkthroughsRouter.get("/", async (req, res) => {
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  const walks = await prisma.walkthrough.findMany({
    where: {
      ...(propertyId ? { propertyId } : {}),
      ...(state === "open" ? { completedAt: null } : state === "completed" ? { NOT: { completedAt: null } } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: 200,
    include: {
      property: { select: { id: true, name: true } },
      technician: { select: { id: true, name: true, color: true } },
      _count: { select: { photos: true, issues: true } },
    },
  });
  res.json(walks);
});

walkthroughsRouter.get("/:id", async (req, res) => {
  const walk = await prisma.walkthrough.findUnique({ where: { id: req.params.id }, include: withDetail });
  if (!walk) return res.status(404).json({ error: "not found" });
  res.json(walk);
});

walkthroughsRouter.post("/", requires("inspection.run"), async (req, res) => {
  const { propertyId, lat, lng } = req.body ?? {};
  if (!propertyId || typeof propertyId !== "string") return res.status(400).json({ error: "Pick a property to walk." });

  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, name: true } });
  if (!property) return res.status(404).json({ error: "property not found" });

  /**
   * Who walked it. A technician login is always themselves; anyone else may be
   * typing up someone else's round, so they say whose it was. The name is stored
   * as written, not looked up later: people leave, and the record of who walked
   * the building on a given night should not change when they do.
   */
  let technicianId: string | null = req.user!.technicianId ?? null;
  if (!req.user!.technicianId && typeof req.body?.technicianId === "string" && req.body.technicianId) {
    const tech = await prisma.technician.findUnique({ where: { id: req.body.technicianId }, select: { id: true } });
    if (!tech) return res.status(404).json({ error: "team member not found" });
    technicianId = tech.id;
  }
  const named = technicianId
    ? (await prisma.technician.findUnique({ where: { id: technicianId }, select: { name: true } }))?.name
    : null;
  const walkedBy = named ?? req.user!.username;

  const walk = await prisma.walkthrough.create({
    data: {
      propertyId,
      technicianId,
      walkedBy,
      lat: typeof lat === "number" ? lat : null,
      lng: typeof lng === "number" ? lng : null,
    },
    include: withDetail,
  });

  await logActivity(req, {
    action: "walkthrough.started", entityType: "walkthrough", entityId: walk.id,
    summary: `${walkedBy} started a walk-through of ${property.name}`,
  });
  res.status(201).json(walk);
});

/** Photographs, as many at a time as the phone will hand over. */
walkthroughsRouter.post("/:id/photos", requires("inspection.run"), (req, res, next) => {
  upload.array("photos", MAX_PHOTOS_PER_UPLOAD)(req, res, (err: unknown) => {
    if (err) return res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
    next();
  });
}, async (req, res) => {
  const walk = await prisma.walkthrough.findUnique({ where: { id: req.params.id }, select: { id: true, completedAt: true } });
  if (!walk) return res.status(404).json({ error: "not found" });
  if (walk.completedAt) return res.status(400).json({ error: "That walk-through is finished. Start a new one to add photos." });

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) return res.status(400).json({ error: "No photos were sent." });

  const made = [];
  for (const file of files) {
    // Read the metadata off the original: resizing throws it away.
    const exif = await readExif(file.buffer);
    let stored;
    try {
      stored = await storeImage(file.buffer, file.originalname);
    } catch (err) {
      console.error("walk-through photo failed", err);
      return res.status(400).json({ error: "One of those photos couldn't be read. Try taking it again." });
    }
    made.push(
      await prisma.photo.create({
        data: {
          walkthroughId: walk.id,
          filename: stored.filename,
          thumbFilename: stored.thumbFilename,
          hasGps: exif.hasGps,
          gpsLat: exif.gpsLat,
          gpsLng: exif.gpsLng,
          gpsSource: exif.hasGps ? "exif" : null,
          takenAt: exif.takenAt,
        },
      })
    );
  }
  res.status(201).json(made);
});

/**
 * The reconciliation: some photos become one issue.
 *
 * Where it lands, in order of what is actually known: the first photo that
 * carries its own coordinates, then where the phone said the walk started, then
 * the middle of the property. A pin in roughly the right place beats refusing to
 * record the finding at all, and the photo's own position is the honest one when
 * there is one.
 */
walkthroughsRouter.post("/:id/group", requires("issue.write"), async (req, res) => {
  const walk = await prisma.walkthrough.findUnique({
    where: { id: req.params.id },
    include: { property: { select: { id: true, name: true, centerLat: true, centerLng: true } } },
  });
  if (!walk) return res.status(404).json({ error: "not found" });

  const ids: unknown = req.body?.photoIds;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "Pick the photos that belong together." });
  const photoIds = [...new Set(ids.map(String))];

  const photos = await prisma.photo.findMany({ where: { id: { in: photoIds }, walkthroughId: walk.id } });
  if (photos.length !== photoIds.length) {
    return res.status(400).json({ error: "Some of those photos are not on this walk-through any more. Reload and try again." });
  }

  const located = photos.find((p) => p.hasGps && p.gpsLat !== null && p.gpsLng !== null);
  const lat = located?.gpsLat ?? walk.lat ?? walk.property.centerLat;
  const lng = located?.gpsLng ?? walk.lng ?? walk.property.centerLng;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({
      error: "Nothing here has a position: the photos carry no location and the property has no centre set. Set the property's centre first.",
    });
  }

  const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : "Walk-through finding";
  const roomName = typeof req.body?.roomName === "string" && req.body.roomName.trim() ? req.body.roomName.trim() : null;
  const { responseHours } = await getSettings();
  const { dueDate, dueAt } = computeDeadline("medium", responseHours, {});

  // One transaction: an issue with no photos on it would be a finding whose
  // evidence is still sitting in the walk, which is the one thing this must not do.
  const issue = await prisma.$transaction(async (tx) => {
    const created = await tx.issue.create({
      data: {
        propertyId: walk.propertyId, walkthroughId: walk.id, title, roomName,
        lat, lng, priority: "medium", status: "pending", dueDate, dueAt,
        ...(walk.technicianId ? {} : {}),
      },
    });
    await tx.photo.updateMany({
      where: { id: { in: photoIds }, walkthroughId: walk.id },
      data: { issueId: created.id, walkthroughId: null },
    });
    return created;
  });

  const full = await prisma.issue.findUnique({ where: { id: issue.id }, include: { photos: true, property: { select: { id: true, name: true } } } });
  await logActivity(req, {
    action: "walkthrough.grouped", entityType: "issue", entityId: issue.id,
    summary: `Grouped ${photos.length} photo${photos.length === 1 ? "" : "s"} from a walk-through into "${title}"`,
  });
  res.status(201).json(full);
});

walkthroughsRouter.put("/:id", requires("inspection.run"), async (req, res) => {
  const walk = await prisma.walkthrough.findUnique({ where: { id: req.params.id }, select: { id: true, walkedBy: true, completedAt: true, property: { select: { name: true } } } });
  if (!walk) return res.status(404).json({ error: "not found" });

  const data: { areas?: string | null; notes?: string | null; completedAt?: Date | null } = {};
  if (req.body?.areas !== undefined) data.areas = typeof req.body.areas === "string" ? req.body.areas.trim() || null : null;
  if (req.body?.notes !== undefined) data.notes = typeof req.body.notes === "string" ? req.body.notes.trim() || null : null;

  if (req.body?.state === "completed") {
    if (!data.areas && !walk.completedAt) {
      // The whole point of finishing is recording what was covered.
      const existing = await prisma.walkthrough.findUnique({ where: { id: walk.id }, select: { areas: true } });
      if (!existing?.areas) return res.status(400).json({ error: "Say which areas you covered before finishing." });
    }
    data.completedAt = new Date();
  } else if (req.body?.state === "open") {
    data.completedAt = null;
  }

  const updated = await prisma.walkthrough.update({ where: { id: walk.id }, data, include: withDetail });
  if (req.body?.state === "completed") {
    await logActivity(req, {
      action: "walkthrough.completed", entityType: "walkthrough", entityId: walk.id,
      summary: `${walk.walkedBy} finished a walk-through of ${walk.property.name} — ${updated.areas ?? "areas not recorded"}`,
    });
  }
  res.json(updated);
});

walkthroughsRouter.delete("/:id", requires("inspection.delete"), async (req, res) => {
  const walk = await prisma.walkthrough.findUnique({ where: { id: req.params.id }, select: { id: true, walkedBy: true } });
  if (!walk) return res.status(404).json({ error: "not found" });
  // Issues already reconciled out of it keep their photos; onDelete is SetNull
  // on the issue side, so deleting the walk does not delete the work it produced.
  await prisma.walkthrough.delete({ where: { id: walk.id } });
  await logActivity(req, { action: "walkthrough.deleted", entityType: "walkthrough", entityId: walk.id, summary: `Deleted a walk-through by ${walk.walkedBy}` });
  res.status(204).end();
});
