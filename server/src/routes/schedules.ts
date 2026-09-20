import { Router } from "express";
import { prisma } from "../db";
import { ADMIN_ONLY } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { parseOptionalDay, parseOptionalHours, parseOptionalString, ValidationError } from "../lib/validation";
import { cadenceText, createOccurrence, serializeSchedule, UNITS } from "../lib/schedules";
import { parseCategory } from "../lib/taxonomy";
import { OPEN_STATUSES } from "../lib/workflow";

export const schedulesRouter = Router();

const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

const SCHEDULE_INCLUDE = {
  property: { select: { id: true, name: true } },
  technician: { select: { id: true, name: true, color: true } },
  issues: { where: { status: { in: OPEN_STATUSES } }, select: { id: true, title: true, status: true, dueDate: true }, orderBy: { dueDate: "asc" as const } },
} as const;

function intField(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${field} must be a whole number between ${min} and ${max}`);
  return n;
}

function checklistField(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ValidationError("checklist must be a list of steps");
  const items = value.map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean);
  if (items.length > 50) throw new ValidationError("A checklist can have at most 50 steps");
  if (items.some((t) => t.length > 200)) throw new ValidationError("Checklist steps must be 200 characters or fewer");
  return JSON.stringify(items);
}

async function parseBody(body: any, partial: boolean) {
  const data: Record<string, unknown> = {};
  if (!partial || body.title !== undefined) {
    if (!body.title || typeof body.title !== "string" || !body.title.trim()) throw new ValidationError("title is required");
    data.title = body.title.trim().slice(0, 160);
  }
  const description = parseOptionalString(body.description, "description", 2000);
  if (description !== undefined) data.description = description;
  const actionNeeded = parseOptionalString(body.actionNeeded, "actionNeeded", 2000);
  if (actionNeeded !== undefined) data.actionNeeded = actionNeeded;
  if (body.priority !== undefined) {
    if (!PRIORITIES.has(body.priority)) throw new ValidationError("invalid priority");
    data.priority = body.priority;
  }
  if (body.technicianId !== undefined) {
    if (body.technicianId === null || body.technicianId === "") data.technicianId = null;
    else {
      const tech = await prisma.technician.findUnique({ where: { id: String(body.technicianId) } });
      if (!tech) throw new ValidationError("technician not found");
      data.technicianId = tech.id;
    }
  }
  const category = parseCategory(body.category);
  if (category !== undefined) data.category = category;
  const roomName = parseOptionalString(body.roomName, "roomName", 120);
  if (roomName !== undefined) data.roomName = roomName;
  const est = parseOptionalHours(body.estimatedHours, "estimatedHours");
  if (est !== undefined) data.estimatedHours = est;
  if (body.lat !== undefined || body.lng !== undefined) {
    if (typeof body.lat !== "number" || typeof body.lng !== "number" || Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) throw new ValidationError("lat and lng must be numbers");
    data.lat = body.lat;
    data.lng = body.lng;
  }
  const every = intField(body.every, "every", 1, 365);
  if (every !== undefined) data.every = every;
  if (body.unit !== undefined) {
    if (!UNITS.has(body.unit)) throw new ValidationError("unit must be days, weeks or months");
    data.unit = body.unit;
  }
  const leadDays = intField(body.leadDays, "leadDays", 0, 365);
  if (leadDays !== undefined) data.leadDays = leadDays;
  const nextDue = parseOptionalDay(body.nextDue, "nextDue");
  if (!partial && !nextDue) throw new ValidationError("nextDue (first due date) is required");
  if (nextDue) data.nextDue = nextDue;
  const checklist = checklistField(body.checklist);
  if (checklist !== undefined) data.checklist = checklist;
  if (body.active !== undefined) data.active = !!body.active;
  return data;
}

schedulesRouter.get("/", async (req, res) => {
  const { propertyId } = req.query;
  const schedules = await prisma.schedule.findMany({
    where: propertyId ? { propertyId: String(propertyId) } : undefined,
    orderBy: [{ active: "desc" }, { nextDue: "asc" }],
    include: SCHEDULE_INCLUDE,
  });
  res.json(schedules.map(serializeSchedule));
});

schedulesRouter.post("/", ADMIN_ONLY, async (req, res) => {
  try {
    const { propertyId } = req.body;
    if (!propertyId || typeof propertyId !== "string") return res.status(400).json({ error: "propertyId is required" });
    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) return res.status(404).json({ error: "property not found" });
    const data = await parseBody(req.body, false);
    if (data.lat === undefined) {
      if (property.centerLat == null || property.centerLng == null) return res.status(400).json({ error: "Pick a location on the map (the property has no centre yet)." });
      data.lat = property.centerLat;
      data.lng = property.centerLng;
    }
    const schedule = await prisma.schedule.create({ data: { ...(data as any), propertyId }, include: SCHEDULE_INCLUDE });
    await logActivity(req, {
      action: "schedule.created",
      entityType: "property",
      entityId: schedule.propertyId,
      propertyId: schedule.propertyId,
      summary: `Added recurring task "${schedule.title}" (${cadenceText(schedule.every, schedule.unit).toLowerCase()}, next due ${schedule.nextDue})`,
    });
    res.status(201).json(serializeSchedule(schedule));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

schedulesRouter.put("/:id", ADMIN_ONLY, async (req, res) => {
  try {
    const data = await parseBody(req.body, true);
    const schedule = await prisma.schedule.update({ where: { id: req.params.id }, data: data as any, include: SCHEDULE_INCLUDE });
    await logActivity(req, {
      action: "schedule.updated",
      entityType: "property",
      entityId: schedule.propertyId,
      propertyId: schedule.propertyId,
      summary: `Updated recurring task "${schedule.title}"${data.active === false ? " (paused)" : data.active === true ? " (resumed)" : ""}`,
    });
    res.json(serializeSchedule(schedule));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if ((err as any)?.code === "P2025") return res.status(404).json({ error: "not found" });
    throw err;
  }
});

schedulesRouter.delete("/:id", ADMIN_ONLY, async (req, res) => {
  try {
    const schedule = await prisma.schedule.delete({ where: { id: req.params.id } });
    await logActivity(req, { action: "schedule.deleted", entityType: "property", entityId: schedule.propertyId, propertyId: schedule.propertyId, summary: `Removed recurring task "${schedule.title}"` });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

// Create the next occurrence now, regardless of lead time.
schedulesRouter.post("/:id/run-now", ADMIN_ONLY, async (req, res) => {
  const issue = await createOccurrence(req.params.id, { force: true, actor: req.user!.id });
  if (!issue) return res.status(409).json({ error: "An open issue for the next due date already exists." });
  const schedule = await prisma.schedule.findUnique({ where: { id: req.params.id }, include: SCHEDULE_INCLUDE });
  res.status(201).json({ issue, schedule: schedule ? serializeSchedule(schedule) : null });
});
