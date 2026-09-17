import { ValidationError } from "./validation";

/** A working day: when the technician starts and finishes. `null` means a day off. */
export interface Shift {
  start: string; // "HH:MM", 24-hour
  end: string;
}

export type Week = (Shift | null)[]; // 7 entries, Monday first

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function minutesOf(time: string): number {
  const m = TIME.exec(time);
  if (!m) throw new ValidationError(`invalid time "${time}" (expected HH:MM)`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function shiftHours(shift: Shift | null): number {
  if (!shift) return 0;
  const span = minutesOf(shift.end) - minutesOf(shift.start);
  return span > 0 ? Math.round((span / 60) * 100) / 100 : 0;
}

function hoursToShift(hours: number): Shift | null {
  if (!hours || hours <= 0) return null;
  const capped = Math.min(24, hours);
  const endMinutes = 8 * 60 + Math.round(capped * 60);
  const end = Math.min(24 * 60 - 1, endMinutes);
  return { start: "08:00", end: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` };
}

export const DEFAULT_WEEK: Week = [
  { start: "08:00", end: "16:00" },
  { start: "08:00", end: "16:00" },
  { start: "08:00", end: "16:00" },
  { start: "08:00", end: "16:00" },
  { start: "08:00", end: "16:00" },
  null,
  null,
];

/**
 * Reads the stored week in either shape: the original array of 7 hour counts, or the
 * current array of shift objects. Anything unreadable falls back to a standard week.
 */
export function parseWeek(stored: string): Week {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return DEFAULT_WEEK.map((s) => (s ? { ...s } : null));
  }
  if (!Array.isArray(parsed) || parsed.length !== 7) return DEFAULT_WEEK.map((s) => (s ? { ...s } : null));

  return parsed.map((entry) => {
    if (entry == null) return null;
    if (typeof entry === "number") return hoursToShift(entry);
    if (typeof entry === "object" && typeof (entry as any).start === "string" && typeof (entry as any).end === "string") {
      const shift = { start: (entry as any).start, end: (entry as any).end };
      try {
        return shiftHours(shift) > 0 ? shift : null;
      } catch {
        return null;
      }
    }
    return null;
  });
}

export function weekToHours(week: Week): number[] {
  return week.map(shiftHours);
}

/** Validates a week sent by the client, accepting both shapes so older callers still work. */
export function parseWeekInput(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 7) throw new ValidationError("working week must have 7 entries (Monday first)");
  const week: Week = value.map((entry) => {
    if (entry == null || entry === 0 || entry === "") return null;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry) || entry < 0 || entry > 24) throw new ValidationError("hours must be between 0 and 24");
      return hoursToShift(entry);
    }
    if (typeof entry === "object") {
      const start = (entry as any).start;
      const end = (entry as any).end;
      if (typeof start !== "string" || typeof end !== "string") throw new ValidationError("each working day needs a start and end time");
      if (minutesOf(end) <= minutesOf(start)) throw new ValidationError(`a shift ending ${end} can't start at ${start}`);
      return { start, end };
    }
    throw new ValidationError("invalid working day");
  });
  return JSON.stringify(week);
}
