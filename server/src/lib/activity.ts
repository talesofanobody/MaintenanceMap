import type { Request } from "express";
import { prisma } from "../db";

export interface ActivityInput {
  action: string;
  entityType: "issue" | "property" | "technician" | "user" | "photo" | "guest_report" | "inspection" | "walkthrough" | "system";
  entityId: string;
  summary: string;
  /** Who to record when there is no session — a guest submitting through a public link. */
  username?: string;
  propertyId?: string | null;
  issueId?: string | null;
  details?: Record<string, unknown> | null;
}

export async function logActivity(req: Request | null, input: ActivityInput): Promise<void> {
  try {
    await prisma.activity.create({
      data: {
        userId: req?.user?.id ?? null,
        username: req?.user?.username ?? input.username ?? "system",
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        propertyId: input.propertyId ?? null,
        issueId: input.issueId ?? null,
        summary: input.summary,
        details: input.details ? JSON.stringify(input.details) : null,
      },
    });
  } catch (err) {
    // Never let audit logging break the request itself.
    console.error("activity log failed", err);
  }
}

// Builds a readable "field: before → after" list for the fields that changed.
export function describeChanges<T extends Record<string, unknown>>(before: T, after: T, labels: Partial<Record<keyof T, string>>): string[] {
  const lines: string[] = [];
  for (const key of Object.keys(labels) as (keyof T)[]) {
    const a = before[key];
    const b = after[key];
    const same = a === b || (a instanceof Date && b instanceof Date && a.getTime() === b.getTime());
    if (same) continue;
    const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
    lines.push(`${labels[key]}: ${fmt(a)} → ${fmt(b)}`);
  }
  return lines;
}
