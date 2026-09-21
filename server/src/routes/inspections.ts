import { Router, Request, Response, NextFunction } from "express";
import fs from "fs/promises";
import path from "path";
import { prisma } from "../db";
import { ADMIN_ONLY, CAN_EDIT } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { parseOptionalString, ValidationError } from "../lib/validation";
import { parseCategory } from "../lib/taxonomy";
import { upload, UPLOADS_DIR } from "../lib/upload";
import { readExif } from "../lib/exif";
import { storeImage } from "../lib/images";
import { countPoints, parseOutcome, parseSeverity, SEVERITY_PRIORITY, type Severity } from "../lib/inspections";

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

const INSPECTION_INCLUDE = {
  property: { select: { id: true, name: true } },
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

inspectionsRouter.post("/templates", ADMIN_ONLY, async (req, res) => {
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
inspectionsRouter.put("/templates/:id", ADMIN_ONLY, async (req, res) => {
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

inspectionsRouter.delete("/templates/:id", ADMIN_ONLY, async (req, res) => {
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

inspectionsRouter.get("/:id", async (req, res) => {
  const inspection = await prisma.inspection.findUnique({ where: { id: req.params.id }, include: INSPECTION_INCLUDE });
  if (!inspection) return res.status(404).json({ error: "not found" });
  res.json(inspection);
});

/**
 * Starts a walk. The template's points are copied onto the inspection as lines so
 * the report can show what was asked, even after the template changes.
 */
inspectionsRouter.post("/", CAN_EDIT, async (req, res) => {
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

  // The report names whoever walked the room, so a technician login shows their own
  // name rather than the login they happened to use.
  const who = req.user!.technicianId
    ? (await prisma.technician.findUnique({ where: { id: req.user!.technicianId }, select: { name: true } }))?.name
    : null;

  const inspection = await prisma.inspection.create({
    data: {
      propertyId,
      templateId,
      templateName,
      roomName,
      inspectorId: req.user!.id,
      inspector: who ?? req.user!.username,
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

inspectionsRouter.put("/:id", CAN_EDIT, async (req, res) => {
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
    if (req.body.status !== undefined) {
      const status = String(req.body.status);
      if (!["in_progress", "completed", "abandoned"].includes(status)) return res.status(400).json({ error: "invalid status" });
      data.status = status;
      data.completedAt = status === "in_progress" ? null : (existing.completedAt ?? new Date());
    }
    const inspection = await prisma.inspection.update({ where: { id: existing.id }, data, include: INSPECTION_INCLUDE });

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

inspectionsRouter.delete("/:id", ADMIN_ONLY, async (req, res) => {
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

inspectionsRouter.put("/checks/:checkId", CAN_EDIT, async (req, res) => {
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
inspectionsRouter.post("/:id/checks", CAN_EDIT, async (req, res) => {
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

inspectionsRouter.delete("/checks/:checkId", CAN_EDIT, async (req, res) => {
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

/** A photo against one line. This is the evidence the report is built from. */
inspectionsRouter.post("/checks/:checkId/photos", CAN_EDIT, acceptPhoto, async (req, res) => {
  const check = await prisma.inspectionCheck.findUnique({ where: { id: req.params.checkId } });
  if (!check) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "photo file is required" });

  const exif = await readExif(req.file.buffer);
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
      hasGps: exif.hasGps,
      gpsLat: exif.gpsLat,
      gpsLng: exif.gpsLng,
      takenAt: exif.takenAt,
    },
  });
  res.status(201).json(photo);
});

// ---------------------------------------------------------------------------
// Turning findings into work
// ---------------------------------------------------------------------------

/**
 * Raises issues from a set of findings, optionally grouping them into a project.
 *
 * This is the one place the inspection domain touches the rest of the app. A
 * finding's photos move onto the issue it became, so the person doing the job
 * sees what the inspector saw.
 */
inspectionsRouter.post("/:id/raise", ADMIN_ONLY, async (req, res) => {
  const inspection = await prisma.inspection.findUnique({
    where: { id: req.params.id },
    include: { property: { select: { id: true, name: true, centerLat: true, centerLng: true } }, checks: true },
  });
  if (!inspection) return res.status(404).json({ error: "not found" });

  const wanted: string[] = Array.isArray(req.body.checkIds) ? req.body.checkIds.map(String) : [];
  if (wanted.length === 0) return res.status(400).json({ error: "Pick at least one finding." });

  const chosen = inspection.checks.filter((c) => wanted.includes(c.id));
  if (chosen.length !== wanted.length) return res.status(400).json({ error: "One or more of those findings is not on this inspection." });
  const already = chosen.filter((c) => c.issueId);
  if (already.length) return res.status(400).json({ error: `${already.length} of those already became issues.` });
  const notFlagged = chosen.filter((c) => c.outcome !== "flagged");
  if (notFlagged.length) return res.status(400).json({ error: "Only flagged findings can be raised as work." });

  // A room's pin is the property centre unless a photo says otherwise — an inspector
  // is standing in the room, so the photo's own GPS is the better guess when present.
  const located = await prisma.photo.findFirst({
    where: { checkId: { in: chosen.map((c) => c.id) }, hasGps: true },
    select: { gpsLat: true, gpsLng: true },
  });
  const lat = located?.gpsLat ?? inspection.property.centerLat ?? 0;
  const lng = located?.gpsLng ?? inspection.property.centerLng ?? 0;

  let projectId: string | null = null;
  let projectName: string | null = null;
  if (req.body.projectId) {
    const project = await prisma.project.findUnique({ where: { id: String(req.body.projectId) }, select: { id: true, name: true } });
    if (!project) return res.status(404).json({ error: "project not found" });
    projectId = project.id;
    projectName = project.name;
  } else if (req.body.projectName) {
    const name = String(req.body.projectName).trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: "A project needs a name." });
    const project = await prisma.project.create({
      data: {
        name,
        description: parseOptionalString(req.body.projectDescription, "description", 1000) ?? `Raised from the inspection of ${inspection.roomName} on ${inspection.startedAt.toISOString().slice(0, 10)}.`,
        propertyId: inspection.propertyId,
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
        lat,
        lng,
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

  await logActivity(req, {
    action: "inspection.raised",
    entityType: "inspection",
    entityId: inspection.id,
    propertyId: inspection.propertyId,
    summary: projectName
      ? `Raised ${created.length} issue${created.length === 1 ? "" : "s"} from ${inspection.roomName} into the project "${projectName}"`
      : `Raised ${created.length} issue${created.length === 1 ? "" : "s"} from the inspection of ${inspection.roomName}`,
  });

  const fresh = await prisma.inspection.findUnique({ where: { id: inspection.id }, include: INSPECTION_INCLUDE });
  res.status(201).json({ created, projectId, projectName, inspection: fresh });
});
