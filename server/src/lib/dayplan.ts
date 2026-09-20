import { prisma } from "../db";
import { minutesOf, parseWeek, shiftHours, type Shift } from "./shifts";
import { OPEN_STATUSES } from "./workflow";
import { ValidationError } from "./validation";

/** A job with no estimate still takes time; assume an hour so the day adds up. */
export const ASSUMED_HOURS = 1;

export const DAY_JOB_SELECT = {
  id: true,
  title: true,
  priority: true,
  status: true,
  category: true,
  roomName: true,
  estimatedHours: true,
  dayOrder: true,
  isEmergency: true,
  shiftedBy: true,
  dueAt: true,
  dueDate: true,
  scheduledFor: true,
  technicianId: true,
  lat: true,
  lng: true,
  property: { select: { id: true, name: true } },
} as const;

export interface PlannedJob {
  id: string;
  title: string;
  dayOrder: number;
  isEmergency: boolean;
  /** "HH:MM" where this job is expected to start and finish, laid end to end from the shift start. */
  plannedStart: string | null;
  plannedEnd: string | null;
  hours: number;
  [key: string]: unknown;
}

/** Wraps past midnight rather than clamping, so a night shift's jobs read sensibly. */
function clock(minutes: number): string {
  const wrapped = ((Math.round(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/**
 * Walks a technician's jobs in order from the start of their shift, giving each one a
 * start and end time. This is what makes the day view a timeline rather than a list,
 * and it is also why inserting an emergency visibly pushes everything after it later.
 */
export function layOutDay<T extends { id: string; dayOrder: number | null; estimatedHours: number | null }>(
  jobs: T[],
  shift: Shift | null
): (T & { plannedStart: string | null; plannedEnd: string | null; hours: number })[] {
  const ordered = [...jobs].sort((a, b) => (a.dayOrder ?? 9999) - (b.dayOrder ?? 9999) || a.id.localeCompare(b.id));
  let cursor = shift ? minutesOf(shift.start) : null;
  // Measured from the start of the shift, so an overnight end is a larger number
  // rather than a smaller one and "overruns" still means what it says.
  const endOfShift = shift ? minutesOf(shift.start) + shiftHours(shift) * 60 : null;

  return ordered.map((job) => {
    const hours = job.estimatedHours && job.estimatedHours > 0 ? job.estimatedHours : ASSUMED_HOURS;
    if (cursor === null) return { ...job, plannedStart: null, plannedEnd: null, hours };
    const start = cursor;
    const end = start + hours * 60;
    cursor = end;
    return {
      ...job,
      plannedStart: clock(start),
      plannedEnd: clock(end),
      // A job running past the end of the shift still gets a time; the view marks it.
      hours,
      overrunsShift: endOfShift !== null && end > endOfShift,
    } as T & { plannedStart: string | null; plannedEnd: string | null; hours: number };
  });
}

/** The jobs booked into one technician's day, in order. */
export async function jobsForDay(technicianId: string, day: string) {
  return prisma.issue.findMany({
    where: { technicianId, scheduledFor: day, status: { in: OPEN_STATUSES } },
    select: DAY_JOB_SELECT,
    orderBy: [{ dayOrder: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Renumbers a technician's day 0,1,2… so positions stay dense after a move. Called
 * after every change, because gaps make "insert at position 2" ambiguous.
 */
export async function renumber(technicianId: string | null, day: string): Promise<void> {
  if (!technicianId) return;
  const jobs = await prisma.issue.findMany({
    where: { technicianId, scheduledFor: day, status: { in: OPEN_STATUSES } },
    select: { id: true, dayOrder: true, createdAt: true },
    orderBy: [{ dayOrder: "asc" }, { createdAt: "asc" }],
  });
  for (const [index, job] of jobs.entries()) {
    if (job.dayOrder !== index) await prisma.issue.update({ where: { id: job.id }, data: { dayOrder: index } });
  }
}

/**
 * Moves an issue onto (or off) a technician's day at a given position, closing the gap
 * it left behind and opening one where it lands.
 */
export async function moveIssue(opts: {
  issueId: string;
  technicianId: string | null;
  day: string | null;
  position?: number | null;
}): Promise<void> {
  const issue = await prisma.issue.findUnique({
    where: { id: opts.issueId },
    select: { id: true, technicianId: true, scheduledFor: true, dayOrder: true },
  });
  if (!issue) throw new ValidationError("issue not found");

  const from = { technicianId: issue.technicianId, day: issue.scheduledFor };

  if (!opts.day) {
    // Back to the backlog: it has no day and no place in one.
    await prisma.issue.update({ where: { id: issue.id }, data: { scheduledFor: null, dayOrder: null, technicianId: opts.technicianId } });
    await renumber(from.technicianId, from.day ?? "");
    return;
  }

  const siblings = await prisma.issue.findMany({
    where: {
      technicianId: opts.technicianId,
      scheduledFor: opts.day,
      status: { in: OPEN_STATUSES },
      id: { not: issue.id },
    },
    select: { id: true },
    orderBy: [{ dayOrder: "asc" }, { createdAt: "asc" }],
  });

  const target = Math.max(0, Math.min(opts.position ?? siblings.length, siblings.length));
  const ids = siblings.map((s) => s.id);
  ids.splice(target, 0, issue.id);

  await prisma.issue.update({
    where: { id: issue.id },
    data: { technicianId: opts.technicianId, scheduledFor: opts.day, dayOrder: target },
  });
  for (const [index, id] of ids.entries()) {
    await prisma.issue.update({ where: { id }, data: { dayOrder: index } });
  }

  // The day it came from now has a hole in it.
  if (from.day && (from.technicianId !== opts.technicianId || from.day !== opts.day)) {
    await renumber(from.technicianId, from.day);
  }
}

/**
 * Drops an emergency into a technician's day and pushes the rest back one place.
 *
 * Each displaced job remembers where it was and which emergency moved it, so closing
 * the emergency puts the day back exactly as it was — a straight linear shift, not a
 * reshuffle that loses the order someone thought about.
 */
export async function insertEmergency(opts: { issueId: string; technicianId: string; day: string; position?: number }): Promise<{ displaced: number }> {
  const existing = await prisma.issue.findMany({
    where: { technicianId: opts.technicianId, scheduledFor: opts.day, status: { in: OPEN_STATUSES }, id: { not: opts.issueId } },
    select: { id: true, dayOrder: true, shiftedBy: true, orderBeforeShift: true },
    orderBy: [{ dayOrder: "asc" }, { createdAt: "asc" }],
  });

  const at = Math.max(0, Math.min(opts.position ?? 0, existing.length));
  let displaced = 0;

  for (const [index, job] of existing.entries()) {
    const nextOrder = index < at ? index : index + 1;
    // Only record the original slot the first time something is pushed; a second
    // emergency must not overwrite where the job really belonged.
    const remember = index >= at && job.shiftedBy === null;
    if (index >= at) displaced += 1;
    await prisma.issue.update({
      where: { id: job.id },
      data: {
        dayOrder: nextOrder,
        ...(remember ? { shiftedBy: opts.issueId, orderBeforeShift: job.dayOrder ?? index } : {}),
      },
    });
  }

  await prisma.issue.update({
    where: { id: opts.issueId },
    data: { technicianId: opts.technicianId, scheduledFor: opts.day, dayOrder: at, isEmergency: true },
  });

  return { displaced };
}

/**
 * The emergency is done, so everything it pushed back goes where it was. Called when an
 * emergency is completed or cancelled — the day returns to the plan somebody made.
 */
export async function releaseEmergency(emergencyIssueId: string): Promise<number> {
  const shifted = await prisma.issue.findMany({
    where: { shiftedBy: emergencyIssueId },
    select: { id: true, orderBeforeShift: true, technicianId: true, scheduledFor: true },
  });
  if (!shifted.length) return 0;

  for (const job of shifted) {
    await prisma.issue.update({
      where: { id: job.id },
      data: { dayOrder: job.orderBeforeShift, shiftedBy: null, orderBeforeShift: null },
    });
  }
  // Close any gap the emergency itself left behind.
  const days = new Set(shifted.filter((j) => j.scheduledFor).map((j) => `${j.technicianId}|${j.scheduledFor}`));
  for (const key of days) {
    const [technicianId, day] = key.split("|");
    await renumber(technicianId === "null" ? null : technicianId, day);
  }
  return shifted.length;
}

/** Where a technician's shift puts them on a given weekday (Monday first). */
export function shiftOn(weeklyHours: string, day: string): Shift | null {
  const week = parseWeek(weeklyHours);
  const [y, m, d] = day.split("-").map(Number);
  const index = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return week[index] ?? null;
}

export { shiftHours };
