import { Router } from "express";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { adminUserIds, notifyUsers, technicianUserId } from "../lib/notify";

export const messagesRouter = Router({ mergeParams: true });

/** Mounted at /api/issues/:id/messages, so the ids come from the parent route. */
function ids(req: { params: Record<string, string> }): { issueId: string; messageId: string } {
  return { issueId: req.params.id, messageId: req.params.messageId };
}

const MAX_LENGTH = 4000;

function readBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.trim();
  if (!body || body.length > MAX_LENGTH) return null;
  return body;
}

// Anyone signed in can read the thread, including a display screen.
messagesRouter.get("/", async (req, res) => {
  const messages = await prisma.message.findMany({ where: { issueId: ids(req).issueId }, orderBy: { createdAt: "asc" } });
  res.json(messages);
});

/**
 * Posting is open to admins and technicians on any issue, not just their own: the thread
 * is how they tell each other about access, parts and what they found.
 */
messagesRouter.post("/", requires("issue.write"), async (req, res) => {
  const body = readBody(req.body.body);
  if (!body) return res.status(400).json({ error: `A message needs some text, and at most ${MAX_LENGTH} characters.` });

  const issue = await prisma.issue.findUnique({
    where: { id: ids(req).issueId },
    select: { id: true, title: true, propertyId: true, technicianId: true, property: { select: { name: true } } },
  });
  if (!issue) return res.status(404).json({ error: "not found" });

  const message = await prisma.message.create({
    data: { issueId: issue.id, userId: req.user!.id, authorName: req.user!.username, body },
  });

  // Tell the people who are on this job, never the person who just typed it.
  const techUser = await technicianUserId(issue.technicianId);
  const admins = await adminUserIds();
  await notifyUsers(
    [techUser, ...admins],
    {
      kind: "message",
      title: `${req.user!.username} on "${issue.title}"`,
      body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
      issueId: issue.id,
      propertyId: issue.propertyId,
    },
    req.user!.id
  );

  res.status(201).json(message);
});

messagesRouter.put("/:messageId", requires("issue.write"), async (req, res) => {
  const body = readBody(req.body.body);
  if (!body) return res.status(400).json({ error: `A message needs some text, and at most ${MAX_LENGTH} characters.` });
  const { issueId, messageId } = ids(req);
  const existing = await prisma.message.findFirst({ where: { id: messageId, issueId } });
  if (!existing) return res.status(404).json({ error: "not found" });
  // Only the author rewrites their own words.
  if (existing.userId !== req.user!.id) return res.status(403).json({ error: "You can only edit your own messages." });
  const message = await prisma.message.update({ where: { id: existing.id }, data: { body, editedAt: new Date() } });
  res.json(message);
});

messagesRouter.delete("/:messageId", requires("issue.write"), async (req, res) => {
  const { issueId, messageId } = ids(req);
  const existing = await prisma.message.findFirst({ where: { id: messageId, issueId } });
  if (!existing) return res.status(404).json({ error: "not found" });
  if (existing.userId !== req.user!.id && req.user!.role !== "admin") {
    return res.status(403).json({ error: "You can only delete your own messages." });
  }
  await prisma.message.delete({ where: { id: existing.id } });
  res.status(204).end();
});
