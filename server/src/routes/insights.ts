import { Router } from "express";
import { prisma } from "../db";
import { ADMIN_ONLY } from "../middleware/requireAuth";
import { costsByIssue } from "../lib/costs";
import { dayFrom } from "../lib/validation";

export const insightsRouter = Router();

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function monthsBack(count: number, from = new Date()): string[] {
  const out: string[] = [];
  const base = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  for (let i = count - 1; i >= 0; i--) {
    out.push(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  return out;
}

/** Month-by-month workload, resolution speed and spend, plus per-property and per-technician totals. */
insightsRouter.get("/trends", ADMIN_ONLY, async (req, res) => {
  const months = Math.min(36, Math.max(3, Number(req.query.months) || 12));
  const keys = monthsBack(months);
  const since = new Date(`${keys[0]}-01T00:00:00Z`);

  const [issues, costs, contractorSpend] = await Promise.all([
    prisma.issue.findMany({
      where: { OR: [{ createdAt: { gte: since } }, { closedAt: { gte: since } }, { status: { not: "completed" } }] },
      select: {
        id: true,
        priority: true,
        status: true,
        createdAt: true,
        closedAt: true,
        dueDate: true,
        propertyId: true,
        technicianId: true,
        property: { select: { name: true } },
        technician: { select: { name: true, color: true } },
      },
    }),
    prisma.cost.findMany({ where: { incurredOn: { gte: `${keys[0]}-01` } }, select: { amount: true, quantity: true, incurredOn: true, kind: true, issue: { select: { propertyId: true } } } }),
    prisma.cost.groupBy({ by: ["contractorId"], _sum: { amount: true }, where: { contractorId: { not: null } } }),
  ]);

  const blank = () => ({ logged: 0, closed: 0, resolveDaysTotal: 0, resolvedCount: 0, spend: 0 });
  const byMonth = new Map(keys.map((k) => [k, blank()]));
  for (const issue of issues) {
    const logged = byMonth.get(monthKey(issue.createdAt));
    if (logged) logged.logged += 1;
    if (issue.closedAt) {
      const closed = byMonth.get(monthKey(issue.closedAt));
      if (closed) {
        closed.closed += 1;
        closed.resolveDaysTotal += (issue.closedAt.getTime() - issue.createdAt.getTime()) / 86_400_000;
        closed.resolvedCount += 1;
      }
    }
  }
  for (const c of costs) {
    const row = byMonth.get(c.incurredOn.slice(0, 7));
    if (row) row.spend += c.amount * c.quantity;
  }

  const today = dayFrom(new Date(), 0);
  const open = issues.filter((i) => i.status !== "completed");
  const byPriority = Object.fromEntries(PRIORITIES.map((p) => [p, open.filter((i) => i.priority === p).length]));

  // Per-property rollup, ordered by open workload.
  const propertyMap = new Map<string, { id: string; name: string; open: number; overdue: number; closed: number; spend: number }>();
  for (const issue of issues) {
    const row = propertyMap.get(issue.propertyId) ?? { id: issue.propertyId, name: issue.property.name, open: 0, overdue: 0, closed: 0, spend: 0 };
    if (issue.status === "completed") row.closed += 1;
    else {
      row.open += 1;
      if (issue.dueDate && issue.dueDate < today) row.overdue += 1;
    }
    propertyMap.set(issue.propertyId, row);
  }
  for (const c of costs) {
    const row = propertyMap.get(c.issue.propertyId);
    if (row) row.spend += c.amount * c.quantity;
  }

  const technicianMap = new Map<string, { name: string; color: string; closed: number; open: number; resolveDaysTotal: number; resolvedCount: number }>();
  for (const issue of issues) {
    if (!issue.technicianId || !issue.technician) continue;
    const row = technicianMap.get(issue.technicianId) ?? { name: issue.technician.name, color: issue.technician.color, closed: 0, open: 0, resolveDaysTotal: 0, resolvedCount: 0 };
    if (issue.status === "completed") {
      row.closed += 1;
      if (issue.closedAt) {
        row.resolveDaysTotal += (issue.closedAt.getTime() - issue.createdAt.getTime()) / 86_400_000;
        row.resolvedCount += 1;
      }
    } else row.open += 1;
    technicianMap.set(issue.technicianId, row);
  }

  const contractors = await prisma.contractor.findMany({ where: { id: { in: contractorSpend.map((c) => c.contractorId!).filter(Boolean) } }, select: { id: true, name: true } });
  const contractorNames = new Map(contractors.map((c) => [c.id, c.name]));

  const round = (n: number) => Math.round(n * 100) / 100;
  res.json({
    months: keys.map((key) => {
      const row = byMonth.get(key)!;
      return {
        month: key,
        logged: row.logged,
        closed: row.closed,
        spend: round(row.spend),
        avgResolveDays: row.resolvedCount ? round(row.resolveDaysTotal / row.resolvedCount) : null,
      };
    }),
    openByPriority: byPriority,
    openTotal: open.length,
    overdueTotal: open.filter((i) => i.dueDate && i.dueDate < today).length,
    byProperty: [...propertyMap.values()].map((p) => ({ ...p, spend: round(p.spend) })).sort((a, b) => b.open - a.open || b.spend - a.spend),
    byTechnician: [...technicianMap.values()]
      .map((t) => ({ name: t.name, color: t.color, open: t.open, closed: t.closed, avgResolveDays: t.resolvedCount ? round(t.resolveDaysTotal / t.resolvedCount) : null }))
      .sort((a, b) => b.closed - a.closed),
    byContractor: contractorSpend
      .map((c) => ({ name: contractorNames.get(c.contractorId!) ?? "Unknown", spend: round(c._sum.amount ?? 0) }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10),
  });
});

/** One row per property for the portfolio report: workload, spend and what's next. */
insightsRouter.get("/portfolio", ADMIN_ONLY, async (_req, res) => {
  const today = dayFrom(new Date(), 0);
  const [properties, issues, schedules] = await Promise.all([
    prisma.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, address: true } }),
    prisma.issue.findMany({
      select: {
        id: true,
        propertyId: true,
        title: true,
        priority: true,
        status: true,
        dueDate: true,
        createdAt: true,
        closedAt: true,
        technician: { select: { name: true } },
      },
    }),
    prisma.schedule.findMany({ where: { active: true }, select: { propertyId: true, title: true, nextDue: true }, orderBy: { nextDue: "asc" } }),
  ]);
  const costs = await costsByIssue(issues.map((i) => i.id));

  const rows = properties.map((property) => {
    const mine = issues.filter((i) => i.propertyId === property.id);
    const open = mine.filter((i) => i.status !== "completed");
    const closed = mine.filter((i) => i.status === "completed" && i.closedAt);
    const resolveDays = closed.map((i) => (i.closedAt!.getTime() - i.createdAt.getTime()) / 86_400_000);
    const spend = mine.reduce((sum, i) => sum + (costs.get(i.id)?.total ?? 0), 0);
    const next = schedules.find((s) => s.propertyId === property.id);
    return {
      id: property.id,
      name: property.name,
      address: property.address,
      openTotal: open.length,
      closedTotal: closed.length,
      byPriority: Object.fromEntries(PRIORITIES.map((p) => [p, open.filter((i) => i.priority === p).length])),
      overdue: open.filter((i) => i.dueDate && i.dueDate < today).length,
      spend: Math.round(spend * 100) / 100,
      avgResolveDays: resolveDays.length ? Math.round((resolveDays.reduce((a, b) => a + b, 0) / resolveDays.length) * 10) / 10 : null,
      nextScheduled: next ? { title: next.title, nextDue: next.nextDue } : null,
      attention: open
        .filter((i) => i.priority === "urgent" || i.priority === "high" || (i.dueDate && i.dueDate < today))
        .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
        .slice(0, 5)
        .map((i) => ({ id: i.id, title: i.title, priority: i.priority, dueDate: i.dueDate, technician: i.technician?.name ?? null })),
    };
  });

  res.json({ generatedAt: new Date().toISOString(), today, properties: rows });
});
