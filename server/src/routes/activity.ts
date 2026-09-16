import { Router } from "express";
import { prisma } from "../db";

export const activityRouter = Router();

activityRouter.get("/", async (req, res) => {
  const { issueId, propertyId, entityType } = req.query;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  const isTechnician = req.user?.role === "technician";
  const entries = await prisma.activity.findMany({
    where: {
      ...(issueId ? { issueId: String(issueId) } : {}),
      ...(propertyId ? { propertyId: String(propertyId) } : {}),
      ...(entityType ? { entityType: String(entityType) } : {}),
      // Technicians see the operational trail, not account administration.
      ...(isTechnician ? { entityType: { in: ["issue", "photo", "property"] } } : {}),
    },
    orderBy: { at: "desc" },
    take: limit,
  });
  res.json(entries);
});
