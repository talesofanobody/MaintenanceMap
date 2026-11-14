import { Router } from "express";
import { prisma } from "../db";

/** The most issues one dashboard payload will carry. */
const DASHBOARD_ISSUE_CAP = 1500;
import { serializeTechnician } from "./technicians";
import { OPEN_STATUSES } from "../lib/workflow";

export const dashboardRouter = Router();

// One aggregate payload for the display screens: every property outline, every
// open issue (plus those closed in the last week, for the summary), and the crew.
dashboardRouter.get("/", async (_req, res) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [properties, technicians, issues, activeEntries] = await Promise.all([
    prisma.property.findMany({
      select: { id: true, name: true, address: true, boundary: true, centerLat: true, centerLng: true },
      orderBy: { name: "asc" },
    }),
    prisma.technician.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    // Capped rather than unbounded. A dashboard drawing thirteen thousand pins is
    // not a dashboard, so it takes the most recent slice and the response says how
    // many there are in total — degrading into an honest number beats melting.
    prisma.issue.findMany({
      take: DASHBOARD_ISSUE_CAP,
      // Recently closed work still shows as "done today"; cancelled work was never
      // done, so it leaves the boards entirely.
      where: { OR: [{ status: { in: OPEN_STATUSES } }, { status: "completed", closedAt: { gte: since } }] },
      include: {
        property: { select: { id: true, name: true } },
        technician: { select: { id: true, name: true, color: true, trade: true } },
        photos: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 },
        checklist: { select: { done: true } },
        tags: { include: { tag: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    // Who is clocked in on what right now.
    prisma.timeEntry.findMany({ where: { endedAt: null }, select: { id: true, issueId: true, technicianId: true, startedAt: true } }),
  ]);

  res.json({
    generatedAt: new Date().toISOString(),
    properties: properties.map((p) => ({ ...p, boundary: p.boundary ? JSON.parse(p.boundary) : null })),
    technicians: technicians.map(serializeTechnician),
    issues,
    activeEntries,
  });
});
