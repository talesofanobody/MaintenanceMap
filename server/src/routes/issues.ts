import { Router } from "express";
import { prisma } from "../db";

export const issuesRouter = Router();

const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const STATUSES = new Set(["pending", "in_progress", "completed"]);

class ValidationError extends Error {}

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
    workOrderUrl,
    comments,
    lat,
    lng,
    closedAt,
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

  let url: string | null | undefined;
  let closed: Date | null | undefined;
  try {
    url = normalizeUrl(workOrderUrl);
    closed = parseDate(closedAt, "closedAt");
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) return res.status(404).json({ error: "property not found" });

  const finalStatus = status ?? "pending";
  const issue = await prisma.issue.create({
    data: {
      propertyId,
      title,
      description: description ?? null,
      actionNeeded: actionNeeded ?? null,
      priority: priority ?? "medium",
      status: finalStatus,
      workOrderCreated: !!workOrderCreated,
      workOrderNumber: workOrderNumber ?? null,
      workOrderUrl: url ?? null,
      comments: comments ?? null,
      lat,
      lng,
      closedAt: finalStatus === "completed" ? closed ?? new Date() : null,
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
    workOrderUrl,
    comments,
    lat,
    lng,
    closedAt,
  } = req.body;

  if (priority !== undefined && !PRIORITIES.has(priority)) {
    return res.status(400).json({ error: "invalid priority" });
  }
  if (status !== undefined && !STATUSES.has(status)) {
    return res.status(400).json({ error: "invalid status" });
  }

  let url: string | null | undefined;
  let closed: Date | null | undefined;
  try {
    url = normalizeUrl(workOrderUrl);
    closed = parseDate(closedAt, "closedAt");
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  const existing = await prisma.issue.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not found" });

  // The close date follows the status: set when an issue becomes completed (unless a
  // date was supplied), kept while it stays completed, cleared when it is reopened.
  const nextStatus = status ?? existing.status;
  let nextClosedAt: Date | null;
  if (nextStatus === "completed") {
    nextClosedAt = closed !== undefined ? closed ?? new Date() : existing.closedAt ?? new Date();
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
      ...(url !== undefined ? { workOrderUrl: url } : {}),
      ...(comments !== undefined ? { comments } : {}),
      ...(lat !== undefined ? { lat } : {}),
      ...(lng !== undefined ? { lng } : {}),
      closedAt: nextClosedAt,
    },
    include: { photos: true },
  });
  res.json(issue);
});

issuesRouter.delete("/:id", async (req, res) => {
  try {
    await prisma.issue.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "not found" });
  }
});
