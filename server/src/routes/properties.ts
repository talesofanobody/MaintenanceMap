import { Router } from "express";
import { prisma } from "../db";
import { ADMIN_ONLY } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";

export const propertiesRouter = Router();

function withParsedBoundary<T extends { boundary?: string | null }>(property: T) {
  return {
    ...property,
    boundary: property.boundary ? JSON.parse(property.boundary) : null,
  };
}

propertiesRouter.get("/", async (_req, res) => {
  const properties = await prisma.property.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { issues: true } } },
  });
  res.json(properties.map(withParsedBoundary));
});

propertiesRouter.post("/", ADMIN_ONLY, async (req, res) => {
  const { name, address, notes } = req.body;
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "name is required" });
  }
  const property = await prisma.property.create({
    data: { name, address: address ?? null, notes: notes ?? null },
  });
  await logActivity(req, { action: "property.created", entityType: "property", entityId: property.id, propertyId: property.id, summary: `Added property ${property.name}` });
  res.status(201).json(property);
});

propertiesRouter.get("/:id", async (req, res) => {
  const property = await prisma.property.findUnique({
    where: { id: req.params.id },
    include: { issues: { include: { photos: true, checklist: { orderBy: { position: "asc" } }, tags: { include: { tag: true } } }, orderBy: { createdAt: "desc" } } },
  });
  if (!property) return res.status(404).json({ error: "not found" });
  res.json(withParsedBoundary(property));
});

propertiesRouter.put("/:id", ADMIN_ONLY, async (req, res) => {
  const { name, address, notes, boundary, centerLat, centerLng } = req.body;
  try {
    const property = await prisma.property.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(address !== undefined ? { address } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(boundary !== undefined ? { boundary: boundary ? JSON.stringify(boundary) : null } : {}),
        ...(centerLat !== undefined ? { centerLat } : {}),
        ...(centerLng !== undefined ? { centerLng } : {}),
      },
    });
    const what = boundary !== undefined ? (boundary ? "border updated" : "border removed") : "details updated";
    await logActivity(req, { action: "property.updated", entityType: "property", entityId: property.id, propertyId: property.id, summary: `${property.name}: ${what}` });
    res.json(withParsedBoundary(property));
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

propertiesRouter.delete("/:id", ADMIN_ONLY, async (req, res) => {
  try {
    const property = await prisma.property.delete({ where: { id: req.params.id } });
    await logActivity(req, { action: "property.deleted", entityType: "property", entityId: property.id, summary: `Deleted property ${property.name}` });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "not found" });
  }
});
