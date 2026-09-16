import type { DashboardData, DashboardIssue, Priority, Technician } from "../types";
import { PRIORITIES } from "../types";
import { addDays, loadSummary, slaProgress, todayStr, type LoadSummary } from "../lib/capacity";
import { durationMs } from "../lib/dates";

export const SEVERITY: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

// Boards and the live map all use the same order: priority first, then whatever is
// due soonest, then the earliest start, then age.
export function sortIssues(a: DashboardIssue, b: DashboardIssue): number {
  return (
    SEVERITY[a.priority] - SEVERITY[b.priority] ||
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
    (a.scheduledFor ?? "9999").localeCompare(b.scheduledFor ?? "9999") ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

export function openIssues(data: DashboardData): DashboardIssue[] {
  return data.issues.filter((i) => i.status !== "completed").sort(sortIssues);
}

// Issue numbers match the ones shown in each property's workspace and report.
export function issueNumbers(data: DashboardData): Map<string, number> {
  const byProperty = new Map<string, DashboardIssue[]>();
  for (const issue of data.issues) {
    const list = byProperty.get(issue.propertyId) ?? [];
    list.push(issue);
    byProperty.set(issue.propertyId, list);
  }
  const numbers = new Map<string, number>();
  for (const list of byProperty.values()) {
    list
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .forEach((issue, idx) => numbers.set(issue.id, idx + 1));
  }
  return numbers;
}

export type Tone = "overdue" | "today" | "soon" | "later" | "unscheduled";

export interface TimeCell {
  label: string;
  tone: Tone;
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString(undefined, { weekday: "short", day: "numeric" }).toUpperCase();
}

export function isOverdue(issue: DashboardIssue, today = todayStr()): boolean {
  const marker = issue.dueDate ?? issue.scheduledFor;
  return !!marker && marker < today && issue.status !== "completed";
}

export function dueCell(issue: DashboardIssue, today = todayStr(), warnAtPercent = 0): TimeCell {
  const due = issue.dueDate;
  if (!due) return { label: "NO DUE", tone: "unscheduled" };
  if (due < today) return { label: "OVERDUE", tone: "overdue" };
  if (due === today) return { label: "DUE TODAY", tone: "today" };
  if (due === addDays(today, 1)) return { label: "DUE TMRW", tone: "soon" };
  if (warnAtPercent > 0 && slaProgress(issue, today, warnAtPercent).state === "warning") return { label: `AT RISK · ${dayLabel(due)}`, tone: "soon" };
  return { label: `DUE ${dayLabel(due)}`, tone: due <= addDays(today, 6) ? "soon" : "later" };
}

export function startCell(issue: DashboardIssue, today = todayStr()): string {
  const start = issue.scheduledFor;
  if (!start) return "UNSCHED";
  if (start === today) return "START TODAY";
  if (start === addDays(today, 1)) return "START TMRW";
  if (start < today) return `STARTED ${dayLabel(start)}`;
  return `START ${dayLabel(start)}`;
}

export type GroupMode = "priority" | "technician";

export interface BoardFilters {
  group: GroupMode;
  technicianId?: string;
  propertyId?: string;
}

export interface BoardSection {
  key: string;
  kind: "priority" | "technician" | "unassigned";
  priority?: Priority;
  technician?: Omit<Technician, "assignments">;
  load: LoadSummary | null;
  rows: DashboardIssue[];
}

export function applyFilters(issues: DashboardIssue[], filters: Pick<BoardFilters, "technicianId" | "propertyId">): DashboardIssue[] {
  return issues.filter(
    (i) =>
      (!filters.technicianId || (filters.technicianId === "unassigned" ? !i.technicianId : i.technicianId === filters.technicianId)) &&
      (!filters.propertyId || i.propertyId === filters.propertyId)
  );
}

export function buildBoard(data: DashboardData, today = todayStr(), filters: BoardFilters = { group: "priority" }): BoardSection[] {
  const open = applyFilters(openIssues(data), filters);

  if (filters.group === "priority") {
    return PRIORITIES.slice()
      .reverse()
      .map((priority) => ({
        key: priority,
        kind: "priority" as const,
        priority,
        load: null,
        rows: open.filter((i) => i.priority === priority),
      }))
      .filter((s) => s.rows.length > 0);
  }

  const activeTechs = data.technicians.filter((t) => t.active && (!filters.technicianId || filters.technicianId === t.id));
  const sections: BoardSection[] = activeTechs.map((t) => {
    const rows = open.filter((i) => i.technicianId === t.id);
    const allMine = data.issues.filter((i) => i.technicianId === t.id && i.status !== "completed");
    return { key: t.id, kind: "technician" as const, technician: t, load: loadSummary(t.weeklyHours, allMine, today), rows };
  });
  const unassigned = open.filter((i) => !i.technicianId || !data.technicians.some((t) => t.id === i.technicianId && t.active));
  if (unassigned.length > 0 && (!filters.technicianId || filters.technicianId === "unassigned")) {
    sections.push({ key: "unassigned", kind: "unassigned", load: null, rows: unassigned });
  }
  return sections;
}

export function completedRecently(data: DashboardData): DashboardIssue[] {
  return data.issues.filter((i) => i.status === "completed" && i.closedAt);
}

export function averageResolveMs(issues: DashboardIssue[]): number | null {
  const closed = issues.filter((i) => i.closedAt);
  if (closed.length === 0) return null;
  return closed.reduce((sum, i) => sum + durationMs(i.createdAt, i.closedAt!), 0) / closed.length;
}

export function activeIssueIds(data: DashboardData): Set<string> {
  return new Set((data.activeEntries ?? []).map((e) => e.issueId));
}

export function statusBoardLabel(issue: DashboardIssue, active?: Set<string>): string {
  if (active?.has(issue.id)) return "ON THE JOB";
  if (issue.status === "in_progress") return "IN PROGRESS";
  if (issue.status === "completed") return "DONE";
  return issue.scheduledFor ? "SCHEDULED" : "WAITING";
}
