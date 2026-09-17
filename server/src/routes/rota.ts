import { Router } from "express";
import { prisma } from "../db";
import { parseWeek, shiftHours, type Shift } from "../lib/shifts";
import { parseStoredList } from "../lib/taxonomy";
import { DATE_ONLY, dayFrom } from "../lib/validation";

export const rotaRouter = Router();

/** Monday of the week containing `day`. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const back = (date.getUTCDay() + 6) % 7;
  return dayFrom(date, -back);
}

/**
 * One week's rota: every active technician, their shift each day, and the work already
 * booked into those days. Drives the printable schedule sheet.
 */
rotaRouter.get("/", async (req, res) => {
  const requested = typeof req.query.week === "string" && DATE_ONLY.test(req.query.week) ? req.query.week : dayFrom(new Date(), 0);
  const start = weekStart(requested);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) days.push(dayFrom(new Date(`${start}T00:00:00Z`), i));
  const end = days[6];

  const technicians = await prisma.technician.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    include: {
      issues: {
        where: { status: { not: "completed" }, scheduledFor: { gte: start, lte: end } },
        select: { id: true, title: true, priority: true, estimatedHours: true, scheduledFor: true, roomName: true, category: true, property: { select: { name: true } } },
        orderBy: { scheduledFor: "asc" },
      },
    },
  });

  const rows = technicians.map((t) => {
    const week = parseWeek(t.weeklyHours);
    return {
      id: t.id,
      name: t.name,
      trade: t.trade,
      color: t.color,
      categories: parseStoredList(t.categories),
      days: days.map((day, i) => {
        const shift: Shift | null = week[i] ?? null;
        const jobs = t.issues.filter((issue) => issue.scheduledFor === day);
        return {
          day,
          shift,
          hours: shiftHours(shift),
          jobs: jobs.map((j) => ({ ...j, property: j.property.name })),
          bookedHours: Math.round(jobs.reduce((sum, j) => sum + (j.estimatedHours ?? 0), 0) * 100) / 100,
        };
      }),
      weekHours: Math.round(week.reduce((sum, s) => sum + shiftHours(s), 0) * 100) / 100,
    };
  });

  res.json({ weekStart: start, days, technicians: rows, generatedAt: new Date().toISOString() });
});
