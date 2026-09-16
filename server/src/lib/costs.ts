import { prisma } from "../db";

export const COST_KINDS = new Set(["parts", "contractor", "hire", "other"]);

export interface IssueCostSummary {
  /** Recorded spend (parts, contractor invoices, hire…). */
  recorded: number;
  /** Clocked hours valued at the technician's rate, when one is set. */
  labour: number;
  labourHours: number;
  total: number;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Money on one issue: recorded cost lines plus labour valued from its time entries. */
export async function issueCosts(issueId: string): Promise<IssueCostSummary> {
  const [costs, entries] = await Promise.all([
    prisma.cost.findMany({ where: { issueId }, select: { amount: true, quantity: true } }),
    prisma.timeEntry.findMany({
      where: { issueId, endedAt: { not: null } },
      select: { startedAt: true, endedAt: true, technician: { select: { hourlyRate: true } } },
    }),
  ]);
  const recorded = costs.reduce((sum, c) => sum + c.amount * (c.quantity || 1), 0);
  let labour = 0;
  let labourHours = 0;
  for (const e of entries) {
    const hours = ((e.endedAt as Date).getTime() - e.startedAt.getTime()) / 3_600_000;
    labourHours += hours;
    labour += hours * (e.technician.hourlyRate ?? 0);
  }
  return { recorded: round(recorded), labour: round(labour), labourHours: round(labourHours), total: round(recorded + labour) };
}

/** Same figures for many issues at once (report, export, dashboards). */
export async function costsByIssue(issueIds: string[]): Promise<Map<string, IssueCostSummary>> {
  const out = new Map<string, IssueCostSummary>();
  if (issueIds.length === 0) return out;
  const [costs, entries] = await Promise.all([
    prisma.cost.findMany({ where: { issueId: { in: issueIds } }, select: { issueId: true, amount: true, quantity: true } }),
    prisma.timeEntry.findMany({
      where: { issueId: { in: issueIds }, endedAt: { not: null } },
      select: { issueId: true, startedAt: true, endedAt: true, technician: { select: { hourlyRate: true } } },
    }),
  ]);
  const blank = (): IssueCostSummary => ({ recorded: 0, labour: 0, labourHours: 0, total: 0 });
  for (const id of issueIds) out.set(id, blank());
  for (const c of costs) {
    const row = out.get(c.issueId) ?? blank();
    row.recorded += c.amount * (c.quantity || 1);
    out.set(c.issueId, row);
  }
  for (const e of entries) {
    const row = out.get(e.issueId) ?? blank();
    const hours = ((e.endedAt as Date).getTime() - e.startedAt.getTime()) / 3_600_000;
    row.labourHours += hours;
    row.labour += hours * (e.technician.hourlyRate ?? 0);
    out.set(e.issueId, row);
  }
  for (const [id, row] of out) {
    out.set(id, { recorded: round(row.recorded), labour: round(row.labour), labourHours: round(row.labourHours), total: round(row.recorded + row.labour) });
  }
  return out;
}
