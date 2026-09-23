import { Router } from "express";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { parseOptionalString, ValidationError } from "../lib/validation";

export const contractorsRouter = Router();

// Everyone who can edit an issue needs the list to attribute a cost; only admins change it.
contractorsRouter.get("/", async (_req, res) => {
  const contractors = await prisma.contractor.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { costs: true } } },
  });
  const spend = await prisma.cost.groupBy({ by: ["contractorId"], _sum: { amount: true } });
  const byId = new Map(spend.map((s) => [s.contractorId, s._sum.amount ?? 0]));
  res.json(contractors.map((c) => ({ ...c, totalSpend: byId.get(c.id) ?? 0 })));
});

function parseBody(body: any, partial: boolean) {
  const data: Record<string, unknown> = {};
  if (!partial || body.name !== undefined) {
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) throw new ValidationError("name is required");
    data.name = body.name.trim().slice(0, 120);
  }
  for (const [field, max] of [
    ["trade", 120],
    ["phone", 60],
    ["email", 160],
    ["notes", 2000],
  ] as const) {
    const value = parseOptionalString(body[field], field, max);
    if (value !== undefined) data[field] = value;
  }
  if (body.active !== undefined) data.active = !!body.active;
  return data;
}

contractorsRouter.post("/", requires("contractor.write"), async (req, res) => {
  try {
    const contractor = await prisma.contractor.create({ data: parseBody(req.body, false) as any });
    await logActivity(req, { action: "contractor.created", entityType: "technician", entityId: contractor.id, summary: `Added contractor ${contractor.name}` });
    res.status(201).json({ ...contractor, totalSpend: 0 });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

contractorsRouter.put("/:id", requires("contractor.write"), async (req, res) => {
  try {
    const contractor = await prisma.contractor.update({ where: { id: req.params.id }, data: parseBody(req.body, true) as any });
    await logActivity(req, { action: "contractor.updated", entityType: "technician", entityId: contractor.id, summary: `Updated contractor ${contractor.name}` });
    res.json(contractor);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if ((err as any)?.code === "P2025") return res.status(404).json({ error: "not found" });
    throw err;
  }
});

contractorsRouter.delete("/:id", requires("contractor.delete"), async (req, res) => {
  const used = await prisma.cost.count({ where: { contractorId: req.params.id } });
  if (used > 0) return res.status(400).json({ error: `This contractor is on ${used} cost line${used === 1 ? "" : "s"}. Deactivate them instead so the history is kept.` });
  try {
    const contractor = await prisma.contractor.delete({ where: { id: req.params.id } });
    await logActivity(req, { action: "contractor.deleted", entityType: "technician", entityId: contractor.id, summary: `Removed contractor ${contractor.name}` });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "not found" });
  }
});
