import { Router } from "express";
import { prisma } from "../db";
import { ADMIN_ONLY } from "../middleware/requireAuth";
import { runScheduledChecks } from "../lib/scheduler";

export const notificationsRouter = Router();

// The signed-in person's latest notifications plus their unread count.
notificationsRouter.get("/", async (req, res) => {
  const userId = req.user!.id;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { at: "desc" }, take: limit }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  res.json({ unread, items });
});

notificationsRouter.post("/read-all", async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

notificationsRouter.post("/:id/read", async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user!.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true, updated: result.count });
});

notificationsRouter.delete("/:id", async (req, res) => {
  await prisma.notification.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
  res.status(204).end();
});

// Lets an admin run the reminder sweep on demand (it also runs every 15 minutes).
notificationsRouter.post("/run-checks", ADMIN_ONLY, async (_req, res) => {
  const result = await runScheduledChecks();
  res.json(result);
});
