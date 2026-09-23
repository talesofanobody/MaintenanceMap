import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { parseOptionalString, ValidationError } from "../lib/validation";
import { UPLOADS_DIR } from "../lib/upload";

/**
 * The reviewer's side of guest reporting: read what came in, and turn it down or let
 * it through. Accepting happens on the issue create route instead, because the reviewer
 * is filling in a normal issue form — see `guestReportId` in routes/issues.ts.
 */
export const guestReportsRouter = Router();

const STATUSES = new Set(["pending", "accepted", "declined"]);

const REPORT_INCLUDE = {
  photos: { orderBy: { createdAt: "asc" as const } },
  property: { select: { id: true, name: true, centerLat: true, centerLng: true } },
  issue: { select: { id: true, title: true, status: true, priority: true } },
} as const;

guestReportsRouter.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" && STATUSES.has(req.query.status) ? req.query.status : undefined;
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
  const [reports, pendingCount] = await Promise.all([
    prisma.guestReport.findMany({
      where: { ...(status ? { status } : {}), ...(propertyId ? { propertyId } : {}) },
      include: REPORT_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.guestReport.count({ where: { status: "pending" } }),
  ]);
  res.json({ reports, pendingCount });
});

/** Just the badge number, polled by the header; cheap enough to call often. */
guestReportsRouter.get("/pending-count", async (_req, res) => {
  res.json({ pendingCount: await prisma.guestReport.count({ where: { status: "pending" } }) });
});

guestReportsRouter.get("/:id", async (req, res) => {
  const report = await prisma.guestReport.findUnique({ where: { id: req.params.id }, include: REPORT_INCLUDE });
  if (!report) return res.status(404).json({ error: "not found" });
  res.json(report);
});

// Turning a report down keeps it, with the reason, so the same complaint arriving
// three times reads as three declines rather than disappearing.
guestReportsRouter.post("/:id/decline", requires("request.review"), async (req, res) => {
  let note: string | null | undefined;
  try {
    note = parseOptionalString(req.body.note, "note", 500);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
  const existing = await prisma.guestReport.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not found" });
  if (existing.status !== "pending") return res.status(400).json({ error: `That report was already ${existing.status}.` });

  const report = await prisma.guestReport.update({
    where: { id: existing.id },
    data: { status: "declined", reviewedAt: new Date(), reviewedById: req.user!.id, reviewedBy: req.user!.username, reviewNote: note ?? null },
    include: REPORT_INCLUDE,
  });
  await logActivity(req, {
    action: "intake.declined",
    entityType: "guest_report",
    entityId: report.id,
    propertyId: report.propertyId,
    summary: `Turned down the guest report from ${report.roomName}${note ? `: ${note}` : ""}`,
  });
  res.json(report);
});

/** Undo a decline made in haste; an accepted report can't be reopened because it has an issue. */
guestReportsRouter.post("/:id/reopen", requires("request.review"), async (req, res) => {
  const existing = await prisma.guestReport.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not found" });
  if (existing.status !== "declined") return res.status(400).json({ error: "Only a declined report can be put back in the queue." });
  const report = await prisma.guestReport.update({
    where: { id: existing.id },
    data: { status: "pending", reviewedAt: null, reviewedById: null, reviewedBy: null, reviewNote: null },
    include: REPORT_INCLUDE,
  });
  await logActivity(req, {
    action: "intake.reopened",
    entityType: "guest_report",
    entityId: report.id,
    propertyId: report.propertyId,
    summary: `Put the guest report from ${report.roomName} back in the queue`,
  });
  res.json(report);
});

// Deleting is for junk and for clearing out old declines. An accepted report is kept:
// it is the audit trail explaining where its issue came from.
guestReportsRouter.delete("/:id", requires("request.delete"), async (req, res) => {
  const report = await prisma.guestReport.findUnique({ where: { id: req.params.id }, include: { photos: true } });
  if (!report) return res.status(404).json({ error: "not found" });
  if (report.status === "accepted") {
    return res.status(400).json({ error: "This report became an issue. Delete the issue instead if it shouldn't exist." });
  }
  await prisma.guestReport.delete({ where: { id: report.id } });
  // The rows are gone with the cascade; take their files with them.
  for (const photo of report.photos) {
    await fs.unlink(path.join(UPLOADS_DIR, photo.filename)).catch(() => {});
    if (photo.thumbFilename) await fs.unlink(path.join(UPLOADS_DIR, photo.thumbFilename)).catch(() => {});
  }
  await logActivity(req, {
    action: "intake.deleted",
    entityType: "guest_report",
    entityId: report.id,
    propertyId: report.propertyId,
    summary: `Deleted the guest report from ${report.roomName}`,
  });
  res.status(204).end();
});
