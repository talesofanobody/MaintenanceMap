import { Router } from "express";
import { prisma } from "../db";
import { parseColor, parseOptionalString, parseWeeklyHours, ValidationError } from "../lib/validation";

export const techniciansRouter = Router();

const ASSIGNMENT_SELECT = {
  id: true,
  title: true,
  priority: true,
  status: true,
  estimatedHours: true,
  actualHours: true,
  scheduledFor: true,
  propertyId: true,
} as const;

export function serializeTechnician<T extends { weeklyHours: string }>(tech: T) {
  let weeklyHours: number[] = [8, 8, 8, 8, 8, 0, 0];
  try {
    const parsed = JSON.parse(tech.weeklyHours);
    if (Array.isArray(parsed) && parsed.length === 7) weeklyHours = parsed.map(Number);
  } catch {
    // fall back to the default week
  }
  return { ...tech, weeklyHours };
}

techniciansRouter.get("/", async (_req, res) => {
  const technicians = await prisma.technician.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      issues: { where: { status: { not: "completed" } }, select: ASSIGNMENT_SELECT },
    },
  });
  res.json(technicians.map(({ issues, ...t }) => ({ ...serializeTechnician(t), assignments: issues })));
});

techniciansRouter.post("/", async (req, res) => {
  const { name, trade, phone, color, weeklyHours, notes, active } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  try {
    const technician = await prisma.technician.create({
      data: {
        name: name.trim().slice(0, 120),
        trade: parseOptionalString(trade, "trade", 120) ?? null,
        phone: parseOptionalString(phone, "phone", 60) ?? null,
        color: parseColor(color) ?? "#2563eb",
        weeklyHours: JSON.stringify(parseWeeklyHours(weeklyHours) ?? [8, 8, 8, 8, 8, 0, 0]),
        notes: parseOptionalString(notes, "notes", 2000) ?? null,
        active: active === undefined ? true : !!active,
      },
    });
    res.status(201).json({ ...serializeTechnician(technician), assignments: [] });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

techniciansRouter.put("/:id", async (req, res) => {
  const { name, trade, phone, color, weeklyHours, notes, active } = req.body;
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return res.status(400).json({ error: "name cannot be empty" });
  }
  try {
    const parsedHours = parseWeeklyHours(weeklyHours);
    const technician = await prisma.technician.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name: name.trim().slice(0, 120) } : {}),
        ...(trade !== undefined ? { trade: parseOptionalString(trade, "trade", 120) } : {}),
        ...(phone !== undefined ? { phone: parseOptionalString(phone, "phone", 60) } : {}),
        ...(color !== undefined ? { color: parseColor(color) } : {}),
        ...(parsedHours !== undefined ? { weeklyHours: JSON.stringify(parsedHours) } : {}),
        ...(notes !== undefined ? { notes: parseOptionalString(notes, "notes", 2000) } : {}),
        ...(active !== undefined ? { active: !!active } : {}),
      },
      include: { issues: { where: { status: { not: "completed" } }, select: ASSIGNMENT_SELECT } },
    });
    const { issues, ...rest } = technician;
    res.json({ ...serializeTechnician(rest), assignments: issues });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    res.status(404).json({ error: "not found" });
  }
});

techniciansRouter.delete("/:id", async (req, res) => {
  try {
    await prisma.technician.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "not found" });
  }
});
