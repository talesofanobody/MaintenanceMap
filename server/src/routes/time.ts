import { Router, type Request } from "express";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { isClosed, STATUS_WORDS } from "../lib/workflow";
import { isOnCrew } from "../lib/crew";

export const timeRouter = Router();

const ENTRY_INCLUDE = {
  technician: { select: { id: true, name: true, color: true } },
  issue: { select: { id: true, title: true, propertyId: true, status: true, priority: true, property: { select: { name: true } } } },
} as const;

export function entryHours(entry: { startedAt: Date; endedAt: Date | null }, now = new Date()): number {
  return Math.max(0, ((entry.endedAt ?? now).getTime() - entry.startedAt.getTime()) / 3_600_000);
}

/** Actual hours on an issue always equal the sum of its finished time entries. */
export async function syncActualHours(issueId: string): Promise<number> {
  const entries = await prisma.timeEntry.findMany({ where: { issueId, endedAt: { not: null } } });
  const total = Math.round(entries.reduce((sum, e) => sum + entryHours(e), 0) * 100) / 100;
  await prisma.issue.update({ where: { id: issueId }, data: { actualHours: entries.length ? total : null } });
  return total;
}

// Technicians act as themselves; admins may act for any technician (or themselves if linked).
function resolveTechnicianId(req: Request, requested?: unknown): string | null {
  if (req.user!.role === "technician") return req.user!.technicianId ?? null;
  if (typeof requested === "string" && requested) return requested;
  return req.user!.technicianId ?? null;
}

async function openEntryFor(technicianId: string) {
  return prisma.timeEntry.findFirst({ where: { technicianId, endedAt: null }, orderBy: { startedAt: "desc" }, include: ENTRY_INCLUDE });
}

timeRouter.get("/", async (req, res) => {
  const { issueId, day } = req.query;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  let technicianId = typeof req.query.technicianId === "string" && req.query.technicianId ? req.query.technicianId : undefined;
  // Technicians can see any issue's time log, but only their own personal sheet.
  if (req.user!.role === "technician" && !issueId) technicianId = req.user!.technicianId ?? "none";
  let range: { gte: Date; lt: Date } | undefined;
  if (typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const start = new Date(`${day}T00:00:00Z`);
    range = { gte: start, lt: new Date(start.getTime() + 86_400_000) };
  }
  const entries = await prisma.timeEntry.findMany({
    where: {
      ...(issueId ? { issueId: String(issueId) } : {}),
      ...(technicianId ? { technicianId } : {}),
      ...(range ? { startedAt: range } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: limit,
    include: ENTRY_INCLUDE,
  });
  res.json(entries);
});

// The running timer, if any, for the caller (or a chosen technician, for admins).
timeRouter.get("/open", async (req, res) => {
  const technicianId = resolveTechnicianId(req, req.query.technicianId);
  if (!technicianId) return res.json(null);
  res.json(await openEntryFor(technicianId));
});

timeRouter.post("/clock-in", requires("issue.write"), async (req, res) => {
  const { issueId } = req.body;
  const technicianId = resolveTechnicianId(req, req.body.technicianId);
  if (!technicianId) return res.status(400).json({ error: "This login isn't linked to a technician, so it can't clock in." });
  if (!issueId || typeof issueId !== "string") return res.status(400).json({ error: "issueId is required" });

  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue) return res.status(404).json({ error: "Issue not found" });
  if (isClosed(issue.status)) {
    return res.status(400).json({ error: `This issue is already ${STATUS_WORDS[issue.status as keyof typeof STATUS_WORDS] ?? issue.status}. Reopen it to log more time.` });
  }
  // Unassigned work is fair game; assigned work is for the crew on it.
  if (req.user!.role === "technician" && issue.technicianId && !(await isOnCrew(issue.id, technicianId))) {
    return res.status(403).json({ error: "That issue is assigned to someone else." });
  }
  const technician = await prisma.technician.findUnique({ where: { id: technicianId } });
  if (!technician || !technician.active) return res.status(400).json({ error: "Technician not found or inactive." });

  // Only one job at a time: clocking in elsewhere closes the running entry.
  const running = await openEntryFor(technicianId);
  if (running) {
    if (running.issueId === issueId) return res.json(running);
    await prisma.timeEntry.update({ where: { id: running.id }, data: { endedAt: new Date() } });
    await syncActualHours(running.issueId);
  }

  const data: Record<string, unknown> = {};
  if (!issue.technicianId) data.technicianId = technicianId;
  if (issue.status === "pending") data.status = "in_progress";
  if (Object.keys(data).length) {
    await prisma.issue.update({ where: { id: issueId }, data });
    if (data.status) {
      await logActivity(req, {
        action: "issue.status",
        entityType: "issue",
        entityId: issueId,
        issueId,
        propertyId: issue.propertyId,
        summary: `"${issue.title}": Status: pending → in_progress (clocked in)`,
      });
    }
  }

  const entry = await prisma.timeEntry.create({
    data: { issueId, technicianId, userId: req.user!.id },
    include: ENTRY_INCLUDE,
  });
  await logActivity(req, {
    action: "time.clock_in",
    entityType: "issue",
    entityId: issueId,
    issueId,
    propertyId: issue.propertyId,
    summary: `${technician.name} clocked in on "${issue.title}"`,
  });
  res.status(201).json(entry);
});

timeRouter.post("/clock-out", requires("issue.write"), async (req, res) => {
  const technicianId = resolveTechnicianId(req, req.body.technicianId);
  if (!technicianId) return res.status(400).json({ error: "This login isn't linked to a technician." });
  const running = await openEntryFor(technicianId);
  if (!running) return res.status(404).json({ error: "Not clocked in." });
  const note = typeof req.body.note === "string" && req.body.note.trim() ? req.body.note.trim().slice(0, 500) : null;
  const entry = await prisma.timeEntry.update({ where: { id: running.id }, data: { endedAt: new Date(), note }, include: ENTRY_INCLUDE });
  const total = await syncActualHours(entry.issueId);
  const hours = entryHours(entry);
  await logActivity(req, {
    action: "time.clock_out",
    entityType: "issue",
    entityId: entry.issueId,
    issueId: entry.issueId,
    propertyId: entry.issue.propertyId,
    summary: `${entry.technician.name} clocked out of "${entry.issue.title}" after ${hours.toFixed(2)} h (total ${total.toFixed(2)} h)${note ? ` — ${note}` : ""}`,
  });
  res.json({ ...entry, totalHours: total });
});

// Admins can correct a mistaken entry.
timeRouter.put("/:id", requires("time.adjust"), async (req, res) => {
  const existing = await prisma.timeEntry.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not found" });
  const { startedAt, endedAt, note } = req.body;
  const start = startedAt !== undefined ? new Date(startedAt) : existing.startedAt;
  const end = endedAt === null ? null : endedAt !== undefined ? new Date(endedAt) : existing.endedAt;
  if (Number.isNaN(start.getTime()) || (end && Number.isNaN(end.getTime()))) return res.status(400).json({ error: "Invalid date" });
  if (end && end < start) return res.status(400).json({ error: "End must be after start" });
  const entry = await prisma.timeEntry.update({
    where: { id: existing.id },
    data: { startedAt: start, endedAt: end, ...(note !== undefined ? { note: note ? String(note).slice(0, 500) : null } : {}) },
    include: ENTRY_INCLUDE,
  });
  await syncActualHours(entry.issueId);
  await logActivity(req, { action: "time.edited", entityType: "issue", entityId: entry.issueId, issueId: entry.issueId, propertyId: entry.issue.propertyId, summary: `Edited a time entry on "${entry.issue.title}"` });
  res.json(entry);
});

timeRouter.delete("/:id", requires("time.adjust"), async (req, res) => {
  const existing = await prisma.timeEntry.findUnique({ where: { id: req.params.id }, include: ENTRY_INCLUDE });
  if (!existing) return res.status(404).json({ error: "not found" });
  await prisma.timeEntry.delete({ where: { id: existing.id } });
  await syncActualHours(existing.issueId);
  await logActivity(req, { action: "time.deleted", entityType: "issue", entityId: existing.issueId, issueId: existing.issueId, propertyId: existing.issue.propertyId, summary: `Removed a time entry from "${existing.issue.title}"` });
  res.status(204).end();
});
