import { prisma } from "../db";
import { dayFrom, daysBetween } from "./validation";
import { parseWeek, weekToHours } from "./shifts";

const SEVERITY: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
/** Planning figure for a job with no estimate, so a day can still be filled sensibly. */
export const ASSUMED_HOURS = 1;

export interface PlanStop {
  issue: any;
  hours: number;
  assumedHours: boolean;
  /** Metres from the previous stop (0 for the first). */
  travelMetres: number;
  reason: string;
}

export interface DayPlan {
  day: string;
  technicianId: string;
  capacityHours: number;
  /** Hours already committed by jobs pinned to this day. */
  plannedHours: number;
  stops: PlanStop[];
  /** Candidates that didn't fit, in the order they were considered. */
  leftOver: { issue: any; hours: number; reason: string }[];
}

export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

function capacityFor(weeklyHours: string, day: string): number {
  const hours = weekToHours(parseWeek(weeklyHours));
  const [y, m, d] = day.split("-").map(Number);
  // Monday-first index, matching how work hours are entered.
  const idx = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return hours[idx] ?? 0;
}

function why(issue: any, day: string): string {
  if (issue.dueDate && issue.dueDate < day) return `Overdue since ${issue.dueDate}`;
  if (issue.dueDate === day) return "Due today";
  if (issue.scheduledFor === day) return "Already scheduled for this day";
  if (issue.dueDate) {
    const left = daysBetween(day, issue.dueDate);
    return `${issue.priority} priority · due in ${left} day${left === 1 ? "" : "s"}`;
  }
  return `${issue.priority} priority · no due date`;
}

function urgencyScore(issue: any, day: string): number {
  const severity = SEVERITY[issue.priority] ?? 2;
  if (issue.dueDate && issue.dueDate < day) return -1000 + severity;
  if (issue.dueDate === day) return -500 + severity;
  const daysOut = issue.dueDate ? daysBetween(day, issue.dueDate) : 60;
  return severity * 10 + Math.min(daysOut, 60);
}

/**
 * Builds one technician's day: jobs already pinned to that day first, then the most
 * urgent remaining work, preferring stops close to where they already are, until the
 * day's hours run out.
 */
export async function planDay(technicianId: string, day: string, opts: { propertyId?: string; horizonDays?: number } = {}): Promise<DayPlan | null> {
  const technician = await prisma.technician.findUnique({ where: { id: technicianId } });
  if (!technician) return null;
  const horizon = dayFrom(new Date(`${day}T00:00:00Z`), opts.horizonDays ?? 14);

  const candidates = await prisma.issue.findMany({
    where: {
      status: { not: "completed" },
      ...(opts.propertyId ? { propertyId: opts.propertyId } : {}),
      OR: [{ technicianId }, { technicianId: null }],
      // Anything pinned to this day, plus work due (or startable) within the horizon.
      AND: [
        {
          OR: [
            { scheduledFor: day },
            { scheduledFor: null, dueDate: { lte: horizon } },
            { scheduledFor: { lte: horizon }, dueDate: { lte: horizon } },
            { dueDate: null, scheduledFor: null },
          ],
        },
      ],
    },
    include: {
      property: { select: { id: true, name: true } },
      technician: { select: { id: true, name: true, color: true } },
      checklist: { select: { done: true } },
    },
  });

  // Jobs already pinned to this day are kept, in urgency order, and count against capacity.
  const pinned = candidates.filter((i) => i.scheduledFor === day).sort((a, b) => urgencyScore(a, day) - urgencyScore(b, day));
  const pool = candidates.filter((i) => i.scheduledFor !== day).sort((a, b) => urgencyScore(a, day) - urgencyScore(b, day));

  const capacityHours = capacityFor(technician.weeklyHours, day);
  const stops: PlanStop[] = [];
  let used = 0;
  let last: { lat: number; lng: number } | null = null;

  const push = (issue: any, reason: string) => {
    const hours = issue.estimatedHours ?? ASSUMED_HOURS;
    stops.push({
      issue,
      hours,
      assumedHours: issue.estimatedHours == null,
      travelMetres: last ? metresBetween(last, issue) : 0,
      reason,
    });
    used += hours;
    last = { lat: issue.lat, lng: issue.lng };
  };

  for (const issue of pinned) push(issue, why(issue, day));
  const plannedHours = used;

  const leftOver: DayPlan["leftOver"] = [];
  const remaining = [...pool];
  while (remaining.length > 0) {
    // Among the most urgent candidates still in play, take the nearest to the last stop.
    const bestScore = Math.min(...remaining.map((i) => urgencyScore(i, day)));
    // "Close enough in urgency" = same bucket of 10 points, so proximity can break ties
    // without ever letting a routine job jump ahead of overdue or due-today work.
    const tier = remaining.filter((i) => urgencyScore(i, day) <= bestScore + 9);
    let choice = tier[0];
    if (last) {
      let bestDistance = Infinity;
      for (const issue of tier) {
        const d = metresBetween(last, issue);
        if (d < bestDistance) {
          bestDistance = d;
          choice = issue;
        }
      }
    }
    remaining.splice(remaining.indexOf(choice), 1);
    const hours = choice.estimatedHours ?? ASSUMED_HOURS;
    if (used + hours > capacityHours) {
      leftOver.push({ issue: choice, hours, reason: `Doesn't fit — ${hours}h left to place, ${Math.max(0, Math.round((capacityHours - used) * 100) / 100)}h free` });
      continue;
    }
    const near = last && metresBetween(last, choice) < 30 ? " · same spot as the previous job" : "";
    push(choice, why(choice, day) + near);
  }

  return { day, technicianId, capacityHours, plannedHours, stops, leftOver };
}
