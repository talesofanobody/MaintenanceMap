import { Router } from "express";
import { prisma } from "../db";
import { defaultDueDate, parseOptionalDay, parseOptionalHours, ValidationError } from "../lib/validation";
import { ADMIN_ONLY, CAN_EDIT } from "../middleware/requireAuth";
import { describeChanges, logActivity } from "../lib/activity";
import { adminUserIds, issueLine, notifyUsers, priorityWord, technicianUserId } from "../lib/notify";

const STATUS_WORD: Record<string, string> = { pending: "pending", in_progress: "in progress", completed: "completed" };

// Fields a technician may change on an issue assigned to them.
const TECHNICIAN_FIELDS = ["status", "actualHours", "comments", "closedAt", "description", "actionNeeded"] as const;

async function technicianName(id: string | null): Promise<string | null> {
  if (!id) return null;
  const t = await prisma.technician.findUnique({ where: { id }, select: { name: true } });
  return t?.name ?? null;
}

export const issuesRouter = Router();

const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const STATUSES = new Set(["pending", "in_progress", "completed"]);

const ISSUE_INCLUDE = {
  photos: true,
  technician: { select: { id: true, name: true, color: true, trade: true } },
} as const;

// Accepts a pasted EAM link, tolerating a missing scheme; only http(s) is allowed
// so the value is always safe to render as an href.
function normalizeUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new ValidationError("invalid work order link");
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > 2048) throw new ValidationError("work order link is too long");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new ValidationError("invalid work order link");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("work order link must start with http:// or https://");
  }
  return parsed.toString();
}

function parseDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new ValidationError(`invalid ${field}`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationError(`invalid ${field}`);
  return date;
}

async function parseTechnicianId(value: unknown): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new ValidationError("invalid technician");
  const tech = await prisma.technician.findUnique({ where: { id: value } });
  if (!tech) throw new ValidationError("technician not found");
  return tech.id;
}

interface ParsedExtras {
  url: string | null | undefined;
  closed: Date | null | undefined;
  technicianId: string | null | undefined;
  estimatedHours: number | null | undefined;
  actualHours: number | null | undefined;
  scheduledFor: string | null | undefined;
  dueDate: string | null | undefined;
}

async function parseExtras(body: any): Promise<ParsedExtras> {
  const scheduledFor = parseOptionalDay(body.scheduledFor, "scheduledFor");
  const dueDate = parseOptionalDay(body.dueDate, "dueDate");
  if (scheduledFor && dueDate && dueDate < scheduledFor) {
    throw new ValidationError("due date can't be before the start date");
  }
  return {
    url: normalizeUrl(body.workOrderUrl),
    closed: parseDate(body.closedAt, "closedAt"),
    technicianId: await parseTechnicianId(body.technicianId),
    estimatedHours: parseOptionalHours(body.estimatedHours, "estimatedHours"),
    actualHours: parseOptionalHours(body.actualHours, "actualHours"),
    scheduledFor,
    dueDate,
  };
}

issuesRouter.get("/", async (req, res) => {
  const { propertyId } = req.query;
  const issues = await prisma.issue.findMany({
    where: propertyId ? { propertyId: String(propertyId) } : undefined,
    include: ISSUE_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  res.json(issues);
});

issuesRouter.post("/", CAN_EDIT, async (req, res) => {
  const { propertyId, title, description, actionNeeded, priority, status, workOrderCreated, workOrderNumber, comments, lat, lng } =
    req.body;

  // Technicians can log issues for themselves or leave them unassigned, but not assign others.
  if (req.user!.role === "technician" && req.body.technicianId && req.body.technicianId !== req.user!.technicianId) {
    return res.status(403).json({ error: "You can only assign issues to yourself." });
  }

  if (!propertyId || typeof propertyId !== "string") {
    return res.status(400).json({ error: "propertyId is required" });
  }
  if (!title || typeof title !== "string") {
    return res.status(400).json({ error: "title is required" });
  }
  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "lat and lng are required numbers" });
  }
  if (priority !== undefined && !PRIORITIES.has(priority)) {
    return res.status(400).json({ error: "invalid priority" });
  }
  if (status !== undefined && !STATUSES.has(status)) {
    return res.status(400).json({ error: "invalid status" });
  }

  let extras: ParsedExtras;
  try {
    extras = await parseExtras(req.body);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) return res.status(404).json({ error: "property not found" });

  const finalStatus = status ?? "pending";
  const finalPriority = priority ?? "medium";
  const issue = await prisma.issue.create({
    data: {
      propertyId,
      title,
      description: description ?? null,
      actionNeeded: actionNeeded ?? null,
      priority: finalPriority,
      status: finalStatus,
      workOrderCreated: !!workOrderCreated,
      workOrderNumber: workOrderNumber ?? null,
      workOrderUrl: extras.url ?? null,
      comments: comments ?? null,
      lat,
      lng,
      closedAt: finalStatus === "completed" ? extras.closed ?? new Date() : null,
      technicianId: extras.technicianId ?? null,
      estimatedHours: extras.estimatedHours ?? null,
      actualHours: finalStatus === "completed" ? extras.actualHours ?? null : null,
      scheduledFor: extras.scheduledFor ?? null,
      // Every issue carries a due date so boards can order by it; fall back to the
      // priority's turnaround from the start date (or today).
      dueDate: extras.dueDate ?? defaultDueDate(finalPriority, extras.scheduledFor ?? null),
    },
    include: ISSUE_INCLUDE,
  });
  await logActivity(req, {
    action: "issue.created",
    entityType: "issue",
    entityId: issue.id,
    issueId: issue.id,
    propertyId: issue.propertyId,
    summary: `Logged "${issue.title}" (${issue.priority}${issue.technician ? `, assigned to ${issue.technician.name}` : ""})`,
  });

  // Tell the assigned technician, and let admins know when someone else logs work.
  const actor = req.user!.id;
  const line = issueLine(issue, property.name);
  const meta = { issueId: issue.id, propertyId: issue.propertyId };
  await notifyUsers([await technicianUserId(issue.technicianId)], { ...meta, kind: "assigned", title: `New job: ${issue.title}`, body: line }, actor);
  if (req.user!.role !== "admin") {
    await notifyUsers(await adminUserIds(), { ...meta, kind: "new_issue", title: `${req.user!.username} logged "${issue.title}"`, body: line }, actor);
  }
  res.status(201).json(issue);
});

issuesRouter.get("/:id", async (req, res) => {
  const issue = await prisma.issue.findUnique({ where: { id: req.params.id }, include: ISSUE_INCLUDE });
  if (!issue) return res.status(404).json({ error: "not found" });
  res.json(issue);
});

issuesRouter.put("/:id", CAN_EDIT, async (req, res) => {
  const existing = await prisma.issue.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not found" });

  if (req.user!.role === "technician") {
    if (existing.technicianId !== req.user!.technicianId) {
      return res.status(403).json({ error: "You can only update issues assigned to you." });
    }
    const limited: Record<string, unknown> = {};
    for (const key of TECHNICIAN_FIELDS) if (key in req.body) limited[key] = req.body[key];
    req.body = limited;
  }

  const { title, description, actionNeeded, priority, status, workOrderCreated, workOrderNumber, comments, lat, lng } = req.body;

  if (priority !== undefined && !PRIORITIES.has(priority)) {
    return res.status(400).json({ error: "invalid priority" });
  }
  if (status !== undefined && !STATUSES.has(status)) {
    return res.status(400).json({ error: "invalid status" });
  }

  let extras: ParsedExtras;
  try {
    extras = await parseExtras(req.body);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }

  // The close date follows the status: set when an issue becomes completed (unless a
  // date was supplied), kept while it stays completed, cleared when it is reopened.
  const nextStatus = status ?? existing.status;
  let nextClosedAt: Date | null;
  if (nextStatus === "completed") {
    nextClosedAt = extras.closed !== undefined ? extras.closed ?? new Date() : existing.closedAt ?? new Date();
  } else {
    nextClosedAt = null;
  }

  const issue = await prisma.issue.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(actionNeeded !== undefined ? { actionNeeded } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(workOrderCreated !== undefined ? { workOrderCreated: !!workOrderCreated } : {}),
      ...(workOrderNumber !== undefined ? { workOrderNumber } : {}),
      ...(extras.url !== undefined ? { workOrderUrl: extras.url } : {}),
      ...(comments !== undefined ? { comments } : {}),
      ...(lat !== undefined ? { lat } : {}),
      ...(lng !== undefined ? { lng } : {}),
      ...(extras.technicianId !== undefined ? { technicianId: extras.technicianId } : {}),
      ...(extras.estimatedHours !== undefined ? { estimatedHours: extras.estimatedHours } : {}),
      ...(extras.scheduledFor !== undefined ? { scheduledFor: extras.scheduledFor } : {}),
      ...(extras.dueDate !== undefined
        ? { dueDate: extras.dueDate ?? defaultDueDate(priority ?? existing.priority, extras.scheduledFor ?? existing.scheduledFor) }
        : {}),
      ...(nextStatus === "completed"
        ? extras.actualHours !== undefined
          ? { actualHours: extras.actualHours }
          : {}
        : { actualHours: null }),
      closedAt: nextClosedAt,
    },
    include: ISSUE_INCLUDE,
  });

  const changes = describeChanges(
    { ...existing, technicianId: await technicianName(existing.technicianId) },
    { ...issue, technicianId: issue.technician?.name ?? null },
    {
      status: "Status",
      priority: "Priority",
      technicianId: "Assigned to",
      scheduledFor: "Start",
      dueDate: "Due",
      title: "Title",
      estimatedHours: "Estimate (h)",
      actualHours: "Actual (h)",
      workOrderNumber: "Work order",
    }
  );
  if (changes.length > 0 || comments !== undefined || description !== undefined || actionNeeded !== undefined) {
    const summary = changes.length > 0 ? changes.join(" · ") : "Updated notes";
    await logActivity(req, {
      action: status !== undefined && status !== existing.status ? "issue.status" : "issue.updated",
      entityType: "issue",
      entityId: issue.id,
      issueId: issue.id,
      propertyId: issue.propertyId,
      summary: `"${issue.title}": ${summary}`,
      details: { changes },
    });
  }

  await notifyAboutUpdate(req.user!.id, req.user!.username, existing, issue);
  res.json(issue);
});

type IssueRow = { id: string; title: string; propertyId: string; technicianId: string | null; status: string; priority: string; scheduledFor: string | null; dueDate: string | null };

// Who needs to hear about a change: the technician it now belongs to, and admins when
// a status moves. The person who made the change never gets told about their own edit.
async function notifyAboutUpdate(actorId: string, actorName: string, before: IssueRow, after: IssueRow): Promise<void> {
  const property = await prisma.property.findUnique({ where: { id: after.propertyId }, select: { name: true } });
  const line = issueLine(after, property?.name);
  const meta = { issueId: after.id, propertyId: after.propertyId };
  const techUser = await technicianUserId(after.technicianId);
  const statusChanged = before.status !== after.status;

  if (after.technicianId && after.technicianId !== before.technicianId) {
    await notifyUsers([techUser], { ...meta, kind: "assigned", title: `Assigned to you: ${after.title}`, body: line }, actorId);
  } else if (techUser) {
    if (statusChanged) {
      await notifyUsers([techUser], { ...meta, kind: "status", title: `${after.title} is now ${STATUS_WORD[after.status] ?? after.status}`, body: `${actorName} · ${line}` }, actorId);
    }
    if (before.priority !== after.priority) {
      await notifyUsers([techUser], { ...meta, kind: "priority", title: `Priority now ${priorityWord(after.priority)}: ${after.title}`, body: line }, actorId);
    }
    if (before.dueDate !== after.dueDate || before.scheduledFor !== after.scheduledFor) {
      await notifyUsers([techUser], { ...meta, kind: "status", title: `Rescheduled: ${after.title}`, body: line }, actorId);
    }
  }

  if (statusChanged) {
    await notifyUsers(await adminUserIds(), { ...meta, kind: "status", title: `${actorName} marked "${after.title}" ${STATUS_WORD[after.status] ?? after.status}`, body: line }, actorId);
  }
}

issuesRouter.delete("/:id", ADMIN_ONLY, async (req, res) => {
  try {
    const issue = await prisma.issue.delete({ where: { id: req.params.id } });
    await logActivity(req, { action: "issue.deleted", entityType: "issue", entityId: issue.id, propertyId: issue.propertyId, summary: `Deleted "${issue.title}"` });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "not found" });
  }
});
