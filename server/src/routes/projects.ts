import { Router } from "express";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { parseOptionalDay, parseOptionalString, ValidationError } from "../lib/validation";
import { isClosed } from "../lib/workflow";
import { budgetView, quoteState, rollUp, slippageDays } from "../lib/planning";

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
      scheduledFor: true,
      dueDate: true,
      baselineStart: true,
      baselineDue: true,
      estimatedHours: true,
      actualHours: true,
      workOrderNumber: true,
      workOrderUrl: true,
      costs: { select: { amount: true, quantity: true } },
      technician: { select: { id: true, name: true, color: true } },
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
  return {
    ...project,
    counts,
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
