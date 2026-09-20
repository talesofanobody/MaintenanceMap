import { prisma } from "../db";
import { ValidationError } from "./validation";

/** A job can have a lead and three other pairs of hands. Beyond that it's two jobs. */
export const MAX_ASSIGNEES = 4;

/**
 * Reads the crew off a request body. `technicianIds` is the whole crew, first one
 * leading; the older single `technicianId` still works and means a crew of one, so
 * nothing that already talks to this API had to change.
 */
export async function resolveAssignees(body: Record<string, any>): Promise<string[] | undefined> {
  const given = body.technicianIds;
  if (given === undefined) {
    if (body.technicianId === undefined) return undefined;
    return body.technicianId ? [String(body.technicianId)] : [];
  }
  if (given === null) return [];
  if (!Array.isArray(given)) throw new ValidationError("technicianIds must be a list");

  const ids = [...new Set(given.map(String).filter(Boolean))];
  if (ids.length > MAX_ASSIGNEES) {
    throw new ValidationError(`An issue can have at most ${MAX_ASSIGNEES} technicians on it.`);
  }
  if (ids.length === 0) return [];
  const found = await prisma.technician.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== ids.length) throw new ValidationError("one or more technicians no longer exist");
  // Keep the caller's order: the first is the lead.
  return ids;
}

/**
 * Makes the join table match exactly this crew, and returns the lead. Rows are only
 * added and removed where they differ, so a save that doesn't touch the crew leaves
 * the "assigned at" timestamps alone.
 */
export async function syncAssignees(issueId: string, technicianIds: string[]): Promise<string | null> {
  const existing = await prisma.issueAssignee.findMany({ where: { issueId }, select: { technicianId: true } });
  const have = new Set(existing.map((a) => a.technicianId));
  const want = new Set(technicianIds);

  const remove = [...have].filter((id) => !want.has(id));
  const add = technicianIds.filter((id) => !have.has(id));

  if (remove.length) await prisma.issueAssignee.deleteMany({ where: { issueId, technicianId: { in: remove } } });
  for (const technicianId of add) {
    await prisma.issueAssignee.create({ data: { issueId, technicianId } });
  }
  return technicianIds[0] ?? null;
}

/** Every issue id this technician is on, as lead or otherwise. */
export async function issueIdsFor(technicianId: string): Promise<string[]> {
  const rows = await prisma.issueAssignee.findMany({ where: { technicianId }, select: { issueId: true } });
  return rows.map((r) => r.issueId);
}

/**
 * Whether this technician is on this issue at all. Permission checks use it so a
 * second or third pair of hands can update the job they were sent to, not just the lead.
 *
 * The lead field counts on its own. The join table mirrors it, but a row could be
 * missing — and locking the named technician out of their own job would be a far worse
 * failure than trusting the field the rest of the app already treats as authoritative.
 */
export async function isOnCrew(issueId: string, technicianId: string | null | undefined): Promise<boolean> {
  if (!technicianId) return false;
  const issue = await prisma.issue.findUnique({ where: { id: issueId }, select: { technicianId: true } });
  if (issue?.technicianId === technicianId) return true;
  const row = await prisma.issueAssignee.findUnique({ where: { issueId_technicianId: { issueId, technicianId } } });
  return !!row;
}
