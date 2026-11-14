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
import { LINK_KINDS as SCHEDULE_LINK_KINDS, ORDERING_KINDS, wouldCycleInHierarchy, wouldCycleInLinks } from "../lib/planning";

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
  // Work breakdown and dependencies. The parent is summarised rather than nested so
  // that reading one issue cannot pull a whole tree back with it.
  parent: { select: { id: true, title: true, status: true } },
  children: {
    select: { id: true, title: true, status: true, priority: true, isMilestone: true, dueDate: true },
    orderBy: { createdAt: "asc" as const },
  },
  linksOut: { include: { to: { select: { id: true, title: true, status: true, dueDate: true } } } },
  linksIn: { include: { from: { select: { id: true, title: true, status: true, dueDate: true } } } },
  quotes: { include: { contractor: { select: { id: true, name: true, trade: true } } }, orderBy: { requestedAt: "asc" as const } },
  // What is in the way, open ones first. Whoever opens a job is the person most
  // likely to be standing in front of the thing that is blocking it.
  blockers: {
    include: { owner: { select: { id: true, name: true, color: true } } },
    // One key, because this include is `as const` and a readonly tuple is not
    // assignable to Prisma's orderBy. Nulls sort first in SQLite, so open
    // blockers come before cleared ones, which is the order that matters.
    orderBy: { clearedAt: "asc" as const },
  },
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
  if (typeof value !== "string") throw new ValidationError("invalid team member");
  const tech = await prisma.technician.findUnique({ where: { id: value } });
  if (!tech) throw new ValidationError("team member not found");
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

  let newProjectId: string | null | undefined;
  try {
    newProjectId = await parseProjectId(req.body.projectId, propertyId);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }

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
      projectId: newProjectId ?? null,
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
  /**
   * A parent cannot be finished while anything under it is open.
   *
   * On a tree this is not a nicety, it is what the tree means: a phase is
   * complete exactly when the work in it is, and a programme whose phases can be
   * ticked off independently of their contents reports progress that never
   * happened. Refused rather than cascaded — marking a parent done must not
   * quietly close its children, because somebody has to actually do them.
   *
   * `force` is accepted for the case that genuinely occurs: work descoped part-way
   * through, where the remaining children should have been cancelled and were not.
   * It is logged as its own action so it is visible afterwards.
   */
  if (status === "completed" && !isClosed(existing.status)) {
    const children = await prisma.issue.findMany({
      where: { parentId: existing.id },
      select: { id: true, title: true, status: true },
    });
    const stillOpen = children.filter((c) => !isClosed(c.status));
    if (stillOpen.length && !req.body.force) {
      return res.status(400).json({
        error:
          `${stillOpen.length} task${stillOpen.length === 1 ? "" : "s"} under this one ${stillOpen.length === 1 ? "is" : "are"} still open, ` +
          `so it cannot be finished yet: ${stillOpen.slice(0, 3).map((c) => c.title).join(", ")}` +
          `${stillOpen.length > 3 ? `, and ${stillOpen.length - 3} more` : ""}.`,
        openChildren: stillOpen.map((c) => ({ id: c.id, title: c.title, status: c.status })),
      });
    }
    if (stillOpen.length && req.body.force) {
      await logActivity(req, {
        action: "issue.closed_over_open_children",
        entityType: "issue",
        entityId: existing.id,
        propertyId: existing.propertyId,
        summary: `Finished "${existing.title}" with ${stillOpen.length} task${stillOpen.length === 1 ? "" : "s"} under it still open`,
      });
    }
  }

  /**
   * And the mirror: reopening something cannot leave a finished parent above it.
   *
   * The same invariant read the other way. Without this, reopening one task in a
   * completed phase leaves the phase reporting done with live work inside it,
   * which is the state the rule above exists to prevent.
   */
  let ancestorsToReopen: string[] = [];
  if (status !== undefined && !isClosed(status) && isClosed(existing.status) && existing.parentId) {
    let cursor: string | null = existing.parentId;
    for (let depth = 0; cursor && depth < 200; depth += 1) {
      const parent: { id: string; parentId: string | null; status: string } | null = await prisma.issue.findUnique({
        where: { id: cursor },
        select: { id: true, parentId: true, status: true },
      });
      if (!parent) break;
      if (!isClosed(parent.status)) break;
      ancestorsToReopen.push(parent.id);
      cursor = parent.parentId;
    }
  }

  // Work breakdown. Re-parenting is a normal edit — a job turns out to belong under
  // a different phase — but it must not be allowed to close a loop, because every
  // rollup and every tree render walks this structure.
  let parentUpdate: { parentId: string | null } | undefined;
  if (req.body.parentId !== undefined) {
    const parentId = typeof req.body.parentId === "string" && req.body.parentId ? req.body.parentId : null;
    if (parentId) {
      const parent = await prisma.issue.findUnique({ where: { id: parentId }, select: { id: true, propertyId: true } });
      if (!parent) return res.status(400).json({ error: "That parent does not exist." });
      if (parent.propertyId !== existing.propertyId) {
        return res.status(400).json({ error: "A job can only sit under a parent at the same property." });
      }
      const loops = await wouldCycleInHierarchy(existing.id, parentId, async (id) => {
        const row = await prisma.issue.findUnique({ where: { id }, select: { parentId: true } });
        return row?.parentId ?? null;
      });
      if (loops) return res.status(400).json({ error: "That would put this job inside itself." });
    }
    parentUpdate = { parentId };
  }

  let milestoneUpdate: { isMilestone: boolean } | undefined;
  if (req.body.isMilestone !== undefined) milestoneUpdate = { isMilestone: !!req.body.isMilestone };

  let percentUpdate: { percentComplete: number | null } | undefined;
  if (req.body.percentComplete !== undefined) {
    const raw = req.body.percentComplete;
    if (raw === null || raw === "") {
      percentUpdate = { percentComplete: null };
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({ error: "Per cent complete has to be a number from 0 to 100." });
      }
      percentUpdate = { percentComplete: Math.round(n) };
    }
  }

  let projectUpdate: { projectId: string | null } | undefined;
  try {
    const resolved = await parseProjectId(req.body.projectId, existing.propertyId);
    if (resolved !== undefined) projectUpdate = { projectId: resolved };
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }

  let baselineUpdate: Record<string, string | null> | undefined;
  try {
    const bs = req.body.baselineStart !== undefined ? parseOptionalDay(req.body.baselineStart, "baselineStart") ?? null : undefined;
    const bd = req.body.baselineDue !== undefined ? parseOptionalDay(req.body.baselineDue, "baselineDue") ?? null : undefined;
    if (bs !== undefined || bd !== undefined) {
      baselineUpdate = {};
      if (bs !== undefined) baselineUpdate.baselineStart = bs;
      if (bd !== undefined) baselineUpdate.baselineDue = bd;
    }
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
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
      ...(parentUpdate ?? {}),
      ...(milestoneUpdate ?? {}),
      ...(baselineUpdate ?? {}),
      ...(projectUpdate ?? {}),
      ...(percentUpdate ?? {}),
      // Finishing a task means it is finished, whatever was last reported.
      ...(status === "completed" ? { percentComplete: 100 } : {}),
      closedAt: nextClosedAt,
    },
    include: ISSUE_INCLUDE,
  });

  // Reopening a task reopens any finished parents above it, so a phase can never
  // read as done with live work inside it.
  if (ancestorsToReopen.length) {
    await prisma.issue.updateMany({
      where: { id: { in: ancestorsToReopen } },
      data: { status: "in_progress", closedAt: null },
    });
    await logActivity(req, {
      action: "issue.parent_reopened",
      entityType: "issue",
      entityId: issue.id,
      propertyId: issue.propertyId,
      summary:
        `Reopening "${issue.title}" reopened ${ancestorsToReopen.length} ` +
        `parent task${ancestorsToReopen.length === 1 ? "" : "s"} above it`,
    });
  }

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

// Loads the issue and applies the same "team members only touch their own work" rule as edits.
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

/**
 * Resolve a requested project for an issue.
 *
 * An issue could previously only join a project through POST /projects/:id/issues,
 * which meant building a work breakdown took two calls per job and an issue could
 * never be moved between projects at all. Planning is the point of v2, so the
 * project is settable where every other field is.
 */
async function parseProjectId(value: unknown, issuePropertyId: string): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new ValidationError("invalid project");
  const project = await prisma.project.findUnique({ where: { id: value }, select: { id: true, propertyId: true } });
  if (!project) throw new ValidationError("That project does not exist.");
  // A project scoped to one property should not collect work from another.
  if (project.propertyId && project.propertyId !== issuePropertyId) {
    throw new ValidationError("That project belongs to a different property.");
  }
  return project.id;
}

/**
 * The dependency kinds the route accepts. Three carry date arithmetic:
 * finish-to-start, start-to-start and finish-to-finish. `blocks` and `relates`
 * do not. Defined once in the planning library so the schedule pass and the
 * validation here cannot drift apart.
 */
const LINK_KINDS: readonly string[] = SCHEDULE_LINK_KINDS;

/**
 * Add a dependency from this job to another.
 *
 * `precedes` is the scheduling one — this finishes before that starts, optionally
 * with lag for things that need time rather than labour, like paint drying.
 * `blocks` says the other cannot happen at all until this is resolved, with no
 * implied dates. `relates` asserts nothing beyond "read these together".
 *
 * Ordering links are checked for loops; `relates` is not, because two jobs may
 * perfectly well relate to each other and no schedule depends on it.
 */
issuesRouter.post("/:id/links", requires("issue.write"), async (req, res) => {
  const from = await prisma.issue.findUnique({ where: { id: req.params.id }, select: { id: true, title: true, propertyId: true } });
  if (!from) return res.status(404).json({ error: "not found" });

  const toIssueId = typeof req.body.toIssueId === "string" ? req.body.toIssueId : "";
  const kind = typeof req.body.kind === "string" ? req.body.kind : "precedes";
  if (!LINK_KINDS.includes(kind)) return res.status(400).json({ error: "invalid link kind" });
  if (!toIssueId) return res.status(400).json({ error: "Which job does this one link to?" });
  if (toIssueId === from.id) return res.status(400).json({ error: "A job cannot depend on itself." });

  const to = await prisma.issue.findUnique({ where: { id: toIssueId }, select: { id: true, title: true, propertyId: true } });
  if (!to) return res.status(400).json({ error: "That job does not exist." });

  let lagDays: number | null = null;
  if (req.body.lagDays !== undefined && req.body.lagDays !== null && req.body.lagDays !== "") {
    const n = Number(req.body.lagDays);
    if (!Number.isInteger(n) || n < 0 || n > 365) return res.status(400).json({ error: "Lag must be a whole number of days, 0 to 365." });
    lagDays = n;
  }

  if (kind !== "relates") {
    const loops = await wouldCycleInLinks(from.id, to.id, async (id) => {
      const rows = await prisma.issueLink.findMany({
        where: { fromIssueId: id, kind: { in: [...ORDERING_KINDS, "blocks"] } },
        select: { toIssueId: true },
      });
      return rows.map((r) => r.toIssueId);
    });
    if (loops) {
      return res.status(400).json({ error: "That would make the two jobs wait for each other, so neither could ever start." });
    }
  }

  try {
    await prisma.issueLink.create({ data: { fromIssueId: from.id, toIssueId: to.id, kind, lagDays } });
  } catch {
    // The unique index is the only thing that can realistically fail here.
    return res.status(400).json({ error: "That link already exists." });
  }

  await logActivity(req, {
    action: "issue.linked",
    entityType: "issue",
    entityId: from.id,
    propertyId: from.propertyId,
    summary: `"${from.title}" ${kind} "${to.title}"${lagDays ? ` with ${lagDays} day${lagDays === 1 ? "" : "s"} lag` : ""}`,
  });

  const fresh = await prisma.issue.findUnique({ where: { id: from.id }, include: ISSUE_INCLUDE });
  res.status(201).json(fresh);
});

/** Remove a dependency. Reachable from either end, since a link has two owners. */
issuesRouter.delete("/:id/links/:linkId", requires("issue.write"), async (req, res) => {
  const link = await prisma.issueLink.findUnique({
    where: { id: req.params.linkId },
    include: { from: { select: { id: true, title: true, propertyId: true } }, to: { select: { id: true, title: true } } },
  });
  if (!link) return res.status(404).json({ error: "not found" });
  if (link.fromIssueId !== req.params.id && link.toIssueId !== req.params.id) {
    return res.status(404).json({ error: "not found" });
  }

  await prisma.issueLink.delete({ where: { id: link.id } });
  await logActivity(req, {
    action: "issue.unlinked",
    entityType: "issue",
    entityId: link.from.id,
    propertyId: link.from.propertyId,
    summary: `Removed "${link.from.title}" ${link.kind} "${link.to.title}"`,
  });

  const fresh = await prisma.issue.findUnique({ where: { id: req.params.id }, include: ISSUE_INCLUDE });
  res.json(fresh);
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
