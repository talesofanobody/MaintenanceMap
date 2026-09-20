import { Router } from "express";
import { prisma } from "../db";
import { parseColor, parseOptionalHours, parseOptionalString, ValidationError } from "../lib/validation";
import { DEFAULT_WEEK, parseWeek, parseWeekInput, weekToHours } from "../lib/shifts";
import { parseCategoryList, parseStoredList } from "../lib/taxonomy";
import { ADMIN_ONLY } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { OPEN_STATUSES } from "../lib/workflow";

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

// `shifts` carries the start and end times; `weeklyHours` stays as the derived hours per
// day so capacity, planning and load code keeps working unchanged.
export function serializeTechnician<T extends { weeklyHours: string; categories?: string }>(tech: T) {
  const shifts = parseWeek(tech.weeklyHours);
  return { ...tech, shifts, weeklyHours: weekToHours(shifts), categories: parseStoredList(tech.categories ?? "[]") };
}

techniciansRouter.get("/", async (_req, res) => {
  const technicians = await prisma.technician.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      issues: { where: { status: { in: OPEN_STATUSES } }, select: ASSIGNMENT_SELECT },
    },
  });
  res.json(technicians.map(({ issues, ...t }) => ({ ...serializeTechnician(t), assignments: issues })));
});

techniciansRouter.post("/", ADMIN_ONLY, async (req, res) => {
  const { name, trade, phone, color, weeklyHours, shifts, notes, active, hourlyRate, categories } = req.body;
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
        weeklyHours: parseWeekInput(shifts ?? weeklyHours) ?? JSON.stringify(DEFAULT_WEEK),
        categories: parseCategoryList(categories) ?? "[]",
        notes: parseOptionalString(notes, "notes", 2000) ?? null,
        hourlyRate: parseOptionalHours(hourlyRate, "hourlyRate") ?? null,
        active: active === undefined ? true : !!active,
      },
    });
    await logActivity(req, { action: "technician.created", entityType: "technician", entityId: technician.id, summary: `Added technician ${technician.name}` });
    res.status(201).json({ ...serializeTechnician(technician), assignments: [] });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

techniciansRouter.put("/:id", ADMIN_ONLY, async (req, res) => {
  const { name, trade, phone, color, weeklyHours, shifts, notes, active, hourlyRate, categories } = req.body;
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return res.status(400).json({ error: "name cannot be empty" });
  }
  try {
    const parsedHours = parseWeekInput(shifts ?? weeklyHours);
    const parsedCategories = parseCategoryList(categories);
    const technician = await prisma.technician.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name: name.trim().slice(0, 120) } : {}),
        ...(trade !== undefined ? { trade: parseOptionalString(trade, "trade", 120) } : {}),
        ...(phone !== undefined ? { phone: parseOptionalString(phone, "phone", 60) } : {}),
        ...(color !== undefined ? { color: parseColor(color) } : {}),
        ...(parsedHours !== undefined ? { weeklyHours: parsedHours } : {}),
        ...(parsedCategories !== undefined ? { categories: parsedCategories } : {}),
        ...(hourlyRate !== undefined ? { hourlyRate: parseOptionalHours(hourlyRate, "hourlyRate") } : {}),
        ...(notes !== undefined ? { notes: parseOptionalString(notes, "notes", 2000) } : {}),
        ...(active !== undefined ? { active: !!active } : {}),
      },
      include: { issues: { where: { status: { in: OPEN_STATUSES } }, select: ASSIGNMENT_SELECT } },
    });
    const { issues, ...rest } = technician;
    await logActivity(req, {
      action: "technician.updated",
      entityType: "technician",
      entityId: technician.id,
      summary: `Updated technician ${technician.name}${parsedHours ? " (working hours)" : ""}${active !== undefined ? (active ? " (activated)" : " (deactivated)") : ""}`,
    });
    res.json({ ...serializeTechnician(rest), assignments: issues });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    res.status(404).json({ error: "not found" });
  }
});

techniciansRouter.delete("/:id", ADMIN_ONLY, async (req, res) => {
  try {
    const technician = await prisma.technician.delete({ where: { id: req.params.id } });
    await logActivity(req, { action: "technician.deleted", entityType: "technician", entityId: technician.id, summary: `Removed technician ${technician.name}` });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "not found" });
  }
});
