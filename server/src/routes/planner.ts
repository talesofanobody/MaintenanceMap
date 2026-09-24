import { Router } from "express";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { DATE_ONLY, dayFrom } from "../lib/validation";
import { planDay } from "../lib/planner";
import { issueLine, notifyUsers, technicianUserId } from "../lib/notify";
import { OPEN_STATUSES } from "../lib/workflow";
import { syncAssignees } from "../lib/crew";

export const plannerRouter = Router();

/** Technicians may only plan their own day; admins plan anyone's. */
function resolveTechnicianId(req: any, requested: unknown): string | null {
  if (req.user.role === "technician") return req.user.technicianId ?? null;
  if (typeof requested === "string" && requested) return requested;
  return req.user.technicianId ?? null;
}

plannerRouter.get("/", async (req, res) => {
  const technicianId = resolveTechnicianId(req, req.query.technicianId);
  if (!technicianId) return res.status(400).json({ error: "Pick a team member to plan for." });
  const day = typeof req.query.day === "string" && DATE_ONLY.test(req.query.day) ? req.query.day : dayFrom(new Date(), 0);
  const propertyId = typeof req.query.propertyId === "string" && req.query.propertyId ? req.query.propertyId : undefined;
  const plan = await planDay(technicianId, day, { propertyId });
  if (!plan) return res.status(404).json({ error: "Team member not found" });
  res.json(plan);
});

// Pins the chosen jobs to the day and assigns them to the technician.
plannerRouter.post("/apply", requires("issue.assign"), async (req, res) => {
  const technicianId = resolveTechnicianId(req, req.body.technicianId);
  if (!technicianId) return res.status(400).json({ error: "Pick a team member to plan for." });
  const { day, issueIds } = req.body;
  if (typeof day !== "string" || !DATE_ONLY.test(day)) return res.status(400).json({ error: "day must be YYYY-MM-DD" });
  if (!Array.isArray(issueIds) || issueIds.some((id) => typeof id !== "string")) return res.status(400).json({ error: "issueIds must be a list of issue ids" });
  if (issueIds.length === 0) return res.status(400).json({ error: "Pick at least one job." });

  const technician = await prisma.technician.findUnique({ where: { id: technicianId } });
  if (!technician) return res.status(404).json({ error: "Team member not found" });

  const issues = await prisma.issue.findMany({ where: { id: { in: issueIds }, status: { in: OPEN_STATUSES } }, include: { property: { select: { name: true } } } });
  if (issues.length === 0) return res.status(400).json({ error: "None of those jobs are open." });
  // A technician can't quietly take work that belongs to someone else.
  if (req.user!.role === "technician" && issues.some((i) => i.technicianId && i.technicianId !== technicianId)) {
    return res.status(403).json({ error: "Some of those jobs are assigned to someone else." });
  }

  await prisma.issue.updateMany({ where: { id: { in: issues.map((i) => i.id) } }, data: { scheduledFor: day, technicianId } });
  // Applying a plan assigns the lead; mirror it so the crew table agrees.
  for (const issue of issues) await syncAssignees(issue.id, [technicianId]);
  await logActivity(req, {
    action: "planner.applied",
    entityType: "technician",
    entityId: technicianId,
    summary: `Planned ${issues.length} job${issues.length === 1 ? "" : "s"} for ${technician.name} on ${day}`,
    details: { day, issues: issues.map((i) => i.title) },
  });

  const techUser = await technicianUserId(technicianId);
  if (techUser) {
    const newlyTheirs = issues.filter((i) => i.technicianId !== technicianId || i.scheduledFor !== day);
    for (const issue of newlyTheirs) {
      await notifyUsers(
        [techUser],
        {
          kind: "assigned",
          title: `Planned for ${day}: ${issue.title}`,
          body: issueLine({ ...issue, scheduledFor: day }, issue.property.name),
          issueId: issue.id,
          propertyId: issue.propertyId,
        },
        req.user!.id
      );
    }
  }

  const plan = await planDay(technicianId, day);
  res.json({ applied: issues.length, plan });
});
