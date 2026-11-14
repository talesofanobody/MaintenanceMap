import { Router } from "express";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { parseOptionalDay, parseOptionalString, ValidationError } from "../lib/validation";
import type { CalendarSpec } from "../lib/planning";

/**
 * Which days work actually happens on.
 *
 * Opt-in per property, and deliberately so. Creating a calendar changes every
 * float figure on that property's programmes — a job finishing Friday and the next
 * starting Monday had two days of slack when every day counted and has one when
 * Sunday is not worked — so it has to be something somebody decides, not something
 * that happens during a deploy. Without a calendar, durations carry on being
 * counted in calendar days exactly as before.
 *
 * A calendar with a null property is the fallback for properties that have none.
 */
export const calendarsRouter = Router();

const CALENDAR_INCLUDE = {
  property: { select: { id: true, name: true } },
  exceptions: { orderBy: { day: "asc" as const } },
} as const;

/** Monday first. A six-day week is the default, Sunday off. */
const DEFAULT_WEEK = [true, true, true, true, true, true, false];

function parseWorkingDays(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 7) {
    throw new ValidationError("Working days must be seven true/false values, Monday first.");
  }
  const week = value.map((v) => !!v);
  if (!week.some(Boolean)) throw new ValidationError("At least one day of the week has to be a working day.");
  return JSON.stringify(week);
}

/** The shape the schedule pass wants, built from stored rows. */
export function toSpec(calendar: { workingDays: string; exceptions: { day: string; working: boolean }[] }): CalendarSpec {
  let week: boolean[] = DEFAULT_WEEK;
  try {
    const parsed = JSON.parse(calendar.workingDays);
    if (Array.isArray(parsed) && parsed.length === 7) week = parsed.map((v) => !!v);
  } catch {
    // A corrupt row should not take the schedule down with it.
  }
  const exceptions: Record<string, boolean> = {};
  for (const e of calendar.exceptions) exceptions[e.day] = e.working;
  return { workingWeekdays: week, exceptions };
}

/**
 * The calendar in force for a property: its own, else the fallback, else none.
 *
 * Returning null rather than a seven-day default is the point — null means "count
 * calendar days", which is what an install with no calendar has always done.
 */
export async function calendarFor(propertyId: string | null): Promise<CalendarSpec | null> {
  const own = propertyId
    ? await prisma.workCalendar.findUnique({ where: { propertyId }, include: { exceptions: true } })
    : null;
  if (own) return toSpec(own);
  const fallback = await prisma.workCalendar.findFirst({ where: { propertyId: null }, include: { exceptions: true } });
  return fallback ? toSpec(fallback) : null;
}

calendarsRouter.get("/", async (_req, res) => {
  const calendars = await prisma.workCalendar.findMany({ include: CALENDAR_INCLUDE, orderBy: { createdAt: "asc" }, take: 200 });
  res.json(calendars);
});

/** What is actually in force for one property, fallback included. */
calendarsRouter.get("/for/:propertyId", async (req, res) => {
  const own = await prisma.workCalendar.findUnique({ where: { propertyId: req.params.propertyId }, include: CALENDAR_INCLUDE });
  if (own) return res.json({ calendar: own, inherited: false });
  const fallback = await prisma.workCalendar.findFirst({ where: { propertyId: null }, include: CALENDAR_INCLUDE });
  res.json({ calendar: fallback, inherited: !!fallback });
});

calendarsRouter.post("/", requires("settings.write"), async (req, res) => {
  try {
    const propertyId = typeof req.body.propertyId === "string" && req.body.propertyId ? req.body.propertyId : null;
    if (propertyId) {
      const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true } });
      if (!property) return res.status(400).json({ error: "That property does not exist." });
      const existing = await prisma.workCalendar.findUnique({ where: { propertyId }, select: { id: true } });
      if (existing) return res.status(400).json({ error: "That property already has a calendar." });
    } else {
      const existing = await prisma.workCalendar.findFirst({ where: { propertyId: null }, select: { id: true } });
      if (existing) return res.status(400).json({ error: "There is already a fallback calendar." });
    }

    const calendar = await prisma.workCalendar.create({
      data: {
        propertyId,
        name: parseOptionalString(req.body.name, "name", 120) ?? "Working days",
        workingDays: parseWorkingDays(req.body.workingDays) ?? JSON.stringify(DEFAULT_WEEK),
      },
      include: CALENDAR_INCLUDE,
    });

    await logActivity(req, {
      action: "calendar.created",
      entityType: "system",
      entityId: calendar.id,
      propertyId,
      summary: `Working calendar set for ${calendar.property?.name ?? "every property without one"} — float is now counted in working days`,
    });
    res.status(201).json(calendar);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

calendarsRouter.put("/:id", requires("settings.write"), async (req, res) => {
  const existing = await prisma.workCalendar.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not found" });
  try {
    const data: Record<string, unknown> = {};
    if (req.body.name !== undefined) data.name = parseOptionalString(req.body.name, "name", 120) ?? "Working days";
    const week = parseWorkingDays(req.body.workingDays);
    if (week !== undefined) data.workingDays = week;
    const calendar = await prisma.workCalendar.update({ where: { id: existing.id }, data, include: CALENDAR_INCLUDE });
    res.json(calendar);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/**
 * A day that goes against the weekly pattern.
 *
 * Both directions, because only one of them gets remembered. A public holiday or a
 * shutdown stops a normal working day; a Sunday worked to claw back a slipped pour
 * makes a non-working day working. A calendar that held only holidays would be
 * wrong on exactly the days a programme cares about.
 */
calendarsRouter.post("/:id/exceptions", requires("settings.write"), async (req, res) => {
  const calendar = await prisma.workCalendar.findUnique({ where: { id: req.params.id }, select: { id: true, propertyId: true } });
  if (!calendar) return res.status(404).json({ error: "not found" });
  try {
    // Through the shared helper, which round-trips the parse. Validating with
    // Date.parse alone is not enough: "2027-02-30" parses happily and rolls over
    // to 2 March, so a holiday would be stored on a day that does not exist while
    // every sum treated it as a different one.
    const day = parseOptionalDay(typeof req.body.day === "string" ? req.body.day.trim() : req.body.day, "day");
    if (!day) return res.status(400).json({ error: "A date like 2027-01-01 is needed." });

    const working = req.body.working === true;
    const exception = await prisma.calendarException.upsert({
      where: { calendarId_day: { calendarId: calendar.id, day } },
      create: {
        calendarId: calendar.id,
        day,
        working,
        reason: parseOptionalString(req.body.reason, "reason", 200) ?? null,
      },
      update: { working, reason: parseOptionalString(req.body.reason, "reason", 200) ?? null },
    });

    await logActivity(req, {
      action: "calendar.exception_set",
      entityType: "system",
      entityId: calendar.id,
      propertyId: calendar.propertyId,
      summary: `${day} marked as ${working ? "worked" : "not worked"}${exception.reason ? ` — ${exception.reason}` : ""}`,
    });
    const fresh = await prisma.workCalendar.findUnique({ where: { id: calendar.id }, include: CALENDAR_INCLUDE });
    res.status(201).json(fresh);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

calendarsRouter.delete("/:id/exceptions/:exceptionId", requires("settings.write"), async (req, res) => {
  const exception = await prisma.calendarException.findUnique({ where: { id: req.params.exceptionId } });
  if (!exception || exception.calendarId !== req.params.id) return res.status(404).json({ error: "not found" });
  await prisma.calendarException.delete({ where: { id: exception.id } });
  const fresh = await prisma.workCalendar.findUnique({ where: { id: req.params.id }, include: CALENDAR_INCLUDE });
  res.json(fresh);
});

/** Removing a calendar puts that property back to counting every day. */
calendarsRouter.delete("/:id", requires("settings.write"), async (req, res) => {
  const calendar = await prisma.workCalendar.findUnique({ where: { id: req.params.id }, include: { property: { select: { name: true } } } });
  if (!calendar) return res.status(404).json({ error: "not found" });
  await prisma.workCalendar.delete({ where: { id: calendar.id } });
  await logActivity(req, {
    action: "calendar.deleted",
    entityType: "system",
    entityId: calendar.id,
    propertyId: calendar.propertyId,
    summary: `Working calendar removed from ${calendar.property?.name ?? "the fallback"} — back to counting every day`,
  });
  res.status(204).end();
});
