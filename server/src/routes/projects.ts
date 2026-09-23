import { Router } from "express";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { parseOptionalString, ValidationError } from "../lib/validation";
import { isClosed, OPEN_STATUSES } from "../lib/workflow";

/**
 * A project groups issues that are being done together — a room refurbishment, a
 * floor's worth of snagging from one inspection. It is a label over work, not a
 * second kind of work, so everything else in the app carries on dealing in issues.
 */
export const projectsRouter = Router();

const PROJECT_INCLUDE = {
  property: { select: { id: true, name: true } },
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
      technician: { select: { id: true, name: true, color: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

function summarise<T extends { issues: { status: string }[] }>(project: T) {
  const open = project.issues.filter((i) => (OPEN_STATUSES as string[]).includes(i.status)).length;
  const done = project.issues.filter((i) => i.status === "completed").length;
  return {
    ...project,
    counts: { total: project.issues.length, open, done, progress: project.issues.length ? Math.round((done / project.issues.length) * 100) : 0 },
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
    if (req.body.status !== undefined) {
      const status = String(req.body.status);
      if (!["open", "done", "cancelled"].includes(status)) return res.status(400).json({ error: "invalid status" });
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
