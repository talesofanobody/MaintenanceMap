import { Router } from "express";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { parseOptionalString, ValidationError } from "../lib/validation";
import { BLOCKER_KINDS, blockerSummary } from "../lib/planning";

/**
 * Things in the way.
 *
 * A blocker is not a dependency and the distinction is the whole reason this
 * exists. A dependency says "this comes after that" and resolves itself when that
 * finishes — nobody needs to do anything about it. A blocker says "this cannot
 * proceed and somebody has to go and sort it out": it has an owner, a reason, an
 * age, and a moment it was cleared.
 *
 * The age is the point of the table. A blocker raised this morning and one that
 * has been sitting for a month are completely different management problems, and
 * nothing in a dependency graph can tell you which you are looking at. So blockers
 * are cleared, never deleted — how long work sat waiting is the most useful thing
 * recorded here, and deleting them throws exactly that away.
 */
export const blockersRouter = Router();

const BLOCKER_INCLUDE = {
  owner: { select: { id: true, name: true, color: true, trade: true } },
  issue: { select: { id: true, title: true, propertyId: true } },
  project: { select: { id: true, name: true, propertyId: true } },
} as const;

/** Exactly one target. A blocker is in the way of one thing. */
async function resolveTarget(body: any) {
  const issueId = typeof body.issueId === "string" && body.issueId ? body.issueId : null;
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
  if (!issueId && !projectId) throw new ValidationError("A blocker has to be against a job or a project.");
  if (issueId && projectId) throw new ValidationError("A blocker is in the way of a job or a project, not both.");

  if (issueId) {
    const issue = await prisma.issue.findUnique({ where: { id: issueId }, select: { id: true, title: true, propertyId: true } });
    if (!issue) throw new ValidationError("That job does not exist.");
    return { issueId, projectId: null, label: issue.title, propertyId: issue.propertyId };
  }
  const project = await prisma.project.findUnique({ where: { id: projectId! }, select: { id: true, name: true, propertyId: true } });
  if (!project) throw new ValidationError("That project does not exist.");
  return { issueId: null, projectId, label: project.name, propertyId: project.propertyId };
}

/**
 * What is in the way, with the state of it.
 *
 * Open ones first and oldest first within that, because that is the order a
 * stand-up should work through them. Cleared ones are still returned — they are
 * the record of how long things take to shift here.
 */
blockersRouter.get("/", async (req, res) => {
  const issueId = typeof req.query.issueId === "string" ? req.query.issueId : undefined;
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const openOnly = req.query.open === "1" || req.query.open === "true";

  const blockers = await prisma.blocker.findMany({
    where: {
      ...(issueId ? { issueId } : {}),
      ...(projectId ? { projectId } : {}),
      ...(openOnly ? { clearedAt: null } : {}),
    },
    include: BLOCKER_INCLUDE,
    orderBy: [{ clearedAt: "asc" }, { raisedAt: "asc" }],
    take: 500,
  });
  res.json({ blockers, state: blockerSummary(blockers), kinds: BLOCKER_KINDS });
});

/** Raise one. */
blockersRouter.post("/", requires("issue.write"), async (req, res) => {
  try {
    const target = await resolveTarget(req.body);
    const summary = parseOptionalString(req.body.summary, "summary", 500);
    if (!summary) return res.status(400).json({ error: "Say what is in the way." });

    const kind = typeof req.body.kind === "string" ? req.body.kind : "other";
    if (!(BLOCKER_KINDS as readonly string[]).includes(kind)) return res.status(400).json({ error: "invalid blocker kind" });

    const ownerId = typeof req.body.ownerId === "string" && req.body.ownerId ? req.body.ownerId : null;
    if (ownerId) {
      const tech = await prisma.technician.findUnique({ where: { id: ownerId }, select: { id: true } });
      if (!tech) return res.status(400).json({ error: "That team member does not exist." });
    }

    const blocker = await prisma.blocker.create({
      data: {
        issueId: target.issueId,
        projectId: target.projectId,
        kind,
        summary,
        ownerId,
        // Free text for anyone outside the roster — a supplier, head office, an inspector.
        ownerName: ownerId ? null : parseOptionalString(req.body.ownerName, "ownerName", 120) ?? null,
        raisedBy: req.user!.username,
      },
      include: BLOCKER_INCLUDE,
    });

    await logActivity(req, {
      action: "blocker.raised",
      entityType: target.issueId ? "issue" : "system",
      entityId: target.issueId ?? target.projectId!,
      propertyId: target.propertyId,
      summary: `Blocked: "${target.label}" — ${summary} (${kind})`,
    });
    res.status(201).json(blocker);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/** Edit one that is still open — who is chasing it, or what it actually is. */
blockersRouter.put("/:id", requires("issue.write"), async (req, res) => {
  const existing = await prisma.blocker.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not found" });
  if (existing.clearedAt) {
    return res.status(400).json({ error: "This blocker is cleared. It is the record of what happened, so it is not edited." });
  }

  try {
    const data: Record<string, unknown> = {};
    if (req.body.summary !== undefined) {
      const summary = parseOptionalString(req.body.summary, "summary", 500);
      if (!summary) return res.status(400).json({ error: "Say what is in the way." });
      data.summary = summary;
    }
    if (req.body.kind !== undefined) {
      const kind = String(req.body.kind);
      if (!(BLOCKER_KINDS as readonly string[]).includes(kind)) return res.status(400).json({ error: "invalid blocker kind" });
      data.kind = kind;
    }
    if (req.body.ownerId !== undefined) {
      const ownerId = typeof req.body.ownerId === "string" && req.body.ownerId ? req.body.ownerId : null;
      if (ownerId) {
        const tech = await prisma.technician.findUnique({ where: { id: ownerId }, select: { id: true } });
        if (!tech) return res.status(400).json({ error: "That team member does not exist." });
      }
      data.ownerId = ownerId;
      if (ownerId) data.ownerName = null;
    }
    if (req.body.ownerName !== undefined && !data.ownerId) {
      data.ownerName = parseOptionalString(req.body.ownerName, "ownerName", 120) ?? null;
    }

    const blocker = await prisma.blocker.update({ where: { id: existing.id }, data, include: BLOCKER_INCLUDE });
    res.json(blocker);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/**
 * Clear it, with what was actually done.
 *
 * Clearing records the resolution and how long it took, rather than removing the
 * row. `{ cleared: false }` reopens one, for the case where the fix did not hold —
 * which is itself worth being able to see.
 */
blockersRouter.post("/:id/clear", requires("issue.write"), async (req, res) => {
  const existing = await prisma.blocker.findUnique({ where: { id: req.params.id }, include: BLOCKER_INCLUDE });
  if (!existing) return res.status(404).json({ error: "not found" });

  const clearing = req.body.cleared !== false;
  if (clearing && existing.clearedAt) return res.status(400).json({ error: "That blocker is already cleared." });
  if (!clearing && !existing.clearedAt) return res.status(400).json({ error: "That blocker is already open." });

  try {
    const blocker = await prisma.blocker.update({
      where: { id: existing.id },
      data: clearing
        ? {
            clearedAt: new Date(),
            clearedBy: req.user!.username,
            resolution: parseOptionalString(req.body.resolution, "resolution", 1000) ?? null,
          }
        : { clearedAt: null, clearedBy: null, resolution: null },
      include: BLOCKER_INCLUDE,
    });

    const label = existing.issue?.title ?? existing.project?.name ?? "work";
    const days = Math.max(0, Math.round((Date.now() - existing.raisedAt.getTime()) / 86400000));
    await logActivity(req, {
      action: clearing ? "blocker.cleared" : "blocker.reopened",
      entityType: existing.issueId ? "issue" : "system",
      entityId: existing.issueId ?? existing.projectId!,
      propertyId: existing.issue?.propertyId ?? existing.project?.propertyId ?? null,
      summary: clearing
        ? `Unblocked "${label}" after ${days} day${days === 1 ? "" : "s"} — ${existing.summary}`
        : `Blocked again: "${label}" — ${existing.summary}`,
    });
    res.json(blocker);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/**
 * Removing one is for a blocker raised in error.
 *
 * A cleared blocker is deliberately not deletable: it is how long something sat in
 * the way, which is the figure this table exists to produce.
 */
blockersRouter.delete("/:id", requires("issue.delete"), async (req, res) => {
  const existing = await prisma.blocker.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not found" });
  if (existing.clearedAt) {
    return res.status(400).json({ error: "A cleared blocker is the record of how long work waited. It stays." });
  }
  await prisma.blocker.delete({ where: { id: existing.id } });
  res.status(204).end();
});
