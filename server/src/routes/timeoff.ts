import { Router } from "express";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { DATE_ONLY, parseOptionalString, ValidationError } from "../lib/validation";
import { parseKind, parseRange, TIME_OFF_WORDS, timeOffBetween, type TimeOffKind } from "../lib/timeoff";
import { OPEN_STATUSES } from "../lib/workflow";

export const timeOffRouter = Router();

const INCLUDE = { technician: { select: { id: true, name: true, color: true, trade: true } } } as const;

// Anyone signed in can see who is away — it is the point of a rota.
timeOffRouter.get("/", async (req, res) => {
  const from = typeof req.query.from === "string" && DATE_ONLY.test(req.query.from) ? req.query.from : undefined;
  const to = typeof req.query.to === "string" && DATE_ONLY.test(req.query.to) ? req.query.to : undefined;
  const technicianId = typeof req.query.technicianId === "string" ? req.query.technicianId : undefined;

  const entries = await prisma.timeOff.findMany({
    where: {
      ...(technicianId ? { technicianId } : {}),
      ...(from ? { endDay: { gte: from } } : {}),
      ...(to ? { startDay: { lte: to } } : {}),
    },
    include: INCLUDE,
    orderBy: [{ startDay: "asc" }, { technicianId: "asc" }],
    take: 500,
  });
  res.json(entries);
});

timeOffRouter.post("/", requires("timeoff.write"), async (req, res) => {
  try {
    const technicianId = typeof req.body.technicianId === "string" ? req.body.technicianId : "";
    if (!technicianId) return res.status(400).json({ error: "Which technician is away?" });
    const technician = await prisma.technician.findUnique({ where: { id: technicianId }, select: { id: true, name: true } });
    if (!technician) return res.status(404).json({ error: "technician not found" });

    const { startDay, endDay } = parseRange(req.body.startDay, req.body.endDay);
    const kind: TimeOffKind = parseKind(req.body.kind);
    const note = parseOptionalString(req.body.note, "note", 300) ?? null;

    // Two overlapping holidays for one person is nearly always a double entry.
    const clash = await prisma.timeOff.findFirst({
      where: { technicianId, startDay: { lte: endDay }, endDay: { gte: startDay } },
      select: { startDay: true, endDay: true },
    });
    if (clash) {
      return res.status(400).json({ error: `${technician.name} is already down as away from ${clash.startDay} to ${clash.endDay}.` });
    }

    const entry = await prisma.timeOff.create({ data: { technicianId, startDay, endDay, kind, note }, include: INCLUDE });

    // Work already booked into those days needs a human decision, so say so rather
    // than moving it silently.
    const clashingJobs = await prisma.issue.count({
      where: { technicianId, status: { in: OPEN_STATUSES }, scheduledFor: { gte: startDay, lte: endDay } },
    });

    await logActivity(req, {
      action: "timeoff.created",
      entityType: "technician",
      entityId: technicianId,
      summary: `${technician.name} away (${TIME_OFF_WORDS[kind].toLowerCase()}) ${startDay}${endDay !== startDay ? ` → ${endDay}` : ""}`,
    });
    res.status(201).json({ entry, clashingJobs });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

timeOffRouter.put("/:id", requires("timeoff.write"), async (req, res) => {
  const existing = await prisma.timeOff.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not found" });
  try {
    const { startDay, endDay } = parseRange(req.body.startDay ?? existing.startDay, req.body.endDay ?? existing.endDay);
    const kind = req.body.kind === undefined ? (existing.kind as TimeOffKind) : parseKind(req.body.kind);
    const note = req.body.note === undefined ? existing.note : (parseOptionalString(req.body.note, "note", 300) ?? null);

    const clash = await prisma.timeOff.findFirst({
      where: { technicianId: existing.technicianId, id: { not: existing.id }, startDay: { lte: endDay }, endDay: { gte: startDay } },
      select: { id: true },
    });
    if (clash) return res.status(400).json({ error: "That overlaps another period of time off for the same person." });

    const entry = await prisma.timeOff.update({ where: { id: existing.id }, data: { startDay, endDay, kind, note }, include: INCLUDE });
    await logActivity(req, {
      action: "timeoff.updated",
      entityType: "technician",
      entityId: entry.technicianId,
      summary: `${entry.technician.name} away ${startDay}${endDay !== startDay ? ` → ${endDay}` : ""} (updated)`,
    });
    res.json(entry);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

timeOffRouter.delete("/:id", requires("timeoff.delete"), async (req, res) => {
  const existing = await prisma.timeOff.findUnique({ where: { id: req.params.id }, include: INCLUDE });
  if (!existing) return res.status(404).json({ error: "not found" });
  await prisma.timeOff.delete({ where: { id: existing.id } });
  await logActivity(req, {
    action: "timeoff.deleted",
    entityType: "technician",
    entityId: existing.technicianId,
    summary: `${existing.technician.name} no longer away ${existing.startDay}${existing.endDay !== existing.startDay ? ` → ${existing.endDay}` : ""}`,
  });
  res.status(204).end();
});

/** Everyone away on a given day — what the boards and the day scheduler ask for. */
timeOffRouter.get("/on/:day", async (req, res) => {
  if (!DATE_ONLY.test(req.params.day)) return res.status(400).json({ error: "invalid day" });
  res.json(await timeOffBetween(req.params.day, req.params.day));
});
