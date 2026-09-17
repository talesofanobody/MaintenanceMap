import { Router } from "express";
import { prisma } from "../db";
import { ADMIN_ONLY } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { parseColor, ValidationError } from "../lib/validation";
import { CATEGORIES } from "../lib/taxonomy";

export const tagsRouter = Router();

// Anyone signed in needs the list to label an issue; only admins change it.
tagsRouter.get("/", async (_req, res) => {
  const tags = await prisma.tag.findMany({
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { issues: true } } },
  });
  res.json({ tags, categories: CATEGORIES });
});

tagsRouter.post("/", ADMIN_ONLY, async (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim().slice(0, 60) : "";
  if (!name) return res.status(400).json({ error: "A tag needs a name." });
  const existing = await prisma.tag.findFirst({ where: { name: { equals: name } } });
  if (existing) return res.status(400).json({ error: `"${name}" already exists.` });
  try {
    const last = await prisma.tag.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const tag = await prisma.tag.create({
      data: { name, color: parseColor(req.body.color) ?? "#475569", sortOrder: (last?.sortOrder ?? 0) + 1 },
    });
    await logActivity(req, { action: "tag.created", entityType: "system", entityId: tag.id, summary: `Added tag "${tag.name}"` });
    res.status(201).json({ ...tag, _count: { issues: 0 } });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

tagsRouter.put("/:id", ADMIN_ONLY, async (req, res) => {
  const data: Record<string, unknown> = {};
  if (req.body.name !== undefined) {
    const name = typeof req.body.name === "string" ? req.body.name.trim().slice(0, 60) : "";
    if (!name) return res.status(400).json({ error: "A tag needs a name." });
    data.name = name;
  }
  if (req.body.color !== undefined) {
    try {
      data.color = parseColor(req.body.color);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }
  }
  if (req.body.active !== undefined) data.active = !!req.body.active;
  if (req.body.sortOrder !== undefined) data.sortOrder = Number(req.body.sortOrder) || 0;
  try {
    const tag = await prisma.tag.update({ where: { id: req.params.id }, data });
    await logActivity(req, { action: "tag.updated", entityType: "system", entityId: tag.id, summary: `Updated tag "${tag.name}"` });
    res.json(tag);
  } catch (err: any) {
    if (err?.code === "P2025") return res.status(404).json({ error: "not found" });
    if (err?.code === "P2002") return res.status(400).json({ error: "A tag with that name already exists." });
    throw err;
  }
});

tagsRouter.delete("/:id", ADMIN_ONLY, async (req, res) => {
  const used = await prisma.issueTag.count({ where: { tagId: req.params.id } });
  if (used > 0) {
    return res.status(400).json({ error: `That tag is on ${used} issue${used === 1 ? "" : "s"}. Turn it off instead so the history keeps its labels.` });
  }
  try {
    const tag = await prisma.tag.delete({ where: { id: req.params.id } });
    await logActivity(req, { action: "tag.deleted", entityType: "system", entityId: tag.id, summary: `Removed tag "${tag.name}"` });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "not found" });
  }
});
