import { prisma } from "../db";
import { DATE_ONLY, ValidationError } from "./validation";

export const TIME_OFF_KINDS = ["vacation", "sick", "training", "other"] as const;
export type TimeOffKind = (typeof TIME_OFF_KINDS)[number];

export const TIME_OFF_WORDS: Record<TimeOffKind, string> = {
  vacation: "Vacation",
  sick: "Sick leave",
  training: "Training",
  other: "Away",
};

export function parseKind(value: unknown): TimeOffKind {
  if (value === undefined || value === null || value === "") return "vacation";
  if (typeof value !== "string" || !(TIME_OFF_KINDS as readonly string[]).includes(value)) {
    throw new ValidationError("unknown kind of time off");
  }
  return value as TimeOffKind;
}

export function parseRange(startDay: unknown, endDay: unknown): { startDay: string; endDay: string } {
  if (typeof startDay !== "string" || !DATE_ONLY.test(startDay)) throw new ValidationError("invalid start day (expected YYYY-MM-DD)");
  // A single day off is the common case, so the end defaults to the start.
  const end = endDay === undefined || endDay === null || endDay === "" ? startDay : endDay;
  if (typeof end !== "string" || !DATE_ONLY.test(end)) throw new ValidationError("invalid end day (expected YYYY-MM-DD)");
  if (end < startDay) throw new ValidationError("Time off can't end before it starts.");
  return { startDay, endDay: end };
}

export interface TimeOffSpan {
  id: string;
  technicianId: string;
  startDay: string;
  endDay: string;
  kind: string;
  note: string | null;
}

/**
 * Time off touching a window of days. Ranges are inclusive at both ends, so an overlap
 * is "starts on or before the last day and ends on or after the first".
 */
export async function timeOffBetween(fromDay: string, toDay: string, technicianId?: string): Promise<TimeOffSpan[]> {
  return prisma.timeOff.findMany({
    where: {
      ...(technicianId ? { technicianId } : {}),
      startDay: { lte: toDay },
      endDay: { gte: fromDay },
    },
    orderBy: { startDay: "asc" },
    select: { id: true, technicianId: true, startDay: true, endDay: true, kind: true, note: true },
  });
}

/**
 * A lookup of "is this person off on this day", built once for a window rather than
 * queried per person per day.
 */
export class TimeOffCalendar {
  private byTechnician = new Map<string, TimeOffSpan[]>();

  constructor(spans: TimeOffSpan[]) {
    for (const span of spans) {
      const list = this.byTechnician.get(span.technicianId) ?? [];
      list.push(span);
      this.byTechnician.set(span.technicianId, list);
    }
  }

  static async forWindow(fromDay: string, toDay: string): Promise<TimeOffCalendar> {
    return new TimeOffCalendar(await timeOffBetween(fromDay, toDay));
  }

  /** The time off covering this day, or null when they're available. */
  on(technicianId: string, day: string): TimeOffSpan | null {
    const spans = this.byTechnician.get(technicianId);
    if (!spans) return null;
    return spans.find((s) => s.startDay <= day && s.endDay >= day) ?? null;
  }

  isOff(technicianId: string, day: string): boolean {
    return this.on(technicianId, day) !== null;
  }
}

/** Whether one technician is off on one day — for the cases that only need that. */
export async function isOffOn(technicianId: string, day: string): Promise<boolean> {
  const row = await prisma.timeOff.findFirst({
    where: { technicianId, startDay: { lte: day }, endDay: { gte: day } },
    select: { id: true },
  });
  return !!row;
}
