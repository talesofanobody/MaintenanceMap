import { prisma } from "../db";
import { dayFrom, DATE_ONLY } from "./validation";
import { adminUserIds, issueLine, notifyUsers, technicianUserId } from "./notify";
import { logActivity } from "./activity";
import { syncAssignees } from "./crew";

export const UNITS = new Set(["days", "weeks", "months"]);

export function parseChecklist(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function serializeSchedule<T extends { checklist: string }>(s: T) {
  return { ...s, checklist: parseChecklist(s.checklist) };
}

/** The next occurrence after `day`: keeps the day-of-month for monthly cadences (clamped to month length). */
export function advanceDay(day: string, every: number, unit: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (unit === "months") {
    const target = new Date(Date.UTC(y, m - 1 + every, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, lastDay));
    return target.toISOString().slice(0, 10);
  }
  const days = unit === "weeks" ? every * 7 : every;
  return dayFrom(new Date(Date.UTC(y, m - 1, d)), days);
}

export function cadenceText(every: number, unit: string): string {
  const one = unit === "days" ? "day" : unit === "weeks" ? "week" : "month";
  return every === 1 ? `Every ${one}` : `Every ${every} ${one}s`;
}

/**
 * Creates the issue for one schedule occurrence and moves the schedule on to its next
 * due date. Skips (returns null) if an open issue for that due date already exists.
 */
export async function createOccurrence(scheduleId: string, opts: { force?: boolean; actor?: string | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const today = dayFrom(now, 0);
  const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId }, include: { property: { select: { name: true } } } });
  if (!schedule) return null;
  if (!DATE_ONLY.test(schedule.nextDue)) return null;

  const [y, m, d] = schedule.nextDue.split("-").map(Number);
  const createFrom = dayFrom(new Date(Date.UTC(y, m - 1, d)), -schedule.leadDays);
  if (!opts.force && createFrom > today) return null;

  const existing = await prisma.issue.findFirst({ where: { scheduleId: schedule.id, dueDate: schedule.nextDue } });
  if (existing) {
    // Already generated; just make sure the schedule has moved on.
    await prisma.schedule.update({ where: { id: schedule.id }, data: { nextDue: advanceDay(schedule.nextDue, schedule.every, schedule.unit) } });
    return null;
  }

  const items = parseChecklist(schedule.checklist);
  const issue = await prisma.issue.create({
    data: {
      propertyId: schedule.propertyId,
      title: schedule.title,
      description: schedule.description,
      actionNeeded: schedule.actionNeeded,
      priority: schedule.priority,
      category: schedule.category,
      roomName: schedule.roomName,
      technicianId: schedule.technicianId,
      estimatedHours: schedule.estimatedHours,
      lat: schedule.lat,
      lng: schedule.lng,
      scheduledFor: createFrom < today ? today : createFrom,
      dueDate: schedule.nextDue,
      scheduleId: schedule.id,
      checklist: { create: items.map((text, position) => ({ text, position })) },
    },
    include: { technician: { select: { name: true } } },
  });
  // The generated job has a lead, so it needs the crew row to match.
  if (schedule.technicianId) await syncAssignees(issue.id, [schedule.technicianId]);
  await prisma.schedule.update({
    where: { id: schedule.id },
    data: { nextDue: advanceDay(schedule.nextDue, schedule.every, schedule.unit), lastCreatedAt: now },
  });

  await logActivity(null, {
    action: "issue.created",
    entityType: "issue",
    entityId: issue.id,
    issueId: issue.id,
    propertyId: issue.propertyId,
    summary: `Scheduled maintenance "${issue.title}" created from "${schedule.title}" (${cadenceText(schedule.every, schedule.unit).toLowerCase()}, due ${issue.dueDate})`,
  });
  const line = issueLine(issue, schedule.property.name);
  const techUser = await technicianUserId(issue.technicianId);
  const meta = { issueId: issue.id, propertyId: issue.propertyId };
  if (techUser) {
    await notifyUsers([techUser], { ...meta, kind: "assigned", title: `Scheduled job: ${issue.title}`, body: line }, opts.actor ?? null);
  } else {
    await notifyUsers(await adminUserIds(), { ...meta, kind: "unassigned", title: `Scheduled job needs a technician: ${issue.title}`, body: line }, opts.actor ?? null);
  }
  return issue;
}

/** Called by the scheduler: creates issues for every schedule whose lead time has begun. */
export async function generateDueOccurrences(now = new Date()): Promise<number> {
  const today = dayFrom(now, 0);
  const schedules = await prisma.schedule.findMany({ where: { active: true }, select: { id: true, nextDue: true, leadDays: true } });
  let created = 0;
  for (const s of schedules) {
    if (!DATE_ONLY.test(s.nextDue)) continue;
    const [y, m, d] = s.nextDue.split("-").map(Number);
    if (dayFrom(new Date(Date.UTC(y, m - 1, d)), -s.leadDays) > today) continue;
    const issue = await createOccurrence(s.id, { now });
    if (issue) created += 1;
  }
  return created;
}
