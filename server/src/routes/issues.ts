import { Router } from "express";
import { prisma } from "../db";
import { computeDeadline, endOfDay, parseOptionalDay, parseOptionalHours, parseOptionalString, ValidationError } from "../lib/validation";
import { isClosed, OPEN_STATUSES, PRIORITY_SET, STATUS_SET, STATUS_WORDS } from "../lib/workflow";
import { isOnCrew, resolveAssignees, syncAssignees } from "../lib/crew";
import { releaseEmergency } from "../lib/dayplan";
import { requires } from "../middleware/requireAuth";
import { describeChanges, logActivity } from "../lib/activity";
import { adminUserIds, issueLine, notifyUsers, priorityWord, technicianUserId } from "../lib/notify";
import { getSettings } from "../lib/settings";
import { COST_KINDS, issueCosts } from "../lib/costs";
import { parseCategory, resolveTagIds, setIssueTags } from "../lib/taxonomy";
import { messagesRouter } from "./messages";

// Fields a technician may change on an issue assigned to them.
const TECHNICIAN_FIELDS = ["status", "actualHours", "closedAt", "description", "actionNeeded", "category", "roomName", "tagIds"] as const;

async function technicianName(id: string | null): Promise<string | null> {
  if (!id) return null;
  const t = await prisma.technician.findUnique({ where: { id }, select: { name: true } });
  return t?.name ?? null;
}

export const issuesRouter = Router();

const PRIORITIES = PRIORITY_SET;
const STATUSES = STATUS_SET;
const TECH_SELECT = { select: { id: true, name: true, color: true, trade: true } } as const;

const ISSUE_INCLUDE = {
  photos: true,
  technician: TECH_SELECT,
  // The whole crew, lead included, so a caller never has to merge two fields.
  assignees: { include: { technician: TECH_SELECT }, orderBy: { createdAt: "asc" as const } },
  checklist: { orderBy: { position: "asc" as const } },
  tags: { include: { tag: true } },
  messages: { orderBy: { createdAt: "asc" as const } },
  // Where the job came from, when it started life as a guest report.
  guestReport: { select: { id: true, roomName: true, createdAt: true, reviewedBy: true } },
  costs: { include: { contractor: { select: { id: true, name: true } } }, orderBy: { incurredOn: "desc" as const } },
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
  category: string | null | undefined;
  roomName: string | null | undefined;
  tagIds: string[] | undefined;
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
    category: parseCategory(body.category),
    roomName: parseOptionalString(body.roomName, "roomName", 120),
    tagIds: await resolveTagIds(body.tagIds),
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
  const { propertyId, technicianId, open } = req.query;
  const issues = await prisma.issue.findMany({
    where: {
      ...(propertyId ? { propertyId: String(propertyId) } : {}),
      ...(technicianId ? { technicianId: String(technicianId) } : {}),
      ...(open ? { status: { in: OPEN_STATUSES } } : {}),
    },
    include: ISSUE_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  res.json(issues);
});

issuesRouter.post("/", requires("issue.write"), async (req, res) => {
  const { propertyId, title, description, actionNeeded, priority, status, workOrderCreated, workOrderNumber, lat, lng, firstMessage, guestReportId } = req.body;

  // Accepting a guest report is a review decision, so it stays with admins even though
  // technicians can log issues of their own.
  if (guestReportId !== undefined && guestReportId !== null && req.user!.role !== "admin") {
    return res.status(403).json({ error: "Only an admin can accept a guest report." });
  }

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

  // Check the report before creating anything, so a stale review tab doesn't leave a
  // duplicate issue behind when the report has already been dealt with.
  let acceptingReport: { id: string; roomName: string } | null = null;
  if (guestReportId) {
    if (typeof guestReportId !== "string") return res.status(400).json({ error: "invalid guestReportId" });
    const report = await prisma.guestReport.findUnique({ where: { id: guestReportId }, select: { id: true, status: true, propertyId: true, roomName: true } });
    if (!report) return res.status(404).json({ error: "guest report not found" });
    if (report.propertyId !== propertyId) return res.status(400).json({ error: "That report belongs to another property." });
    if (report.status !== "pending") return res.status(400).json({ error: `That report was already ${report.status}.` });
    acceptingReport = { id: report.id, roomName: report.roomName };
  }

  const finalStatus = status ?? "pending";
  const finalPriority = priority ?? "medium";
  const { responseHours } = await getSettings();

  let crew: string[] | undefined;
  try {
    crew = await resolveAssignees(req.body);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
  // A technician logging work can put themselves on it, nobody else.
  if (req.user!.role === "technician" && crew && crew.some((id) => id !== req.user!.technicianId)) {
    return res.status(403).json({ error: "You can only assign issues to yourself." });
  }
  const leadId = crew && crew.length ? crew[0] : (extras.technicianId ?? null);

  // Cancelled work is closed too — it just was never resolved.
  const closesNow = isClosed(finalStatus);
  const deadline = computeDeadline(finalPriority, responseHours, { scheduledFor: extras.scheduledFor ?? null });
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
      category: extras.category ?? null,
      roomName: extras.roomName ?? null,
      lat,
      lng,
      closedAt: closesNow ? extras.closed ?? new Date() : null,
      technicianId: leadId,
      estimatedHours: extras.estimatedHours ?? null,
      actualHours: finalStatus === "completed" ? extras.actualHours ?? null : null,
      scheduledFor: extras.scheduledFor ?? null,
      isEmergency: !!req.body.isEmergency,
      // Every issue carries both: a day so the planning views can order by it, and the
      // moment it is actually due, which is the only thing a two-hour job can be judged on.
      dueDate: extras.dueDate ?? deadline.dueDate,
      dueAt: extras.dueDate ? endOfDay(extras.dueDate) : deadline.dueAt,
    },
    include: ISSUE_INCLUDE,
  });
  if (typeof firstMessage === "string" && firstMessage.trim()) {
    await prisma.message.create({
      data: { issueId: issue.id, userId: req.user!.id, authorName: req.user!.username, body: firstMessage.trim().slice(0, 4000) },
    });
    issue.messages = await prisma.message.findMany({ where: { issueId: issue.id }, orderBy: { createdAt: "asc" } });
  }
  if (extras.tagIds?.length) {
    await setIssueTags(issue.id, extras.tagIds);
    issue.tags = (await prisma.issueTag.findMany({ where: { issueId: issue.id }, include: { tag: true } })) as typeof issue.tags;
  }
  if (leadId || (crew && crew.length)) {
    await syncAssignees(issue.id, crew && crew.length ? crew : leadId ? [leadId] : []);
    issue.assignees = (await prisma.issueAssignee.findMany({
      where: { issueId: issue.id },
      include: { technician: TECH_SELECT },
      orderBy: { createdAt: "asc" },
    })) as typeof issue.assignees;
  }
  if (acceptingReport) {
    // The photos the guest took become the issue's photos: one owner each, so deleting
    // the issue later takes them with it.
    await prisma.$transaction([
      prisma.photo.updateMany({ where: { guestReportId: acceptingReport.id }, data: { issueId: issue.id, guestReportId: null } }),
      prisma.guestReport.update({
        where: { id: acceptingReport.id },
        data: { status: "accepted", issueId: issue.id, reviewedAt: new Date(), reviewedById: req.user!.id, reviewedBy: req.user!.username },
      }),
    ]);
    issue.photos = await prisma.photo.findMany({ where: { issueId: issue.id } });
    await logActivity(req, {
      action: "intake.accepted",
      entityType: "guest_report",
      entityId: acceptingReport.id,
      issueId: issue.id,
      propertyId: issue.propertyId,
      summary: `Accepted the guest report from ${acceptingReport.roomName} as "${issue.title}"`,
    });
  }
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

issuesRouter.put("/:id", requires("issue.write"), async (req, res) => {
  const existing = await prisma.issue.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not found" });

  if (req.user!.role === "technician") {
    // Anyone on the crew can update the job they were sent to, not only the lead.
    if (!(await isOnCrew(existing.id, req.user!.technicianId))) {
      return res.status(403).json({ error: "You can only update issues assigned to you." });
    }
    // Anything outside this list — the crew, the priority, the dates — is dropped
    // rather than refused, so a client sending a whole issue back still saves the
    // fields it was allowed to change.
    const limited: Record<string, unknown> = {};
    for (const key of TECHNICIAN_FIELDS) if (key in req.body) limited[key] = req.body[key];
    req.body = limited;
  }

  const { title, description, actionNeeded, priority, status, workOrderCreated, workOrderNumber, lat, lng } = req.body;

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
  if (isClosed(nextStatus)) {
    nextClosedAt = extras.closed !== undefined ? extras.closed ?? new Date() : existing.closedAt ?? new Date();
  } else {
    nextClosedAt = null;
  }

  const { responseHours } = await getSettings();

  let crew: string[] | undefined;
  try {
    crew = await resolveAssignees(req.body);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (crew !== undefined && req.user!.role === "technician") {
    return res.status(403).json({ error: "Only an admin can change who is on a job." });
  }

  /**
   * Recompute the deadline when the priority or the start date moves, unless a date was
   * given by hand. Raising something to critical has to move its deadline to two hours
   * from now, or the new priority means nothing.
   */
  const priorityChanged = priority !== undefined && priority !== existing.priority;
  const startChanged = extras.scheduledFor !== undefined && extras.scheduledFor !== existing.scheduledFor;
  let deadlineFields: { dueDate?: string; dueAt?: Date } = {};
  if (extras.dueDate !== undefined) {
    const day = extras.dueDate ?? computeDeadline(priority ?? existing.priority, responseHours, { scheduledFor: extras.scheduledFor ?? existing.scheduledFor }).dueDate;
    deadlineFields = { dueDate: day, dueAt: endOfDay(day) };
  } else if (priorityChanged || startChanged) {
    const next = computeDeadline(priority ?? existing.priority, responseHours, {
      scheduledFor: extras.scheduledFor !== undefined ? extras.scheduledFor : existing.scheduledFor,
    });
    deadlineFields = { dueDate: next.dueDate, dueAt: next.dueAt };
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
      ...(extras.category !== undefined ? { category: extras.category } : {}),
      ...(extras.roomName !== undefined ? { roomName: extras.roomName } : {}),
      ...(lat !== undefined ? { lat } : {}),
      ...(lng !== undefined ? { lng } : {}),
      ...(crew !== undefined ? { technicianId: crew[0] ?? null } : extras.technicianId !== undefined ? { technicianId: extras.technicianId } : {}),
      ...(req.body.isEmergency !== undefined ? { isEmergency: !!req.body.isEmergency } : {}),
      ...(extras.estimatedHours !== undefined ? { estimatedHours: extras.estimatedHours } : {}),
      ...(extras.scheduledFor !== undefined ? { scheduledFor: extras.scheduledFor } : {}),
      ...deadlineFields,
      // Actual hours come from clock in/out entries (or a manual figure on completion);
      // an ordinary edit never wipes them.
      ...(extras.actualHours !== undefined ? { actualHours: extras.actualHours } : {}),
      closedAt: nextClosedAt,
    },
    include: ISSUE_INCLUDE,
  });

  if (extras.tagIds !== undefined) await setIssueTags(issue.id, extras.tagIds);
  if (crew !== undefined) {
    await syncAssignees(issue.id, crew);
    // The update above was read before the crew changed, so re-read it rather than
    // handing back the previous line-up.
    issue.assignees = (await prisma.issueAssignee.findMany({
      where: { issueId: issue.id },
      include: { technician: TECH_SELECT },
      orderBy: { createdAt: "asc" },
    })) as typeof issue.assignees;
  }

  // An emergency that has been dealt with stops displacing the day it was dropped into.
  if (issue.isEmergency && !isClosed(existing.status) && isClosed(issue.status)) {
    const restored = await releaseEmergency(issue.id);
    if (restored) {
      await logActivity(req, {
        action: "issue.emergency_cleared",
        entityType: "issue",
        entityId: issue.id,
        issueId: issue.id,
        propertyId: issue.propertyId,
        summary: `Emergency closed — ${restored} job${restored === 1 ? "" : "s"} moved back to where they were`,
      });
    }
  }

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
      category: "Category",
      roomName: "Room",
    }
  );
  if (changes.length > 0 || description !== undefined || actionNeeded !== undefined) {
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
      await notifyUsers([techUser], { ...meta, kind: "status", title: `${after.title} is now ${STATUS_WORDS[after.status as keyof typeof STATUS_WORDS] ?? after.status}`, body: `${actorName} · ${line}` }, actorId);
    }
    if (before.priority !== after.priority) {
      await notifyUsers([techUser], { ...meta, kind: "priority", title: `Priority now ${priorityWord(after.priority)}: ${after.title}`, body: line }, actorId);
    }
    if (before.dueDate !== after.dueDate || before.scheduledFor !== after.scheduledFor) {
      await notifyUsers([techUser], { ...meta, kind: "status", title: `Rescheduled: ${after.title}`, body: line }, actorId);
    }
  }

  if (statusChanged) {
    await notifyUsers(await adminUserIds(), { ...meta, kind: "status", title: `${actorName} marked "${after.title}" ${STATUS_WORDS[after.status as keyof typeof STATUS_WORDS] ?? after.status}`, body: line }, actorId);
  }
}

issuesRouter.delete("/:id", requires("issue.delete"), async (req, res) => {
  try {
    const issue = await prisma.issue.delete({ where: { id: req.params.id } });
    await logActivity(req, { action: "issue.deleted", entityType: "issue", entityId: issue.id, propertyId: issue.propertyId, summary: `Deleted "${issue.title}"` });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

// ---- Checklist steps -------------------------------------------------------

// Loads the issue and applies the same "technicians only touch their own work" rule as edits.
async function issueForEdit(req: Parameters<typeof issuesRouter.get>[1] extends never ? never : any, res: any, id: string) {
  const issue = await prisma.issue.findUnique({ where: { id } });
  if (!issue) {
    res.status(404).json({ error: "not found" });
    return null;
  }
  if (req.user!.role === "technician" && !(await isOnCrew(issue.id, req.user!.technicianId))) {
    res.status(403).json({ error: "You can only update issues assigned to you." });
    return null;
  }
  return issue;
}

issuesRouter.post("/:id/checklist", requires("issue.write"), async (req, res) => {
  const issue = await issueForEdit(req, res, req.params.id);
  if (!issue) return;
  const text = typeof req.body.text === "string" ? req.body.text.trim().slice(0, 200) : "";
  if (!text) return res.status(400).json({ error: "Step text is required" });
  const count = await prisma.checklistItem.count({ where: { issueId: issue.id } });
  if (count >= 50) return res.status(400).json({ error: "A checklist can have at most 50 steps" });
  const item = await prisma.checklistItem.create({ data: { issueId: issue.id, text, position: count } });
  res.status(201).json(item);
});

issuesRouter.put("/:id/checklist/:itemId", requires("issue.write"), async (req, res) => {
  const issue = await issueForEdit(req, res, req.params.id);
  if (!issue) return;
  const item = await prisma.checklistItem.findFirst({ where: { id: req.params.itemId, issueId: issue.id } });
  if (!item) return res.status(404).json({ error: "not found" });
  const data: Record<string, unknown> = {};
  if (req.body.text !== undefined) {
    const text = typeof req.body.text === "string" ? req.body.text.trim().slice(0, 200) : "";
    if (!text) return res.status(400).json({ error: "Step text is required" });
    data.text = text;
  }
  if (req.body.done !== undefined) {
    const done = !!req.body.done;
    data.done = done;
    data.doneAt = done ? new Date() : null;
    data.doneBy = done ? req.user!.username : null;
  }
  const updated = await prisma.checklistItem.update({ where: { id: item.id }, data });
  if (data.done === true) {
    const remaining = await prisma.checklistItem.count({ where: { issueId: issue.id, done: false } });
    if (remaining === 0) {
      const total = await prisma.checklistItem.count({ where: { issueId: issue.id } });
      await logActivity(req, { action: "issue.checklist", entityType: "issue", entityId: issue.id, issueId: issue.id, propertyId: issue.propertyId, summary: `"${issue.title}": checklist complete (${total}/${total})` });
    }
  }
  res.json(updated);
});

issuesRouter.delete("/:id/checklist/:itemId", requires("issue.write"), async (req, res) => {
  const issue = await issueForEdit(req, res, req.params.id);
  if (!issue) return;
  const result = await prisma.checklistItem.deleteMany({ where: { id: req.params.itemId, issueId: issue.id } });
  if (result.count === 0) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

issuesRouter.use("/:id/messages", messagesRouter);

// ---- Costs -----------------------------------------------------------------

issuesRouter.get("/:id/costs", async (req, res) => {
  const issue = await prisma.issue.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!issue) return res.status(404).json({ error: "not found" });
  const [lines, summary] = await Promise.all([
    prisma.cost.findMany({ where: { issueId: issue.id }, include: { contractor: { select: { id: true, name: true } } }, orderBy: { incurredOn: "desc" } }),
    issueCosts(issue.id),
  ]);
  res.json({ lines, summary });
});

async function parseCost(body: any, partial: boolean) {
  const data: Record<string, unknown> = {};
  if (!partial || body.description !== undefined) {
    if (!body.description || typeof body.description !== "string" || !body.description.trim()) throw new ValidationError("description is required");
    data.description = body.description.trim().slice(0, 200);
  }
  if (!partial || body.amount !== undefined) {
    const amount = typeof body.amount === "string" ? Number(body.amount) : body.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > 10_000_000) throw new ValidationError("amount must be a positive number");
    data.amount = Math.round(amount * 100) / 100;
  }
  if (body.quantity !== undefined) {
    const q = typeof body.quantity === "string" ? Number(body.quantity) : body.quantity;
    if (typeof q !== "number" || !Number.isFinite(q) || q <= 0 || q > 100_000) throw new ValidationError("quantity must be a positive number");
    data.quantity = Math.round(q * 1000) / 1000;
  }
  if (body.kind !== undefined) {
    if (!COST_KINDS.has(body.kind)) throw new ValidationError("kind must be parts, contractor, hire or other");
    data.kind = body.kind;
  }
  if (body.contractorId !== undefined) {
    if (!body.contractorId) data.contractorId = null;
    else {
      const contractor = await prisma.contractor.findUnique({ where: { id: String(body.contractorId) } });
      if (!contractor) throw new ValidationError("contractor not found");
      data.contractorId = contractor.id;
    }
  }
  const invoiceRef = parseOptionalString(body.invoiceRef, "invoiceRef", 80);
  if (invoiceRef !== undefined) data.invoiceRef = invoiceRef;
  const incurredOn = parseOptionalDay(body.incurredOn, "incurredOn");
  if (incurredOn) data.incurredOn = incurredOn;
  else if (!partial) data.incurredOn = new Date().toISOString().slice(0, 10);
  return data;
}

issuesRouter.post("/:id/costs", requires("issue.write"), async (req, res) => {
  const issue = await issueForEdit(req, res, req.params.id);
  if (!issue) return;
  try {
    const data = await parseCost(req.body, false);
    const cost = await prisma.cost.create({
      data: { ...(data as any), issueId: issue.id, createdBy: req.user!.username },
      include: { contractor: { select: { id: true, name: true } } },
    });
    await logActivity(req, {
      action: "cost.added",
      entityType: "issue",
      entityId: issue.id,
      issueId: issue.id,
      propertyId: issue.propertyId,
      summary: `"${issue.title}": added ${cost.kind} cost ${cost.description} (${(cost.amount * cost.quantity).toFixed(2)})${cost.contractor ? ` — ${cost.contractor.name}` : ""}`,
    });
    res.status(201).json({ cost, summary: await issueCosts(issue.id) });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

issuesRouter.put("/:id/costs/:costId", requires("issue.write"), async (req, res) => {
  const issue = await issueForEdit(req, res, req.params.id);
  if (!issue) return;
  const existing = await prisma.cost.findFirst({ where: { id: req.params.costId, issueId: issue.id } });
  if (!existing) return res.status(404).json({ error: "not found" });
  try {
    const cost = await prisma.cost.update({
      where: { id: existing.id },
      data: (await parseCost(req.body, true)) as any,
      include: { contractor: { select: { id: true, name: true } } },
    });
    res.json({ cost, summary: await issueCosts(issue.id) });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

issuesRouter.delete("/:id/costs/:costId", requires("issue.write"), async (req, res) => {
  const issue = await issueForEdit(req, res, req.params.id);
  if (!issue) return;
  const result = await prisma.cost.deleteMany({ where: { id: req.params.costId, issueId: issue.id } });
  if (result.count === 0) return res.status(404).json({ error: "not found" });
  await logActivity(req, { action: "cost.removed", entityType: "issue", entityId: issue.id, issueId: issue.id, propertyId: issue.propertyId, summary: `"${issue.title}": removed a cost line` });
  res.json({ summary: await issueCosts(issue.id) });
});

// Distinct rooms already used at a property, so the issue form can offer them.
issuesRouter.get("/rooms/:propertyId", async (req, res) => {
  const rows = await prisma.issue.findMany({
    where: { propertyId: req.params.propertyId, roomName: { not: null } },
    select: { roomName: true },
    distinct: ["roomName"],
    orderBy: { roomName: "asc" },
  });
  res.json(rows.map((r) => r.roomName).filter(Boolean));
});
