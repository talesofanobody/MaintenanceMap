import { Router } from "express";
import { prisma } from "../db";

export const issuesRouter = Router();

const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const STATUSES = new Set(["pending", "in_progress", "completed"]);

issuesRouter.get("/", async (req, res) => {
  const { propertyId } = req.query;
  const issues = await prisma.issue.findMany({
    where: propertyId ? { propertyId: String(propertyId) } : undefined,
    include: { photos: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(issues);
});

issuesRouter.post("/", async (req, res) => {
  const {
    propertyId,
    title,
    description,
    actionNeeded,
    priority,
    status,
    workOrderCreated,
    workOrderNumber,
    comments,
    lat,
    lng,
  } = req.body;

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

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) return res.status(404).json({ error: "property not found" });

  const issue = await prisma.issue.create({
    data: {
      propertyId,
      title,
      description: description ?? null,
      actionNeeded: actionNeeded ?? null,
      priority: priority ?? "medium",
      status: status ?? "pending",
      workOrderCreated: !!workOrderCreated,
      workOrderNumber: workOrderNumber ?? null,
      comments: comments ?? null,
      lat,
      lng,
    },
    include: { photos: true },
  });
  res.status(201).json(issue);
});

issuesRouter.get("/:id", async (req, res) => {
  const issue = await prisma.issue.findUnique({
    where: { id: req.params.id },
    include: { photos: true },
  });
  if (!issue) return res.status(404).json({ error: "not found" });
  res.json(issue);
});

issuesRouter.put("/:id", async (req, res) => {
  const {
    title,
    description,
    actionNeeded,
    priority,
    status,
    workOrderCreated,
    workOrderNumber,
    comments,
    lat,
    lng,
  } = req.body;

  if (priority !== undefined && !PRIORITIES.has(priority)) {
    return res.status(400).json({ error: "invalid priority" });
  }
  if (status !== undefined && !STATUSES.has(status)) {
    return res.status(400).json({ error: "invalid status" });
  }

  try {
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
        ...(comments !== undefined ? { comments } : {}),
        ...(lat !== undefined ? { lat } : {}),
        ...(lng !== undefined ? { lng } : {}),
      },
      include: { photos: true },
    });
    res.json(issue);
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

issuesRouter.delete("/:id", async (req, res) => {
  try {
    await prisma.issue.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "not found" });
  }
});
