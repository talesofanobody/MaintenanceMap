import { Router } from "express";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { DATE_ONLY, dayFrom, ValidationError } from "../lib/validation";
import { OPEN_STATUSES } from "../lib/workflow";
import { parseStoredList } from "../lib/taxonomy";
import { TimeOffCalendar } from "../lib/timeoff";
import { adminUserIds, notifyUsers, technicianUserId } from "../lib/notify";
import { syncAssignees } from "../lib/crew";
import { ASSUMED_HOURS, DAY_JOB_SELECT, insertEmergency, layOutDay, moveIssue, shiftHours, shiftOn } from "../lib/dayplan";

export const scheduleRouter = Router();

function dayParam(value: unknown): string {
  return typeof value === "string" && DATE_ONLY.test(value) ? value : dayFrom(new Date(), 0);
}

/**
 * One day, every technician, in order — the board the drag-and-drop view is built on.
 * Also hands back the work that has no home yet, which is what gets dragged in.
 */
scheduleRouter.get("/", async (req, res) => {
  const day = dayParam(req.query.day);

  const [technicians, calendar] = await Promise.all([
    prisma.technician.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        trade: true,
        color: true,
        categories: true,
        weeklyHours: true,
        issues: {
          where: { scheduledFor: day, status: { in: OPEN_STATUSES } },
          select: DAY_JOB_SELECT,
          orderBy: [{ dayOrder: "asc" }, { createdAt: "asc" }],
        },
      },
    }),
    TimeOffCalendar.forWindow(day, day),
  ]);

  const rows = technicians.map((t) => {
    const off = calendar.on(t.id, day);
    const shift = off ? null : shiftOn(t.weeklyHours, day);
    const jobs = layOutDay(t.issues, shift);
    const booked = jobs.reduce((sum, j) => sum + j.hours, 0);
    const capacity = shiftHours(shift);
    return {
      id: t.id,
      name: t.name,
      trade: t.trade,
      color: t.color,
      categories: parseStoredList(t.categories),
      shift,
      timeOff: off ? { kind: off.kind, note: off.note, startDay: off.startDay, endDay: off.endDay } : null,
      capacityHours: capacity,
      bookedHours: Math.round(booked * 100) / 100,
      freeHours: Math.round(Math.max(0, capacity - booked) * 100) / 100,
      jobs: jobs.map((j) => ({ ...j, property: j.property.name, propertyId: j.property.id })),
    };
  });

  // Anything open and unassigned, plus work already dated for this day but on nobody.
  const unassigned = await prisma.issue.findMany({
    where: { status: { in: OPEN_STATUSES }, technicianId: null },
    select: DAY_JOB_SELECT,
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take: 100,
  });

  res.json({
    day,
    technicians: rows,
    // These haven't been laid out into anyone's day, but the card still shows how long
    // they are expected to take.
    unassigned: unassigned.map((j) => ({
      ...j,
      property: j.property.name,
      propertyId: j.property.id,
      hours: j.estimatedHours && j.estimatedHours > 0 ? j.estimatedHours : ASSUMED_HOURS,
      plannedStart: null,
      plannedEnd: null,
    })),
    generatedAt: new Date().toISOString(),
  });
});

/**
 * Drops an issue onto a technician's day at a position — the write behind every drag.
 * Passing no day sends it back to the unassigned column.
 */
scheduleRouter.put("/assign", requires("issue.assign"), async (req, res) => {
  const issueId = typeof req.body.issueId === "string" ? req.body.issueId : "";
  if (!issueId) return res.status(400).json({ error: "issueId is required" });
  const technicianId = req.body.technicianId ? String(req.body.technicianId) : null;
  const day = req.body.day === null || req.body.day === undefined ? null : dayParam(req.body.day);
  const position = req.body.position === undefined || req.body.position === null ? null : Number(req.body.position);

  const issue = await prisma.issue.findUnique({ where: { id: issueId }, select: { id: true, title: true, propertyId: true, technicianId: true, scheduledFor: true } });
  if (!issue) return res.status(404).json({ error: "issue not found" });

  if (technicianId) {
    const tech = await prisma.technician.findUnique({ where: { id: technicianId }, select: { id: true, name: true, active: true } });
    if (!tech) return res.status(404).json({ error: "technician not found" });
    if (!tech.active) return res.status(400).json({ error: `${tech.name} is not an active technician.` });
    // Booking someone onto a day they are away is nearly always a mistake, so it is
    // refused rather than quietly accepted.
    if (day) {
      const calendar = await TimeOffCalendar.forWindow(day, day);
      const off = calendar.on(technicianId, day);
      if (off) return res.status(400).json({ error: `${tech.name} is away on ${day} (${off.kind}). Pick another day or another technician.` });
    }
  }

  try {
    await moveIssue({ issueId, technicianId, day, position });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
  // The lead is whoever the job is booked to; keep the crew table in step.
  if (technicianId) await syncAssignees(issueId, [technicianId]);
  else await syncAssignees(issueId, []);

  const after = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { ...DAY_JOB_SELECT, technician: { select: { id: true, name: true } } },
  });

  await logActivity(req, {
    action: "issue.scheduled",
    entityType: "issue",
    entityId: issueId,
    issueId,
    propertyId: issue.propertyId,
    summary: day
      ? `"${issue.title}" booked for ${day}${after?.technician ? ` · ${after.technician.name}` : " · unassigned"}`
      : `"${issue.title}" put back in the backlog`,
  });

  if (technicianId && technicianId !== issue.technicianId) {
    await notifyUsers([await technicianUserId(technicianId)], {
      kind: "assigned",
      title: `New job: ${issue.title}`,
      body: day ? `Scheduled for ${day}` : "Assigned to you",
      issueId,
      propertyId: issue.propertyId,
    }, req.user!.id);
  }

  res.json(after);
});

/**
 * Slots an emergency into a technician's day. Everything behind it moves one place
 * later and remembers where it was, so closing the emergency puts the day back.
 */
scheduleRouter.post("/emergency", requires("issue.assign"), async (req, res) => {
  const issueId = typeof req.body.issueId === "string" ? req.body.issueId : "";
  const technicianId = typeof req.body.technicianId === "string" ? req.body.technicianId : "";
  if (!issueId || !technicianId) return res.status(400).json({ error: "issueId and technicianId are required" });
  const day = dayParam(req.body.day);
  const position = req.body.position === undefined ? 0 : Number(req.body.position);

  const [issue, tech] = await Promise.all([
    prisma.issue.findUnique({ where: { id: issueId }, select: { id: true, title: true, propertyId: true, status: true } }),
    prisma.technician.findUnique({ where: { id: technicianId }, select: { id: true, name: true, active: true } }),
  ]);
  if (!issue) return res.status(404).json({ error: "issue not found" });
  if (!tech) return res.status(404).json({ error: "technician not found" });
  if (!OPEN_STATUSES.includes(issue.status as any)) return res.status(400).json({ error: "That issue is already closed." });

  const { displaced } = await insertEmergency({ issueId, technicianId, day, position: Number.isFinite(position) ? position : 0 });
  await syncAssignees(issueId, [technicianId]);

  await logActivity(req, {
    action: "issue.emergency",
    entityType: "issue",
    entityId: issueId,
    issueId,
    propertyId: issue.propertyId,
    summary: `"${issue.title}" slotted in as an emergency for ${tech.name} on ${day}, pushing back ${displaced} job${displaced === 1 ? "" : "s"}`,
  });

  const meta = { issueId, propertyId: issue.propertyId };
  await notifyUsers([await technicianUserId(technicianId)], {
    ...meta,
    kind: "assigned",
    title: `Emergency: ${issue.title}`,
    body: `Go to this first — the rest of your day has moved back.`,
  }, req.user!.id);
  await notifyUsers(await adminUserIds(), {
    ...meta,
    kind: "priority",
    title: `Emergency slotted in for ${tech.name}`,
    body: `${issue.title} · ${displaced} job${displaced === 1 ? "" : "s"} pushed back`,
  }, req.user!.id);

  res.json({ displaced, day, technicianId });
});

/**
 * Where each technician probably is right now: the job they are clocked into, or the
 * last one they worked today. It is an informed guess from work records, not tracking —
 * the app never asks anyone's phone where they are, and the answer says how old it is.
 */
scheduleRouter.get("/locations", async (_req, res) => {
  const now = new Date();
  const today = dayFrom(now, 0);
  const since = new Date(now.getTime() - 12 * 3600_000);

  const technicians = await prisma.technician.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, trade: true, color: true },
  });

  // One query for the recent clock-ins rather than one per technician.
  const entries = await prisma.timeEntry.findMany({
    where: { OR: [{ endedAt: null }, { startedAt: { gte: since } }] },
    orderBy: { startedAt: "desc" },
    select: {
      technicianId: true,
      startedAt: true,
      endedAt: true,
      issue: { select: { id: true, title: true, lat: true, lng: true, roomName: true, status: true, property: { select: { id: true, name: true } } } },
    },
  });

  const calendar = await TimeOffCalendar.forWindow(today, today);
  const byTech = new Map<string, (typeof entries)[number][]>();
  for (const entry of entries) {
    const list = byTech.get(entry.technicianId) ?? [];
    list.push(entry);
    byTech.set(entry.technicianId, list);
  }

  const located = technicians.map((t) => {
    const off = calendar.on(t.id, today);
    const mine = byTech.get(t.id) ?? [];
    const open = mine.find((e) => !e.endedAt);
    const last = mine.find((e) => e.endedAt);
    const source = open ?? last;
    return {
      id: t.id,
      name: t.name,
      trade: t.trade,
      color: t.color,
      timeOff: off ? { kind: off.kind } : null,
      // "working" means clocked in right now; "last seen" is where they finished up.
      state: off ? "away" : open ? "working" : last ? "last_seen" : "unknown",
      lat: source?.issue.lat ?? null,
      lng: source?.issue.lng ?? null,
      issue: source
        ? { id: source.issue.id, title: source.issue.title, roomName: source.issue.roomName, property: source.issue.property.name, propertyId: source.issue.property.id }
        : null,
      since: (open?.startedAt ?? last?.endedAt ?? null)?.toISOString() ?? null,
      /** Minutes since that clock event, so the view can fade a stale pin. */
      ageMinutes: source ? Math.round((now.getTime() - (open?.startedAt ?? last!.endedAt!).getTime()) / 60000) : null,
    };
  });

  res.json({ technicians: located, generatedAt: now.toISOString(), assumedHours: ASSUMED_HOURS });
});
