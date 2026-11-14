import { Router } from "express";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { parseOptionalDay, parseOptionalString, ValidationError } from "../lib/validation";
import { isClosed } from "../lib/workflow";
import {
  analyseSchedule,
  BLOCKER_KINDS,
  blockerSummary,
  budgetView,
  progressCurve,
  quoteState,
  rollUp,
  rollUpTree,
  slippageDays,
  STAKEHOLDER_ROLES,
  wouldCycleInLinks,
} from "../lib/planning";

/**
 * A project is a plan over work that is being done together — a room refurbishment,
 * a floor's worth of snagging from one inspection, a mold treatment programme.
 *
 * It is still not a second kind of work: the work is issues, which now carry a
 * parent and a dependency graph, so every other screen in the app carries on
 * dealing in issues and gets the hierarchy for free. What the project adds is the
 * things that are true of the whole: who owns it, what was approved, what the plan
 * was before it moved, and whether the quotes are in.
 *
 * The EAM remains the record of work orders. This is the layer that decides what
 * work should exist and when; the work order it becomes still lives over there.
 */
export const projectsRouter = Router();

/** planning is before work starts; on_hold is work stopped for a reason. */
const PROJECT_STATUSES = ["planning", "open", "on_hold", "done", "cancelled"];

/** A money figure. Rejects nonsense rather than silently storing NaN. */
function parseAmount(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new ValidationError("amount must be a number");
  if (n < 0) throw new ValidationError("amount cannot be negative");
  return Math.round(n * 100) / 100;
}

const PROJECT_INCLUDE = {
  property: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true, color: true, trade: true } },
  stakeholders: {
    include: { technician: { select: { id: true, name: true, color: true, trade: true } } },
    orderBy: { createdAt: "asc" as const },
  },
  blockers: {
    include: { owner: { select: { id: true, name: true, color: true } } },
    orderBy: { raisedAt: "asc" as const },
  },
  linksOut: { include: { to: { select: { id: true, name: true, status: true, plannedEnd: true } } } },
  linksIn: { include: { from: { select: { id: true, name: true, status: true, plannedEnd: true } } } },
  quotes: {
    include: { contractor: { select: { id: true, name: true, trade: true } } },
    orderBy: { requestedAt: "asc" as const },
  },
  issues: {
    select: {
      id: true,
      propertyId: true,
      title: true,
      status: true,
      priority: true,
      roomName: true,
      category: true,
      dueAt: true,
      // The planning fields. parentId and isMilestone are what the rollup needs to
      // avoid double-counting; the baselines are what make slippage visible.
      parentId: true,
      isMilestone: true,
      percentComplete: true,
      scheduledFor: true,
      dueDate: true,
      baselineStart: true,
      baselineDue: true,
      estimatedHours: true,
      actualHours: true,
      workOrderNumber: true,
      workOrderUrl: true,
      closedAt: true,
      costs: { select: { amount: true, quantity: true } },
      technician: { select: { id: true, name: true, color: true } },
      blockers: { select: { id: true, summary: true, kind: true, raisedAt: true, clearedAt: true } },
      linksOut: { select: { id: true, toIssueId: true, kind: true, lagDays: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

/**
 * Everything a caller needs to judge a project at a glance, computed rather than
 * stored: progress over leaves, money three ways, the plan against the baseline,
 * and whether the quotes rule is met. None of it is cached — these are small sums
 * over one project's issues, and a stale rollup is worse than a recomputed one.
 */
function summarise(project: any) {
  const counts = rollUp(project.issues, isClosed);
  const awarded = (project.quotes ?? []).filter((q: any) => q.status === "awarded" && q.amount != null).map((q: any) => q.amount as number);
  // Every blocker in scope: the project's own, plus the ones on its work. A
  // supervisor wants one number for "what is in the way here", not two lists.
  const allBlockers = [...(project.blockers ?? []), ...(project.issues ?? []).flatMap((i: any) => i.blockers ?? [])];

  // The schedule, from the work's own dates and the dependencies between it.
  /**
   * The tree, resolved. A parent's dates and progress come from its children
   * rather than from whatever was typed on it — see rollUpTree. Everything below
   * reads these rather than the stored values.
   */
  const tree = rollUpTree(
    (project.issues ?? []).map((i: any) => ({
      id: i.id,
      parentId: i.parentId ?? null,
      start: i.scheduledFor ?? null,
      end: i.dueDate ?? i.scheduledFor ?? null,
      isMilestone: !!i.isMilestone,
      status: i.status,
      percentComplete: i.percentComplete ?? null,
    })),
    isClosed
  );

  const schedule = analyseSchedule(
    (project.issues ?? []).map((i: any) => ({
      id: i.id,
      start: tree[i.id]?.start ?? i.scheduledFor ?? null,
      end: tree[i.id]?.end ?? i.dueDate ?? i.scheduledFor ?? null,
      isMilestone: !!i.isMilestone,
      isSummary: tree[i.id]?.isSummary ?? false,
    })),
    (project.issues ?? []).flatMap((i: any) =>
      (i.linksOut ?? []).map((l: any) => ({ fromId: i.id, toId: l.toIssueId, kind: l.kind, lagDays: l.lagDays }))
    )
  );

  return {
    ...project,
    // Each task carries what the tree actually says about it, alongside what is
    // stored, so a caller never has to work the rollup out for itself.
    issues: (project.issues ?? []).map((i: any) => ({
      ...i,
      rolled: tree[i.id] ?? { start: i.scheduledFor, end: i.dueDate, percentComplete: i.percentComplete, isSummary: false, openBeneath: 0 },
    })),
    counts,
    analysis: schedule,
    curve: progressCurve(project.issues ?? []),
    blockerState: blockerSummary(allBlockers),
    openBlockers: allBlockers.filter((b: any) => !b.clearedAt).length,
    budget: budgetView(project.budgetAmount ?? null, awarded, counts.actualCost),
    schedule: {
      plannedStart: project.plannedStart ?? null,
      plannedEnd: project.plannedEnd ?? null,
      baselineStart: project.baselineStart ?? null,
      baselineEnd: project.baselineEnd ?? null,
      // Positive means the end has moved later than what was agreed.
      slippageDays: slippageDays(project.baselineEnd ?? null, project.plannedEnd ?? null),
      baselined: !!(project.baselineStart || project.baselineEnd),
    },
    quoteState: quoteState(project.quotes ?? []),
    approved: !!project.approvedAt,
  };
}

projectsRouter.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
  const projects = await prisma.project.findMany({
    where: { ...(status ? { status } : {}), ...(propertyId ? { propertyId } : {}) },
    include: PROJECT_INCLUDE,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  res.json(projects.map(summarise));
});

projectsRouter.get("/:id", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, include: PROJECT_INCLUDE });
  if (!project) return res.status(404).json({ error: "not found" });
  res.json(summarise(project));
});

projectsRouter.post("/", requires("project.write"), async (req, res) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim().slice(0, 120) : "";
    if (!name) return res.status(400).json({ error: "A project needs a name." });
    const project = await prisma.project.create({
      data: {
        name,
        description: parseOptionalString(req.body.description, "description", 1000) ?? null,
        propertyId: typeof req.body.propertyId === "string" && req.body.propertyId ? req.body.propertyId : null,
        ownerId: typeof req.body.ownerId === "string" && req.body.ownerId ? req.body.ownerId : null,
        plannedStart: parseOptionalDay(req.body.plannedStart, "plannedStart") ?? null,
        plannedEnd: parseOptionalDay(req.body.plannedEnd, "plannedEnd") ?? null,
        budgetAmount: parseAmount(req.body.budgetAmount) ?? null,
        status: PROJECT_STATUSES.includes(String(req.body.status)) ? String(req.body.status) : "open",
        createdBy: req.user!.username,
      },
      include: PROJECT_INCLUDE,
    });
    await logActivity(req, { action: "project.created", entityType: "system", entityId: project.id, propertyId: project.propertyId, summary: `Started the project "${project.name}"` });
    res.status(201).json(summarise(project));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

projectsRouter.put("/:id", requires("project.write"), async (req, res) => {
  const existing = await prisma.project.findUnique({ where: { id: req.params.id }, include: { issues: { select: { status: true } } } });
  if (!existing) return res.status(404).json({ error: "not found" });
  try {
    const data: Record<string, unknown> = {};
    if (req.body.name !== undefined) {
      const name = typeof req.body.name === "string" ? req.body.name.trim().slice(0, 120) : "";
      if (!name) return res.status(400).json({ error: "A project needs a name." });
      data.name = name;
    }
    if (req.body.description !== undefined) data.description = parseOptionalString(req.body.description, "description", 1000) ?? null;
    if (req.body.ownerId !== undefined) data.ownerId = typeof req.body.ownerId === "string" && req.body.ownerId ? req.body.ownerId : null;
    if (req.body.plannedStart !== undefined) data.plannedStart = parseOptionalDay(req.body.plannedStart, "plannedStart") ?? null;
    if (req.body.plannedEnd !== undefined) data.plannedEnd = parseOptionalDay(req.body.plannedEnd, "plannedEnd") ?? null;
    if (req.body.budgetAmount !== undefined) data.budgetAmount = parseAmount(req.body.budgetAmount) ?? null;
    // The baseline is deliberately NOT settable here. It is frozen through
    // /baseline, so a plan cannot be quietly rewritten to hide that it moved.
    if (req.body.status !== undefined) {
      const status = String(req.body.status);
      if (!PROJECT_STATUSES.includes(status)) return res.status(400).json({ error: "invalid status" });
      // Closing a project with work still open is nearly always a mistake.
      if (status === "done") {
        const stillOpen = existing.issues.filter((i) => !isClosed(i.status)).length;
        if (stillOpen > 0 && !req.body.force) {
          return res.status(400).json({ error: `${stillOpen} issue${stillOpen === 1 ? " is" : "s are"} still open on this project.` });
        }
      }
      data.status = status;
    }
    const project = await prisma.project.update({ where: { id: existing.id }, data, include: PROJECT_INCLUDE });
    await logActivity(req, { action: "project.updated", entityType: "system", entityId: project.id, propertyId: project.propertyId, summary: `Project "${project.name}" updated` });
    res.json(summarise(project));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/** Adds existing issues to a project, or takes them out of one. */
projectsRouter.post("/:id/issues", requires("project.write"), async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, propertyId: true } });
  if (!project) return res.status(404).json({ error: "not found" });
  const add: string[] = Array.isArray(req.body.add) ? req.body.add.map(String) : [];
  const remove: string[] = Array.isArray(req.body.remove) ? req.body.remove.map(String) : [];
  if (!add.length && !remove.length) return res.status(400).json({ error: "Nothing to add or remove." });

  if (add.length) await prisma.issue.updateMany({ where: { id: { in: add } }, data: { projectId: project.id } });
  if (remove.length) await prisma.issue.updateMany({ where: { id: { in: remove }, projectId: project.id }, data: { projectId: null } });

  await logActivity(req, {
    action: "project.issues_changed",
    entityType: "system",
    entityId: project.id,
    propertyId: project.propertyId,
    summary: `Project "${project.name}": ${add.length} added, ${remove.length} removed`,
  });
  const fresh = await prisma.project.findUnique({ where: { id: project.id }, include: PROJECT_INCLUDE });
  res.json(summarise(fresh!));
});

/**
 * Freeze the current plan as the baseline.
 *
 * This is what makes a baseline worth storing: a deliberate act, at the moment the
 * plan is agreed, after which the planned dates can move and the original stays put.
 * It copies the project's dates and every issue's scheduled/due dates in one go,
 * because a baseline that covered only the header would not let you see which part
 * of the plan slipped.
 *
 * Re-baselining is allowed but never accidental — it needs `force`, and it is logged,
 * because "we re-planned" and "we were late" are different claims about the same
 * dates and the record should not confuse them.
 */
projectsRouter.post("/:id/baseline", requires("project.write"), async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: { issues: { select: { id: true, scheduledFor: true, dueDate: true } } },
  });
  if (!project) return res.status(404).json({ error: "not found" });

  const already = !!(project.baselineStart || project.baselineEnd);
  if (already && !req.body.force) {
    return res.status(400).json({
      error: "This project already has a baseline. Re-baselining hides the slippage against the original plan, so it needs to be confirmed.",
    });
  }

  await prisma.$transaction([
    prisma.project.update({
      where: { id: project.id },
      data: { baselineStart: project.plannedStart, baselineEnd: project.plannedEnd },
    }),
    ...project.issues.map((i) =>
      prisma.issue.update({ where: { id: i.id }, data: { baselineStart: i.scheduledFor, baselineDue: i.dueDate } })
    ),
  ]);

  await logActivity(req, {
    action: already ? "project.rebaselined" : "project.baselined",
    entityType: "system",
    entityId: project.id,
    propertyId: project.propertyId,
    summary: `${already ? "Re-baselined" : "Baselined"} "${project.name}" — ${project.issues.length} item${project.issues.length === 1 ? "" : "s"} frozen at the current plan`,
  });

  const fresh = await prisma.project.findUnique({ where: { id: project.id }, include: PROJECT_INCLUDE });
  res.json(summarise(fresh!));
});

/**
 * Record sign-off on the project and its budget.
 *
 * The department rule is a supervisor plus one of the assistant chiefs or the chief,
 * which this cannot enforce on its own — it records who approved, by name, and when.
 * An approval is cleared by `{ approved: false }` rather than by deleting anything,
 * so withdrawing it leaves a trail.
 */
projectsRouter.post("/:id/approve", requires("project.write"), async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) return res.status(404).json({ error: "not found" });

  const approving = req.body.approved !== false;
  try {
    const data: Record<string, unknown> = approving
      ? { approvedBy: req.user!.username, approvedAt: new Date() }
      : { approvedBy: null, approvedAt: null };
    // Approving a figure and setting it are the same act in practice.
    if (approving && req.body.budgetAmount !== undefined) data.budgetAmount = parseAmount(req.body.budgetAmount) ?? null;

    const updated = await prisma.project.update({ where: { id: project.id }, data, include: PROJECT_INCLUDE });
    await logActivity(req, {
      action: approving ? "project.approved" : "project.approval_withdrawn",
      entityType: "system",
      entityId: project.id,
      propertyId: project.propertyId,
      summary: approving
        ? `Approved "${project.name}"${updated.budgetAmount != null ? ` with a budget of ${updated.budgetAmount}` : ""}`
        : `Withdrew approval of "${project.name}"`,
    });
    res.json(summarise(updated));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

// ---------------------------------------------------------------------------
// Dependencies between projects
// ---------------------------------------------------------------------------

const PROJECT_LINK_KINDS = ["precedes", "blocks", "relates"];

/**
 * Make one project depend on another.
 *
 * The same three kinds as between jobs, and the same loop check on the ordering
 * ones: two programmes each waiting for the other is a plan nobody can start.
 */
projectsRouter.post("/:id/links", requires("project.write"), async (req, res) => {
  const from = await prisma.project.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, propertyId: true } });
  if (!from) return res.status(404).json({ error: "not found" });

  const toProjectId = typeof req.body.toProjectId === "string" ? req.body.toProjectId : "";
  const kind = typeof req.body.kind === "string" ? req.body.kind : "precedes";
  if (!PROJECT_LINK_KINDS.includes(kind)) return res.status(400).json({ error: "invalid link kind" });
  if (!toProjectId) return res.status(400).json({ error: "Which project does this one depend on?" });
  if (toProjectId === from.id) return res.status(400).json({ error: "A project cannot depend on itself." });

  const to = await prisma.project.findUnique({ where: { id: toProjectId }, select: { id: true, name: true } });
  if (!to) return res.status(400).json({ error: "That project does not exist." });

  let lagDays: number | null = null;
  if (req.body.lagDays !== undefined && req.body.lagDays !== null && req.body.lagDays !== "") {
    const n = Number(req.body.lagDays);
    if (!Number.isInteger(n) || n < 0 || n > 365) return res.status(400).json({ error: "Lag must be a whole number of days, 0 to 365." });
    lagDays = n;
  }

  if (kind !== "relates") {
    const loops = await wouldCycleInLinks(from.id, to.id, async (id) => {
      const rows = await prisma.projectLink.findMany({
        where: { fromProjectId: id, kind: { in: ["precedes", "blocks"] } },
        select: { toProjectId: true },
      });
      return rows.map((r) => r.toProjectId);
    });
    if (loops) {
      return res.status(400).json({ error: "That would make the two projects wait for each other, so neither could ever start." });
    }
  }

  try {
    await prisma.projectLink.create({ data: { fromProjectId: from.id, toProjectId: to.id, kind, lagDays } });
  } catch {
    return res.status(400).json({ error: "That link already exists." });
  }

  await logActivity(req, {
    action: "project.linked",
    entityType: "system",
    entityId: from.id,
    propertyId: from.propertyId,
    summary: `"${from.name}" ${kind} "${to.name}"`,
  });
  const fresh = await prisma.project.findUnique({ where: { id: from.id }, include: PROJECT_INCLUDE });
  res.status(201).json(summarise(fresh!));
});

projectsRouter.delete("/:id/links/:linkId", requires("project.write"), async (req, res) => {
  const link = await prisma.projectLink.findUnique({
    where: { id: req.params.linkId },
    include: { from: { select: { id: true, name: true, propertyId: true } }, to: { select: { name: true } } },
  });
  if (!link) return res.status(404).json({ error: "not found" });
  if (link.fromProjectId !== req.params.id && link.toProjectId !== req.params.id) {
    return res.status(404).json({ error: "not found" });
  }
  await prisma.projectLink.delete({ where: { id: link.id } });
  await logActivity(req, {
    action: "project.unlinked",
    entityType: "system",
    entityId: link.from.id,
    propertyId: link.from.propertyId,
    summary: `Removed "${link.from.name}" ${link.kind} "${link.to.name}"`,
  });
  const fresh = await prisma.project.findUnique({ where: { id: req.params.id }, include: PROJECT_INCLUDE });
  res.json(summarise(fresh!));
});

// ---------------------------------------------------------------------------
// Stakeholders
// ---------------------------------------------------------------------------

/**
 * Add somebody with an interest, and say what kind of interest it is.
 *
 * Either one of the roster or a name and an organisation. External people are not
 * an afterthought: an insurer's auditor, a regional engineer and a public-health
 * lab are all stakeholders on this kind of work and none of them will ever have a
 * login here.
 */
projectsRouter.post("/:id/stakeholders", requires("project.write"), async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, propertyId: true } });
  if (!project) return res.status(404).json({ error: "not found" });

  try {
    const role = typeof req.body.role === "string" ? req.body.role : "informed";
    if (!(STAKEHOLDER_ROLES as readonly string[]).includes(role)) return res.status(400).json({ error: "invalid stakeholder role" });

    const technicianId = typeof req.body.technicianId === "string" && req.body.technicianId ? req.body.technicianId : null;
    const name = parseOptionalString(req.body.name, "name", 120) ?? null;
    if (!technicianId && !name) return res.status(400).json({ error: "A stakeholder needs either somebody from the team or a name." });
    if (technicianId) {
      const tech = await prisma.technician.findUnique({ where: { id: technicianId }, select: { id: true } });
      if (!tech) return res.status(400).json({ error: "That team member does not exist." });
    }

    const stakeholder = await prisma.stakeholder.create({
      data: {
        projectId: project.id,
        technicianId,
        name: technicianId ? null : name,
        organisation: parseOptionalString(req.body.organisation, "organisation", 120) ?? null,
        role,
        notes: parseOptionalString(req.body.notes, "notes", 1000) ?? null,
      },
      include: { technician: { select: { name: true } } },
    });

    await logActivity(req, {
      action: "project.stakeholder_added",
      entityType: "system",
      entityId: project.id,
      propertyId: project.propertyId,
      summary: `${stakeholder.technician?.name ?? stakeholder.name} added to "${project.name}" as ${role}`,
    });
    const fresh = await prisma.project.findUnique({ where: { id: project.id }, include: PROJECT_INCLUDE });
    res.status(201).json(summarise(fresh!));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

projectsRouter.put("/:id/stakeholders/:stakeholderId", requires("project.write"), async (req, res) => {
  const existing = await prisma.stakeholder.findUnique({ where: { id: req.params.stakeholderId } });
  if (!existing || existing.projectId !== req.params.id) return res.status(404).json({ error: "not found" });
  try {
    const data: Record<string, unknown> = {};
    if (req.body.role !== undefined) {
      const role = String(req.body.role);
      if (!(STAKEHOLDER_ROLES as readonly string[]).includes(role)) return res.status(400).json({ error: "invalid stakeholder role" });
      data.role = role;
    }
    if (req.body.organisation !== undefined) data.organisation = parseOptionalString(req.body.organisation, "organisation", 120) ?? null;
    if (req.body.notes !== undefined) data.notes = parseOptionalString(req.body.notes, "notes", 1000) ?? null;
    await prisma.stakeholder.update({ where: { id: existing.id }, data });
    const fresh = await prisma.project.findUnique({ where: { id: req.params.id }, include: PROJECT_INCLUDE });
    res.json(summarise(fresh!));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

projectsRouter.delete("/:id/stakeholders/:stakeholderId", requires("project.write"), async (req, res) => {
  const existing = await prisma.stakeholder.findUnique({ where: { id: req.params.stakeholderId } });
  if (!existing || existing.projectId !== req.params.id) return res.status(404).json({ error: "not found" });
  await prisma.stakeholder.delete({ where: { id: existing.id } });
  const fresh = await prisma.project.findUnique({ where: { id: req.params.id }, include: PROJECT_INCLUDE });
  res.json(summarise(fresh!));
});

/** Deleting a project releases its issues rather than taking them with it. */
projectsRouter.delete("/:id", requires("project.delete"), async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, propertyId: true } });
  if (!project) return res.status(404).json({ error: "not found" });
  const released = await prisma.issue.count({ where: { projectId: project.id } });
  await prisma.project.delete({ where: { id: project.id } });
  await logActivity(req, {
    action: "project.deleted",
    entityType: "system",
    entityId: project.id,
    propertyId: project.propertyId,
    summary: `Deleted the project "${project.name}" — ${released} issue${released === 1 ? "" : "s"} kept, no longer grouped`,
  });
  res.status(204).end();
});
