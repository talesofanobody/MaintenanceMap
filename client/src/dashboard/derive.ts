import type { DashboardData, DashboardIssue, Priority, Technician } from "../types";
import { addDays, loadSummary, todayStr, type LoadSummary } from "../lib/capacity";
import { durationMs } from "../lib/dates";

export const SEVERITY: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export function openIssues(data: DashboardData): DashboardIssue[] {
  return data.issues
    .filter((i) => i.status !== "completed")
    .sort(
      (a, b) =>
        SEVERITY[a.priority] - SEVERITY[b.priority] ||
        (a.scheduledFor ?? "9999").localeCompare(b.scheduledFor ?? "9999") ||
        a.createdAt.localeCompare(b.createdAt)
    );
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

export type TimeCell = { label: string; tone: "overdue" | "today" | "soon" | "later" | "unscheduled" };

export function timeCell(issue: DashboardIssue, today = todayStr()): TimeCell {
  if (!issue.scheduledFor) return { label: "UNSCHED", tone: "unscheduled" };
  if (issue.scheduledFor < today) return { label: "OVERDUE", tone: "overdue" };
  if (issue.scheduledFor === today) return { label: "TODAY", tone: "today" };
  if (issue.scheduledFor === addDays(today, 1)) return { label: "TMRW", tone: "soon" };
  const [y, m, d] = issue.scheduledFor.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12);
  const label = date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }).toUpperCase();
  return { label, tone: issue.scheduledFor <= addDays(today, 6) ? "soon" : "later" };
}

const TONE_ORDER: Record<TimeCell["tone"], number> = { overdue: 0, today: 1, soon: 2, later: 3, unscheduled: 4 };

export function boardOrder(a: DashboardIssue, b: DashboardIssue, today = todayStr()): number {
  const ta = timeCell(a, today);
  const tb = timeCell(b, today);
  return (
    TONE_ORDER[ta.tone] - TONE_ORDER[tb.tone] ||
    (a.scheduledFor ?? "9999").localeCompare(b.scheduledFor ?? "9999") ||
    (a.status === "in_progress" ? -1 : 0) - (b.status === "in_progress" ? -1 : 0) ||
    SEVERITY[a.priority] - SEVERITY[b.priority]
  );
}

export interface BoardSection {
  key: string;
  technician: Omit<Technician, "assignments"> | null;
  load: LoadSummary | null;
  rows: DashboardIssue[];
}

export function buildBoard(data: DashboardData, today = todayStr()): BoardSection[] {
  const open = openIssues(data);
  const sections: BoardSection[] = data.technicians
    .filter((t) => t.active)
    .map((t) => {
      const rows = open.filter((i) => i.technicianId === t.id).sort((a, b) => boardOrder(a, b, today));
      return { key: t.id, technician: t, load: loadSummary(t.weeklyHours, rows, today), rows };
    });
  const unassigned = open.filter((i) => !i.technicianId || !data.technicians.some((t) => t.id === i.technicianId && t.active));
  if (unassigned.length > 0) {
    sections.push({ key: "unassigned", technician: null, load: null, rows: unassigned.sort((a, b) => boardOrder(a, b, today)) });
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

export function statusBoardLabel(issue: DashboardIssue): string {
  if (issue.status === "in_progress") return "IN PROGRESS";
  if (issue.status === "completed") return "DONE";
  return issue.scheduledFor ? "SCHEDULED" : "WAITING";
}
