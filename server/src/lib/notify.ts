import { prisma } from "../db";

export type NotificationKind =
  | "assigned"
  | "new_issue"
  | "status"
  | "priority"
  | "starts_today"
  | "due_soon"
  | "due_today"
  | "overdue"
  | "unassigned"
  | "message"
  | "guest_report";

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  issueId?: string | null;
  propertyId?: string | null;
  /** Same key for the same user is only ever delivered once (used by the scheduler). */
  dedupeKey?: string | null;
}

/** Creates one notification per recipient. Never throws: a failed notice must not fail the request. */
export async function notifyUsers(userIds: (string | null | undefined)[], input: NotifyInput, exceptUserId?: string | null): Promise<number> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id && id !== exceptUserId))];
  let created = 0;
  for (const userId of ids) {
    try {
      if (input.dedupeKey) {
        const existing = await prisma.notification.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey: input.dedupeKey } } });
        if (existing) continue;
      }
      await prisma.notification.create({
        data: {
          userId,
          kind: input.kind,
          title: input.title,
          body: input.body ?? null,
          issueId: input.issueId ?? null,
          propertyId: input.propertyId ?? null,
          dedupeKey: input.dedupeKey ?? null,
        },
      });
      created += 1;
    } catch (err) {
      console.error("notification failed", err);
    }
  }
  return created;
}

export async function adminUserIds(): Promise<string[]> {
  const admins = await prisma.user.findMany({ where: { role: "admin", active: true }, select: { id: true } });
  return admins.map((u) => u.id);
}

/** The login linked to a technician, if they have an active one. */
export async function technicianUserId(technicianId: string | null | undefined): Promise<string | null> {
  if (!technicianId) return null;
  const user = await prisma.user.findFirst({ where: { technicianId, active: true }, select: { id: true } });
  return user?.id ?? null;
}

const PRIORITY_WORD: Record<string, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };

export function priorityWord(priority: string): string {
  return PRIORITY_WORD[priority] ?? priority;
}

/** "Maple Street · High · due 2026-09-20" style one-liner for notification bodies. */
export function issueLine(issue: { priority: string; dueDate?: string | null; scheduledFor?: string | null }, propertyName?: string | null): string {
  const parts = [propertyName, priorityWord(issue.priority)];
  if (issue.scheduledFor) parts.push(`starts ${issue.scheduledFor}`);
  if (issue.dueDate) parts.push(`due ${issue.dueDate}`);
  return parts.filter(Boolean).join(" · ");
}
