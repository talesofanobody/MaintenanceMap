import type { Assignment, Priority, Status } from "../types";

export interface WorkItem {
  id: string;
  status: Status;
  estimatedHours: number | null;
  scheduledFor: string | null;
  dueDate?: string | null;
}

// Default response window per priority, in hours; mirrors the server's fallback.
export const RESPONSE_HOURS: Record<Priority, number> = { critical: 2, urgent: 5, high: 72, medium: 336, low: 720 };

/** Windows under a day are a stopwatch; longer ones are really a number of days. */
export function isShortFuse(hours: number): boolean {
  return hours < 24;
}

/** "2 hours" / "3 days" — whichever way the window reads naturally. */
export function describeWindow(hours: number): string {
  if (!hours || hours <= 0) return "same day";
  if (isShortFuse(hours)) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** The deadline a new issue of this priority would get, as an ISO timestamp. */
export function defaultDueAt(priority: Priority, responseHours: Record<Priority, number> = RESPONSE_HOURS, fromDay?: string | null): string {
  const hours = responseHours[priority] ?? RESPONSE_HOURS[priority];
  if (isShortFuse(hours)) return new Date(Date.now() + hours * 3600_000).toISOString();
  const base = fromDay ? new Date(`${fromDay}T00:00:00Z`) : new Date();
  const day = addDays(toDay(base), Math.round(hours / 24));
  return `${day}T23:59:59.000Z`;
}

export function defaultDueDate(priority: Priority, fromDay?: string | null, responseHours: Record<Priority, number> = RESPONSE_HOURS): string {
  return defaultDueAt(priority, responseHours, fromDay).slice(0, 10);
}

export type SlaState = "none" | "ok" | "warning" | "overdue" | "done";

export interface SlaProgress {
  state: SlaState;
  /** Share of the window used so far, 0–1 (can exceed 1 when overdue). */
  fraction: number;
  /** Whole window, in hours. */
  totalHours: number;
  /** Time remaining, in hours; negative once overdue. */
  hoursLeft: number;
  totalDays: number;
  daysLeft: number;
}

/**
 * How much of an issue's response window has gone.
 *
 * Measured against `dueAt` when there is one, so a two-hour job is judged on the clock
 * rather than on whether the date has rolled over. Falls back to the due date for
 * anything logged before deadlines carried a time.
 */
export function slaProgress(
  issue: { createdAt: string; scheduledFor: string | null; dueDate: string | null; dueAt?: string | null; status: Status },
  now: Date | string = new Date(),
  warnAtPercent = 80
): SlaProgress {
  const empty = { fraction: 0, totalHours: 0, hoursLeft: 0, totalDays: 0, daysLeft: 0 };
  if (issue.status === "completed" || issue.status === "cancelled") return { state: "done", ...empty };

  const at = typeof now === "string" ? new Date(`${now}T12:00:00`) : now;
  const deadline = issue.dueAt ? new Date(issue.dueAt) : issue.dueDate ? new Date(`${issue.dueDate}T23:59:59`) : null;
  if (!deadline || Number.isNaN(deadline.getTime())) return { state: "none", ...empty };

  const today = toDay(at);
  const startedAt =
    issue.scheduledFor && issue.scheduledFor <= today ? new Date(`${issue.scheduledFor}T00:00:00`) : new Date(issue.createdAt);
  const totalMs = Math.max(0, deadline.getTime() - startedAt.getTime());
  const elapsedMs = at.getTime() - startedAt.getTime();
  const leftMs = deadline.getTime() - at.getTime();

  const totalHours = Math.round((totalMs / 3600_000) * 10) / 10;
  const hoursLeft = Math.round((leftMs / 3600_000) * 10) / 10;
  const shape = {
    fraction: totalMs > 0 ? elapsedMs / totalMs : elapsedMs >= 0 ? 1 : 0,
    totalHours,
    hoursLeft,
    totalDays: Math.round(totalHours / 24),
    daysLeft: Math.ceil(hoursLeft / 24),
  };

  if (leftMs < 0) return { state: "overdue", ...shape };
  if (warnAtPercent > 0 && totalMs > 0 && shape.fraction >= warnAtPercent / 100) return { state: "warning", ...shape };
  return { state: "ok", ...shape };
}

/** "1h 20m left" / "2 days left" / "3h late" — what a person wants to read on a card. */
export function timeLeftPhrase(hoursLeft: number): string {
  const late = hoursLeft < 0;
  const magnitude = Math.abs(hoursLeft);
  let text: string;
  if (magnitude < 1) text = `${Math.max(1, Math.round(magnitude * 60))}m`;
  else if (magnitude < 24) {
    // Round to the minute first: 1.999h is two hours, not "1h 60m".
    const totalMinutes = Math.round(magnitude * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    text = m >= 5 ? `${h}h ${m}m` : `${h}h`;
  } else {
    const days = Math.round(magnitude / 24);
    text = `${days} day${days === 1 ? "" : "s"}`;
  }
  return late ? `${text} late` : `${text} left`;
}

export function daysBetween(fromDay: string, toDay: string): number {
  const parse = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((parse(toDay) - parse(fromDay)) / 86400000);
}

export interface DayLoad {
  capacity: number;
  committed: number;
  free: number;
}

export interface LoadSummary {
  today: DayLoad;
  week: DayLoad;
  backlogHours: number;
  backlogCount: number;
  overdueCount: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toDay(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayStr(): string {
  return toDay(new Date());
}

export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d + delta, 12);
  return toDay(date);
}

// Monday = 0 … Sunday = 6, matching the weeklyHours array.
export function weekdayIndex(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return (new Date(y, m - 1, d, 12).getDay() + 6) % 7;
}

export function weekOf(day: string): string[] {
  const monday = addDays(day, -weekdayIndex(day));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function formatDay(day: string, style: "short" | "long" = "short"): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12);
  return date.toLocaleDateString(undefined, style === "short" ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "long", day: "numeric", month: "long" });
}

export function relativeDay(day: string, today = todayStr()): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  return formatDay(day);
}

export function capacityOn(weeklyHours: number[], day: string): number {
  return weeklyHours[weekdayIndex(day)] ?? 0;
}

export function committedOn(items: WorkItem[], day: string, excludeId?: string): number {
  return items
    .filter((i) => i.id !== excludeId && i.status !== "completed" && i.scheduledFor === day)
    .reduce((sum, i) => sum + (i.estimatedHours ?? 0), 0);
}

export function loadSummary(weeklyHours: number[], items: WorkItem[] | Assignment[], today = todayStr()): LoadSummary {
  const open = (items as WorkItem[]).filter((i) => i.status !== "completed");
  const days = weekOf(today);

  const todayCapacity = capacityOn(weeklyHours, today);
  const todayCommitted = committedOn(open, today);

  const weekCapacity = days.reduce((sum, d) => sum + capacityOn(weeklyHours, d), 0);
  const weekCommitted = days.reduce((sum, d) => sum + committedOn(open, d), 0);

  const backlog = open.filter((i) => !i.scheduledFor);
  const overdue = open.filter((i) => {
    const marker = i.dueDate ?? i.scheduledFor;
    return marker !== null && marker !== undefined && marker < today;
  });

  return {
    today: { capacity: todayCapacity, committed: todayCommitted, free: Math.max(0, todayCapacity - todayCommitted) },
    week: { capacity: weekCapacity, committed: weekCommitted, free: Math.max(0, weekCapacity - weekCommitted) },
    backlogHours: backlog.reduce((sum, i) => sum + (i.estimatedHours ?? 0), 0),
    backlogCount: backlog.length,
    overdueCount: overdue.length,
  };
}

export function formatHours(hours: number): string {
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${Math.round(hours * 4) / 4}h`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}
