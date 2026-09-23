import { Router, Request, Response, NextFunction } from "express";
import fs from "fs/promises";
import path from "path";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { DATE_ONLY, parseOptionalString, ValidationError } from "../lib/validation";
import { parseCategory } from "../lib/taxonomy";
import { upload, UPLOADS_DIR } from "../lib/upload";
import { readExif } from "../lib/exif";
import { storeImage } from "../lib/images";
import { countPoints, parseOutcome, parseSeverity, SEVERITY_PRIORITY, type Severity } from "../lib/inspections";
import { can } from "../lib/permissions";

/**
 * Inspections: the templates, the walk, and what comes out of it.
 *
 * This router only reaches outside its own tables in one place — raising an issue
 * from a finding, at the bottom — so the rest can move to a separate service with
 * the models it owns and nothing else.
 */
export const inspectionsRouter = Router();

const TEMPLATE_INCLUDE = {
  sections: { orderBy: { position: "asc" as const }, include: { points: { orderBy: { position: "asc" as const } } } },
} as const;

// Raising a finding hands its photos to the issue, so the issue's photos come back
// too — otherwise the report would lose its own evidence the moment work was raised.
const CHECK_INCLUDE = {
  photos: { orderBy: { createdAt: "asc" as const } },
  issue: {
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      projectId: true,
      photos: { orderBy: { createdAt: "asc" as const } },
    },
  },
} as const;

/** One document, one round of inspections — beyond this it is a database export. */
const MAX_REPORT_ROOMS = 200;

/**
 * A location offered by the browser, or nothing. A phone fix is a claim rather
 * than a measurement anyone can check, so it is range-checked and otherwise
 * taken at face value — it only ever places a map pin.
 */
function parseFix(body: any): { lat: number; lng: number } | null {
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

const INSPECTION_INCLUDE = {
  property: { select: { id: true, name: true } },
  technician: { select: { id: true, name: true, trade: true, color: true } },
  checks: { orderBy: { position: "asc" as const }, include: CHECK_INCLUDE },
} as const;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

inspectionsRouter.get("/templates", async (req, res) => {
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
  const templates = await prisma.inspectionTemplate.findMany({
    where: {
      ...(req.query.all === "1" ? {} : { active: true }),
      // A template is either for one property or for all of them.
      ...(propertyId ? { OR: [{ propertyId: null }, { propertyId }] } : {}),
    },
    include: TEMPLATE_INCLUDE,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  res.json(templates.map((t) => ({ ...t, pointCount: countPoints(t) })));
});

inspectionsRouter.get("/templates/:id", async (req, res) => {
  const template = await prisma.inspectionTemplate.findUnique({ where: { id: req.params.id }, include: TEMPLATE_INCLUDE });
  if (!template) return res.status(404).json({ error: "not found" });
  res.json({ ...template, pointCount: countPoints(template) });
});

interface SectionInput {
  name: string;
  points: { label: string; hint?: string | null; category?: string | null }[];
}

function parseSections(value: unknown): SectionInput[] {
  if (!Array.isArray(value)) throw new ValidationError("sections must be a list");
  return value.map((raw, i) => {
    const section = raw as Record<string, any>;
    const name = typeof section.name === "string" ? section.name.trim().slice(0, 120) : "";
    if (!name) throw new ValidationError(`section ${i + 1} needs a name`);
    if (!Array.isArray(section.points)) throw new ValidationError(`section "${name}" needs a list of points`);
    const points = section.points.map((rawPoint: any) => {
      const label = typeof rawPoint?.label === "string" ? rawPoint.label.trim().slice(0, 200) : "";
      if (!label) throw new ValidationError(`every point in "${name}" needs a label`);
      return {
        label,
        hint: parseOptionalString(rawPoint.hint, "hint", 400) ?? null,
        category: parseCategory(rawPoint.category) ?? null,
      };
    });
    return { name, points };
  });
}

inspectionsRouter.post("/templates", requires("template.write"), async (req, res) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim().slice(0, 120) : "";
    if (!name) return res.status(400).json({ error: "A template needs a name." });
    const sections = parseSections(req.body.sections ?? []);
    const last = await prisma.inspectionTemplate.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });

    const template = await prisma.inspectionTemplate.create({
      data: {
        name,
        description: parseOptionalString(req.body.description, "description", 500) ?? null,
        propertyId: typeof req.body.propertyId === "string" && req.body.propertyId ? req.body.propertyId : null,
        sortOrder: (last?.sortOrder ?? 0) + 1,
        sections: {
          create: sections.map((section, i) => ({
            name: section.name,
            position: i,
            points: { create: section.points.map((point, j) => ({ ...point, position: j })) },
          })),
        },
      },
      include: TEMPLATE_INCLUDE,
    });
    await logActivity(req, { action: "inspection.template_created", entityType: "system", entityId: template.id, summary: `Added inspection template "${template.name}"` });
    res.status(201).json({ ...template, pointCount: countPoints(template) });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/**
 * Replaces a template's contents wholesale. Inspections already run keep their own
 * snapshot of the wording, so editing a template never rewrites past reports.
 */
inspectionsRouter.put("/templates/:id", requires("template.write"), async (req, res) => {
  const existing = await prisma.inspectionTemplate.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not found" });
  try {
    const data: Record<string, unknown> = {};
    if (req.body.name !== undefined) {
      const name = typeof req.body.name === "string" ? req.body.name.trim().slice(0, 120) : "";
      if (!name) return res.status(400).json({ error: "A template needs a name." });
      data.name = name;
    }
    if (req.body.description !== undefined) data.description = parseOptionalString(req.body.description, "description", 500) ?? null;
    if (req.body.active !== undefined) data.active = !!req.body.active;
    if (req.body.propertyId !== undefined) data.propertyId = req.body.propertyId || null;

    if (req.body.sections !== undefined) {
      const sections = parseSections(req.body.sections);
      await prisma.inspectionSection.deleteMany({ where: { templateId: existing.id } });
      data.sections = {
        create: sections.map((section, i) => ({
          name: section.name,
          position: i,
          points: { create: section.points.map((point, j) => ({ ...point, position: j })) },
        })),
      };
    }

    const template = await prisma.inspectionTemplate.update({ where: { id: existing.id }, data, include: TEMPLATE_INCLUDE });
    await logActivity(req, { action: "inspection.template_updated", entityType: "system", entityId: template.id, summary: `Updated inspection template "${template.name}"` });
    res.json({ ...template, pointCount: countPoints(template) });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

inspectionsRouter.delete("/templates/:id", requires("template.write"), async (req, res) => {
  const used = await prisma.inspection.count({ where: { templateId: req.params.id } });
  if (used > 0) {
    return res.status(400).json({ error: `That template has been used on ${used} inspection${used === 1 ? "" : "s"}. Turn it off instead so the reports keep their history.` });
  }
  try {
    const template = await prisma.inspectionTemplate.delete({ where: { id: req.params.id } });
    await logActivity(req, { action: "inspection.template_deleted", entityType: "system", entityId: template.id, summary: `Deleted inspection template "${template.name}"` });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

// ---------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------

inspectionsRouter.get("/", async (req, res) => {
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const inspections = await prisma.inspection.findMany({
    where: { ...(propertyId ? { propertyId } : {}), ...(status ? { status } : {}) },
    include: {
      property: { select: { id: true, name: true } },
      checks: { select: { outcome: true, severity: true, issueId: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 200,
  });
  res.json(
    inspections.map((i) => ({
      ...i,
      checks: undefined,
      counts: {
        total: i.checks.length,
        ok: i.checks.filter((c) => c.outcome === "ok").length,
        flagged: i.checks.filter((c) => c.outcome === "flagged").length,
        na: i.checks.filter((c) => c.outcome === "na").length,
        raised: i.checks.filter((c) => c.issueId).length,
      },
    }))
  );
});

/**
 * Every room in one document.
 *
 * Either a list of inspection ids, or a property and a span of days. It returns
 * the inspections in full because the sheet shows each room's findings; the
 * client asks once rather than once per room, since a floor's worth of rooms is
 * forty round trips otherwise.
 *
 * Nothing is stored — the findings have been on the server since they were
 * typed, and this only assembles them for printing.
 */
inspectionsRouter.get("/report", async (req, res) => {
  const ids = typeof req.query.ids === "string" ? req.query.ids.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
  const from = typeof req.query.from === "string" && DATE_ONLY.test(req.query.from) ? req.query.from : undefined;
  const to = typeof req.query.to === "string" && DATE_ONLY.test(req.query.to) ? req.query.to : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;

  if (!ids.length && !propertyId) {
    return res.status(400).json({ error: "Pick the rooms, or a property and a span of days." });
  }
  if (ids.length > MAX_REPORT_ROOMS) {
    return res.status(400).json({ error: `That is more than ${MAX_REPORT_ROOMS} rooms at once.` });
  }

  // A day range is inclusive at both ends, which is what someone picking
  // "the 3rd to the 5th" means.
  const startedAt =
    from || to
      ? { ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) }
      : undefined;

  const inspections = await prisma.inspection.findMany({
    where: ids.length
      ? { id: { in: ids } }
      : { propertyId, ...(status ? { status } : {}), ...(startedAt ? { startedAt } : {}) },
    include: INSPECTION_INCLUDE,
    orderBy: [{ roomName: "asc" }, { startedAt: "asc" }],
    take: MAX_REPORT_ROOMS,
  });

  if (!inspections.length) return res.status(404).json({ error: "No inspections match that." });

  const checks = inspections.flatMap((i) => i.checks);
  const flagged = checks.filter((c) => c.outcome === "flagged");
  res.json({
    inspections,
    totals: {
      rooms: inspections.length,
      roomsWithFindings: inspections.filter((i) => i.checks.some((c) => c.outcome === "flagged")).length,
      points: checks.length,
      ok: checks.filter((c) => c.outcome === "ok").length,
      na: checks.filter((c) => c.outcome === "na").length,
      flagged: flagged.length,
      major: flagged.filter((c) => c.severity === "major").length,
      moderate: flagged.filter((c) => c.severity === "moderate").length,
      minor: flagged.filter((c) => c.severity !== "major" && c.severity !== "moderate").length,
      raised: flagged.filter((c) => c.issueId).length,
      photos: checks.reduce((n, c) => n + c.photos.length + (c.issue?.photos.length ?? 0), 0),
    },
  });
});

inspectionsRouter.get("/:id", async (req, res) => {
  const inspection = await prisma.inspection.findUnique({ where: { id: req.params.id }, include: INSPECTION_INCLUDE });
  if (!inspection) return res.status(404).json({ error: "not found" });
  res.json(inspection);
});

/**
 * Starts a walk. The template's points are copied onto the inspection as lines so
 * the report can show what was asked, even after the template changes.
 */
inspectionsRouter.post("/", requires("inspection.run"), async (req, res) => {
  const propertyId = typeof req.body.propertyId === "string" ? req.body.propertyId : "";
  const roomName = typeof req.body.roomName === "string" ? req.body.roomName.trim().slice(0, 120) : "";
  const templateId = typeof req.body.templateId === "string" && req.body.templateId ? req.body.templateId : null;
  if (!propertyId) return res.status(400).json({ error: "propertyId is required" });
  if (!roomName) return res.status(400).json({ error: "Which room is this?" });

  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, name: true } });
  if (!property) return res.status(404).json({ error: "property not found" });

  let templateName = "Ad-hoc inspection";
  let lines: { section: string; label: string; hint: string | null; category: string | null; pointId: string; position: number }[] = [];
  if (templateId) {
    const template = await prisma.inspectionTemplate.findUnique({ where: { id: templateId }, include: TEMPLATE_INCLUDE });
    if (!template) return res.status(404).json({ error: "template not found" });
    templateName = template.name;
    let position = 0;
    for (const section of template.sections) {
      for (const point of section.points) {
        lines.push({ section: section.name, label: point.label, hint: point.hint, category: point.category, pointId: point.id, position: position++ });
      }
    }
  }

  // Who walked it. A technician login is taken to be walking it themselves; an
  // admin may say it was somebody else, which is how a paper round gets typed up.
  let technicianId = req.user!.technicianId ?? null;
  if (typeof req.body.technicianId === "string" && req.body.technicianId && req.user!.role === "admin") {
    technicianId = req.body.technicianId;
  }
  let who: string | null = null;
  if (technicianId) {
    const t = await prisma.technician.findUnique({ where: { id: technicianId }, select: { name: true } });
    if (!t) return res.status(404).json({ error: "technician not found" });
    who = t.name;
  }
  const where = parseFix(req.body);

  const inspection = await prisma.inspection.create({
    data: {
      propertyId,
      templateId,
      templateName,
      roomName,
      inspectorId: req.user!.id,
      technicianId,
      inspector: who ?? req.user!.username,
      lat: where?.lat ?? null,
      lng: where?.lng ?? null,
      checks: { create: lines },
    },
    include: INSPECTION_INCLUDE,
  });

  await logActivity(req, {
    action: "inspection.started",
    entityType: "inspection",
    entityId: inspection.id,
    propertyId,
    summary: `Started a ${templateName.toLowerCase()} inspection of ${roomName}`,
  });
  res.status(201).json(inspection);
});

inspectionsRouter.put("/:id", requires("inspection.run"), async (req, res) => {
  const existing = await prisma.inspection.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not found" });
  try {
    const data: Record<string, unknown> = {};
    if (req.body.roomName !== undefined) {
      const roomName = typeof req.body.roomName === "string" ? req.body.roomName.trim().slice(0, 120) : "";
      if (!roomName) return res.status(400).json({ error: "Which room is this?" });
      data.roomName = roomName;
    }
    if (req.body.notes !== undefined) data.notes = parseOptionalString(req.body.notes, "notes", 2000) ?? null;
    const fix = parseFix(req.body);
    if (fix) {
      data.lat = fix.lat;
      data.lng = fix.lng;
    }
    if (req.body.technicianId !== undefined && req.user!.role === "admin") {
      const id = typeof req.body.technicianId === "string" && req.body.technicianId ? req.body.technicianId : null;
      if (id) {
        const t = await prisma.technician.findUnique({ where: { id }, select: { name: true } });
        if (!t) return res.status(404).json({ error: "technician not found" });
        data.technicianId = id;
        data.inspector = t.name;
      } else {
        data.technicianId = null;
      }
    }
    if (req.body.status !== undefined) {
      const status = String(req.body.status);
      if (!["in_progress", "completed", "abandoned"].includes(status)) return res.status(400).json({ error: "invalid status" });

      // Reopening something already signed off is a different act from finishing
      // it, and needs its own permission and its own mark on the record.
      const reopening = status === "in_progress" && existing.status !== "in_progress";
      if (reopening) {
        if (!can(req.user!.role, "inspection.amend")) {
          return res.status(403).json({ error: "You don't have permission to reopen a finished inspection." });
        }
        data.amendedAt = new Date();
      }
      data.status = status;
      // Finishing again stamps a new completion; reopening clears it, but the
      // amendment mark stays so the report can say it has been changed since.
      data.completedAt = status === "in_progress" ? null : new Date();
    }
    const inspection = await prisma.inspection.update({ where: { id: existing.id }, data, include: INSPECTION_INCLUDE });

    if (req.body.status === "in_progress" && existing.status !== "in_progress") {
      await logActivity(req, {
        action: "inspection.reopened",
        entityType: "inspection",
        entityId: inspection.id,
        propertyId: inspection.propertyId,
        summary: `Reopened the finished inspection of ${inspection.roomName} to amend it`,
      });
    }

    if (req.body.status === "completed" && existing.status !== "completed") {
      const flagged = inspection.checks.filter((c) => c.outcome === "flagged").length;
      await logActivity(req, {
        action: "inspection.completed",
        entityType: "inspection",
        entityId: inspection.id,
        propertyId: inspection.propertyId,
        summary: `Finished inspecting ${inspection.roomName} — ${flagged} finding${flagged === 1 ? "" : "s"} from ${inspection.checks.length} point${inspection.checks.length === 1 ? "" : "s"}`,
      });
    }
    res.json(inspection);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

inspectionsRouter.delete("/:id", requires("inspection.delete"), async (req, res) => {
  const inspection = await prisma.inspection.findUnique({ where: { id: req.params.id }, include: { checks: { include: { photos: true } } } });
  if (!inspection) return res.status(404).json({ error: "not found" });
  const raised = inspection.checks.filter((c) => c.issueId).length;
  if (raised > 0) {
    return res.status(400).json({ error: `${raised} issue${raised === 1 ? " has" : "s have"} already been raised from this inspection. It is the record of where they came from.` });
  }
  const files = inspection.checks.flatMap((c) => c.photos);
  await prisma.inspection.delete({ where: { id: inspection.id } });
  for (const photo of files) {
    await fs.unlink(path.join(UPLOADS_DIR, photo.filename)).catch(() => {});
    if (photo.thumbFilename) await fs.unlink(path.join(UPLOADS_DIR, photo.thumbFilename)).catch(() => {});
  }
  await logActivity(req, {
    action: "inspection.deleted",
    entityType: "inspection",
    entityId: inspection.id,
    propertyId: inspection.propertyId,
    summary: `Deleted the inspection of ${inspection.roomName}`,
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Checks — the individual lines of a walk
// ---------------------------------------------------------------------------

inspectionsRouter.put("/checks/:checkId", requires("inspection.run"), async (req, res) => {
  const existing = await prisma.inspectionCheck.findUnique({ where: { id: req.params.checkId }, include: { inspection: { select: { status: true } } } });
  if (!existing) return res.status(404).json({ error: "not found" });
  if (existing.inspection.status !== "in_progress") {
    return res.status(400).json({ error: "That inspection is finished. Reopen it to change a line." });
  }
  try {
    const data: Record<string, unknown> = {};
    if (req.body.outcome !== undefined) {
      const outcome = parseOutcome(req.body.outcome);
      data.outcome = outcome;
      // Severity only means anything on a flagged line.
      if (outcome !== "flagged") data.severity = null;
    }
    if (req.body.severity !== undefined) data.severity = parseSeverity(req.body.severity);
    if (req.body.note !== undefined) data.note = parseOptionalString(req.body.note, "note", 1000) ?? null;
    if (req.body.label !== undefined) {
      const label = typeof req.body.label === "string" ? req.body.label.trim().slice(0, 200) : "";
      if (!label) return res.status(400).json({ error: "A finding needs a few words." });
      data.label = label;
    }
    if (req.body.category !== undefined) data.category = parseCategory(req.body.category) ?? null;

    const check = await prisma.inspectionCheck.update({ where: { id: existing.id }, data, include: CHECK_INCLUDE });
    res.json(check);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/** Something spotted that the template never asked about. */
inspectionsRouter.post("/:id/checks", requires("inspection.run"), async (req, res) => {
  const inspection = await prisma.inspection.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
  if (!inspection) return res.status(404).json({ error: "not found" });
  if (inspection.status !== "in_progress") return res.status(400).json({ error: "That inspection is finished. Reopen it to add a finding." });
  try {
    const label = typeof req.body.label === "string" ? req.body.label.trim().slice(0, 200) : "";
    if (!label) return res.status(400).json({ error: "What did you find?" });
    const last = await prisma.inspectionCheck.findFirst({ where: { inspectionId: inspection.id }, orderBy: { position: "desc" }, select: { position: true } });

    const check = await prisma.inspectionCheck.create({
      data: {
        inspectionId: inspection.id,
        section: parseOptionalString(req.body.section, "section", 120) ?? "Also found",
        label,
        category: parseCategory(req.body.category) ?? null,
        // An extra line only exists because something was wrong with it.
        outcome: req.body.outcome === undefined ? "flagged" : parseOutcome(req.body.outcome),
        severity: parseSeverity(req.body.severity) ?? "minor",
        note: parseOptionalString(req.body.note, "note", 1000) ?? null,
        position: (last?.position ?? 0) + 1,
      },
      include: CHECK_INCLUDE,
    });
    res.status(201).json(check);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

inspectionsRouter.delete("/checks/:checkId", requires("inspection.run"), async (req, res) => {
  const check = await prisma.inspectionCheck.findUnique({ where: { id: req.params.checkId }, include: { photos: true } });
  if (!check) return res.status(404).json({ error: "not found" });
  // Template lines belong to the report even when nothing was wrong; only extras go.
  if (check.pointId) return res.status(400).json({ error: "That line came from the template. Mark it not applicable instead." });
  if (check.issueId) return res.status(400).json({ error: "An issue was already raised from this finding." });
  await prisma.inspectionCheck.delete({ where: { id: check.id } });
  for (const photo of check.photos) {
    await fs.unlink(path.join(UPLOADS_DIR, photo.filename)).catch(() => {});
    if (photo.thumbFilename) await fs.unlink(path.join(UPLOADS_DIR, photo.thumbFilename)).catch(() => {});
  }
  res.status(204).end();
});

function acceptPhoto(req: Request, res: Response, next: NextFunction) {
  upload.single("photo")(req, res, (err: unknown) => {
    if (err) return res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
    next();
  });
}

/**
 * Marks a whole section not applicable in one go.
 *
 * A checklist has to cover the room with a private pool, which means most rooms
 * get a section that does not apply to them. Twelve deliberate N/A taps per room
 * is how a checklist stops being used, so this does it once — and it only ever
 * touches lines nobody has already answered, so it cannot wipe a finding.
 */
inspectionsRouter.post("/:id/sections/:section/na", requires("inspection.run"), async (req, res) => {
  const inspection = await prisma.inspection.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
  if (!inspection) return res.status(404).json({ error: "not found" });
  if (inspection.status !== "in_progress") return res.status(400).json({ error: "That inspection is finished. Reopen it to change a line." });

  const section = decodeURIComponent(req.params.section);
  const outcome = req.body?.outcome === "ok" ? "ok" : "na";
  const { count } = await prisma.inspectionCheck.updateMany({
    // Only untouched lines. A flagged finding in this section is somebody's work.
    where: { inspectionId: inspection.id, section, outcome: "ok", note: null, issueId: null },
    data: { outcome },
  });

  const fresh = await prisma.inspection.findUnique({ where: { id: inspection.id }, include: INSPECTION_INCLUDE });
  await logActivity(req, {
    action: "inspection.section_na",
    entityType: "inspection",
    entityId: inspection.id,
    summary: `Marked "${section}" not applicable (${count} line${count === 1 ? "" : "s"})`,
  });
  res.json({ changed: count, inspection: fresh });
});

/** A photo against one line. This is the evidence the report is built from. */
inspectionsRouter.post("/checks/:checkId/photos", requires("inspection.run"), acceptPhoto, async (req, res) => {
  const check = await prisma.inspectionCheck.findUnique({ where: { id: req.params.checkId } });
  if (!check) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "photo file is required" });

  // A phone-shrunk photo has had its EXIF stripped by the canvas, so the client
  // sends what it read off the original. The file's own EXIF still wins when it
  // has any — what is actually in the image beats what the sender claims.
  const exif = await readExif(req.file.buffer);
  const claimedLat = Number(req.body?.gpsLat);
  const claimedLng = Number(req.body?.gpsLng);
  const claimedTaken = typeof req.body?.takenAt === "string" ? new Date(req.body.takenAt) : null;
  const hasClaimedGps =
    Number.isFinite(claimedLat) && Number.isFinite(claimedLng) && Math.abs(claimedLat) <= 90 && Math.abs(claimedLng) <= 180;

  // Order of preference: what the camera recorded, then what the client read off
  // the original before shrinking it, then where the phone says it is standing.
  // The last of those is a different kind of fact, so it is labelled as such.
  const deviceFix = req.body?.gpsSource === "device" ? { lat: claimedLat, lng: claimedLng } : null;
  const hasGps = exif.hasGps || hasClaimedGps;
  const gpsLat = exif.hasGps ? exif.gpsLat : hasClaimedGps ? claimedLat : null;
  const gpsLng = exif.hasGps ? exif.gpsLng : hasClaimedGps ? claimedLng : null;
  const gpsSource = exif.hasGps ? "exif" : hasClaimedGps ? (deviceFix ? "device" : "exif") : null;
  const takenAt = exif.takenAt ?? (claimedTaken && !isNaN(claimedTaken.getTime()) ? claimedTaken : null);

  let stored;
  try {
    stored = await storeImage(req.file.buffer, req.file.originalname);
  } catch (err) {
    console.error("inspection photo failed", err);
    return res.status(400).json({ error: "Could not read that image. Try a JPEG, PNG or HEIC photo." });
  }
  const photo = await prisma.photo.create({
    data: {
      checkId: check.id,
      filename: stored.filename,
      thumbFilename: stored.thumbFilename,
      hasGps,
      gpsLat,
      gpsLng,
      gpsSource,
      takenAt,
    },
  });
  res.status(201).json(photo);
});

// ---------------------------------------------------------------------------
// Turning findings into work
// ---------------------------------------------------------------------------

type ChosenCheck = Awaited<ReturnType<typeof prisma.inspectionCheck.findMany>>[number];

/**
 * Raises issues from a set of findings, optionally grouping them into a project.
 *
 * This is the one place the inspection domain touches the rest of the app. A
 * finding's photos move onto the issue it became, so the person doing the job
 * sees what the inspector saw.
 *
 * Findings from different rooms — different properties, even — can come in one
 * call, because a snagging list for a whole floor is one piece of work to the
 * person who has to schedule it. Each issue still lands on its own room's
 * property, at its own room's pin.
 */
async function raiseChecks(req: Request, chosen: ChosenCheck[], body: any) {
  const inspectionIds = [...new Set(chosen.map((c) => c.inspectionId))];
  const inspections = await prisma.inspection.findMany({
    where: { id: { in: inspectionIds } },
    include: { property: { select: { id: true, name: true, centerLat: true, centerLng: true } } },
  });
  const byId = new Map(inspections.map((i) => [i.id, i]));

  // Where to put the pin, best evidence first: a photo the camera geotagged, then
  // a photo tagged from the phone's own position, then where the walk itself was,
  // then the middle of the property. An inspector is standing in the room, so any
  // of the first three beats the last.
  const located = await prisma.photo.findMany({
    where: { checkId: { in: chosen.map((c) => c.id) }, hasGps: true },
    select: { checkId: true, gpsLat: true, gpsLng: true, gpsSource: true },
    orderBy: { gpsSource: "asc" }, // "device" before "exif"; reversed below
  });
  const pinByCheck = new Map<string, { gpsLat: number | null; gpsLng: number | null }>();
  for (const photo of located) {
    const existing = pinByCheck.get(photo.checkId!);
    // A camera fix replaces a device one; otherwise first in wins.
    if (!existing || photo.gpsSource === "exif") pinByCheck.set(photo.checkId!, photo);
  }

  let projectId: string | null = null;
  let projectName: string | null = null;
  if (body.projectId) {
    const project = await prisma.project.findUnique({ where: { id: String(body.projectId) }, select: { id: true, name: true } });
    if (!project) return { ok: false, error: { status: 404, message: "project not found" } } as const;
    projectId = project.id;
    projectName = project.name;
  } else if (body.projectName) {
    const name = String(body.projectName).trim().slice(0, 120);
    if (!name) return { ok: false, error: { status: 400, message: "A project needs a name." } } as const;
    const rooms = [...new Set(inspections.map((i) => i.roomName))];
    const where = rooms.length === 1 ? `the inspection of ${rooms[0]}` : `${rooms.length} room inspections`;
    // A project spanning properties belongs to none of them in particular.
    const propertyIds = [...new Set(inspections.map((i) => i.propertyId))];
    const project = await prisma.project.create({
      data: {
        name,
        description:
          parseOptionalString(body.projectDescription, "description", 1000) ??
          `Raised from ${where} on ${new Date().toISOString().slice(0, 10)}.`,
        propertyId: propertyIds.length === 1 ? propertyIds[0] : null,
        createdBy: req.user!.username,
      },
    });
    projectId = project.id;
    projectName = project.name;
  }

  const { getSettings } = await import("../lib/settings");
  const { computeDeadline } = await import("../lib/validation");
  const { responseHours } = await getSettings();

  const created: { checkId: string; issueId: string; title: string }[] = [];
  for (const check of chosen) {
    const inspection = byId.get(check.inspectionId)!;
    const pin = pinByCheck.get(check.id);
    const priority = SEVERITY_PRIORITY[(check.severity ?? "minor") as Severity] ?? "low";
    const deadline = computeDeadline(priority, responseHours);
    const issue = await prisma.issue.create({
      data: {
        propertyId: inspection.propertyId,
        title: check.label.slice(0, 200),
        description: [check.note, check.hint ? `Looked for: ${check.hint}` : null].filter(Boolean).join("\n\n") || null,
        priority,
        category: check.category,
        roomName: inspection.roomName,
        lat: pin?.gpsLat ?? inspection.lat ?? inspection.property.centerLat ?? 0,
        lng: pin?.gpsLng ?? inspection.lng ?? inspection.property.centerLng ?? 0,
        projectId,
        dueDate: deadline.dueDate,
        dueAt: deadline.dueAt,
      },
    });
    // The evidence goes with the work.
    await prisma.photo.updateMany({ where: { checkId: check.id }, data: { issueId: issue.id, checkId: null } });
    await prisma.inspectionCheck.update({ where: { id: check.id }, data: { issueId: issue.id } });
    created.push({ checkId: check.id, issueId: issue.id, title: issue.title });
  }

  const rooms = [...new Set(inspections.map((i) => i.roomName))];
  const from = rooms.length === 1 ? rooms[0] : `${rooms.length} rooms`;
  await logActivity(req, {
    action: "inspection.raised",
    entityType: "inspection",
    entityId: inspectionIds[0],
    propertyId: inspections[0]?.propertyId,
    summary: projectName
      ? `Raised ${created.length} issue${created.length === 1 ? "" : "s"} from ${from} into the project "${projectName}"`
      : `Raised ${created.length} issue${created.length === 1 ? "" : "s"} from ${from}`,
  });

  return { ok: true, created, projectId, projectName, inspectionIds } as const;
}

/** Checks that are allowed to become work, or the reason they are not. */
async function pickRaisable(ids: string[], onlyInspectionId?: string) {
  if (ids.length === 0) return { ok: false, error: { status: 400, message: "Pick at least one finding." } } as const;
  if (ids.length > 200) return { ok: false, error: { status: 400, message: "That is more than 200 findings at once." } } as const;

  const chosen = await prisma.inspectionCheck.findMany({ where: { id: { in: ids } } });
  if (chosen.length !== ids.length) return { ok: false, error: { status: 400, message: "One or more of those findings no longer exists." } } as const;
  if (onlyInspectionId && chosen.some((c) => c.inspectionId !== onlyInspectionId)) {
    return { ok: false, error: { status: 400, message: "One or more of those findings is not on this inspection." } } as const;
  }
  const already = chosen.filter((c) => c.issueId);
  if (already.length) return { ok: false, error: { status: 400, message: `${already.length} of those already became issues.` } } as const;
  const notFlagged = chosen.filter((c) => c.outcome !== "flagged");
  if (notFlagged.length) return { ok: false, error: { status: 400, message: "Only flagged findings can be raised as work." } } as const;
  return { ok: true, chosen } as const;
}

inspectionsRouter.post("/:id/raise", requires("inspection.raise"), async (req, res) => {
  const inspection = await prisma.inspection.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!inspection) return res.status(404).json({ error: "not found" });

  const wanted: string[] = Array.isArray(req.body.checkIds) ? req.body.checkIds.map(String) : [];
  const picked = await pickRaisable(wanted, inspection.id);
  if (!picked.ok) return res.status(picked.error.status).json({ error: picked.error.message });

  const result = await raiseChecks(req, picked.chosen, req.body);
  if (!result.ok) return res.status(result.error.status).json({ error: result.error.message });

  const fresh = await prisma.inspection.findUnique({ where: { id: inspection.id }, include: INSPECTION_INCLUDE });
  res.status(201).json({ created: result.created, projectId: result.projectId, projectName: result.projectName, inspection: fresh });
});

/** The same thing, for findings picked across several rooms on the combined report. */
inspectionsRouter.post("/raise", requires("inspection.raise"), async (req, res) => {
  const wanted: string[] = Array.isArray(req.body.checkIds) ? req.body.checkIds.map(String) : [];
  const picked = await pickRaisable(wanted);
  if (!picked.ok) return res.status(picked.error.status).json({ error: picked.error.message });

  const result = await raiseChecks(req, picked.chosen, req.body);
  if (!result.ok) return res.status(result.error.status).json({ error: result.error.message });

  const inspections = await prisma.inspection.findMany({ where: { id: { in: result.inspectionIds } }, include: INSPECTION_INCLUDE });
  res.status(201).json({ created: result.created, projectId: result.projectId, projectName: result.projectName, inspections });
});
