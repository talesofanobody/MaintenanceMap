import type { Assignment, Priority, Status } from "../types";

export interface WorkItem {
  id: string;
  status: Status;
  estimatedHours: number | null;
  scheduledFor: string | null;
  dueDate?: string | null;
}

// Default turnaround per priority; mirrors the server's fallback.
export const SLA_DAYS: Record<Priority, number> = { urgent: 0, high: 3, medium: 14, low: 30 };

export function defaultDueDate(priority: Priority, fromDay?: string | null, slaDays: Record<Priority, number> = SLA_DAYS): string {
  return addDays(fromDay || todayStr(), slaDays[priority]);
}

export type SlaState = "none" | "ok" | "warning" | "overdue" | "done";

export interface SlaProgress {
  state: SlaState;
  /** Share of the turnaround used so far, 0–1 (can exceed 1 when overdue). */
  fraction: number;
  totalDays: number;
  daysLeft: number;
}

/** How much of an issue's turnaround has been used, measured from its start date (or the day it was logged) to its due date. */
export function slaProgress(
  issue: { createdAt: string; scheduledFor: string | null; dueDate: string | null; status: Status },
  today = todayStr(),
  warnAtPercent = 80
): SlaProgress {
  if (issue.status === "completed") return { state: "done", fraction: 0, totalDays: 0, daysLeft: 0 };
  if (!issue.dueDate) return { state: "none", fraction: 0, totalDays: 0, daysLeft: 0 };
  const startDay = issue.scheduledFor && issue.scheduledFor <= today ? issue.scheduledFor : issue.createdAt.slice(0, 10);
  const totalDays = Math.max(0, daysBetween(startDay, issue.dueDate));
  const elapsed = daysBetween(startDay, today);
  const daysLeft = daysBetween(today, issue.dueDate);
  const fraction = totalDays > 0 ? elapsed / totalDays : elapsed >= 0 ? 1 : 0;
  if (daysLeft < 0) return { state: "overdue", fraction, totalDays, daysLeft };
  if (warnAtPercent > 0 && totalDays > 1 && fraction >= warnAtPercent / 100) return { state: "warning", fraction, totalDays, daysLeft };
  return { state: "ok", fraction, totalDays, daysLeft };
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
