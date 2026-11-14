/**
 * The arithmetic and the guard rails behind project planning.
 *
 * Kept apart from the routes and free of Prisma on purpose: a rollup and a cycle
 * check are the two things most worth testing, and neither should need a database
 * to be exercised. The routes supply the rows; this decides what they mean.
 */

/** The department rule: a contractor job wants at least this many quotes. */
export const QUOTES_REQUIRED = 3;

export interface RollupIssue {
  id: string;
  parentId: string | null;
  status: string;
  isMilestone: boolean;
  estimatedHours: number | null;
  actualHours: number | null;
  costs: { amount: number; quantity: number }[];
}

export interface Rollup {
  total: number;
  /** Items that are nobody's parent — the ones that represent actual work. */
  leaves: number;
  open: number;
  done: number;
  milestones: number;
  milestonesHit: number;
  /** Per cent complete over leaves only. */
  progress: number;
  estimatedHours: number;
  actualHours: number;
  /** Money already spent, from recorded costs. */
  actualCost: number;
}

/**
 * Progress is measured over leaves, never over everything.
 *
 * A parent's completion is only a restatement of its children's, so counting both
 * double-counts the same work and makes a deep plan look further along than a flat
 * one. Milestones are excluded from the work count for the same reason — a dateline
 * is not effort — but they are reported separately, because "three of five
 * milestones hit" is the sentence a general manager actually wants.
 */
export function rollUp(issues: RollupIssue[], isClosed: (status: string) => boolean): Rollup {
  const parentIds = new Set(issues.map((i) => i.parentId).filter((v): v is string => !!v));
  const leaves = issues.filter((i) => !parentIds.has(i.id) && !i.isMilestone);
  const milestones = issues.filter((i) => i.isMilestone);

  const done = leaves.filter((i) => i.status === "completed").length;
  const open = leaves.filter((i) => !isClosed(i.status)).length;

  let estimatedHours = 0;
  let actualHours = 0;
  let actualCost = 0;
  for (const i of issues) {
    // Hours and money are summed over every item, not only leaves: a cost booked
    // against a parent is still real money, and refusing to count it would make
    // the total quietly wrong.
    estimatedHours += i.estimatedHours ?? 0;
    actualHours += i.actualHours ?? 0;
    for (const c of i.costs) actualCost += c.amount * (c.quantity ?? 1);
  }

  return {
    total: issues.length,
    leaves: leaves.length,
    open,
    done,
    milestones: milestones.length,
    milestonesHit: milestones.filter((m) => m.status === "completed").length,
    progress: leaves.length ? Math.round((done / leaves.length) * 100) : 0,
    estimatedHours: round2(estimatedHours),
    actualHours: round2(actualHours),
    actualCost: round2(actualCost),
  };
}

export interface BudgetView {
  approved: number | null;
  /** Awarded quotes — money promised to somebody but not yet necessarily spent. */
  committed: number;
  actual: number;
  /** Approved less the larger of committed and actual. Null when nothing is approved. */
  remaining: number | null;
  overBudget: boolean;
}

/**
 * Committed and actual are deliberately not added together.
 *
 * An awarded quote usually becomes the invoice that is then recorded as a cost, so
 * summing both counts the same money twice. Taking the larger of the two is the
 * honest reading: before the invoice arrives the award is the better estimate, and
 * afterwards the recorded cost is.
 */
export function budgetView(approved: number | null, awardedQuotes: number[], actual: number): BudgetView {
  const committed = round2(awardedQuotes.reduce((n, a) => n + a, 0));
  const spentOrPromised = Math.max(committed, actual);
  return {
    approved,
    committed,
    actual: round2(actual),
    remaining: approved === null ? null : round2(approved - spentOrPromised),
    overBudget: approved !== null && spentOrPromised > approved,
  };
}

export interface QuoteState {
  total: number;
  received: number;
  awarded: number;
  /** Whether the three-quote rule is satisfied. */
  satisfied: boolean;
  /** How many more are needed. */
  outstanding: number;
}

/**
 * The three-quote rule, as a field rather than a recollection.
 *
 * Counts *received* quotes, not requested ones: three requests and one answer does
 * not let you award anything, and a rule that counted requests would be trivially
 * satisfied by sending three emails.
 */
export function quoteState(quotes: { status: string }[], required = QUOTES_REQUIRED): QuoteState {
  const received = quotes.filter((q) => q.status === "received" || q.status === "awarded").length;
  const awarded = quotes.filter((q) => q.status === "awarded").length;
  return {
    total: quotes.length,
    received,
    awarded,
    satisfied: received >= required,
    outstanding: Math.max(0, required - received),
  };
}

/** Days between two YYYY-MM-DD dates, or null if either is missing. */
export function daysBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * Slippage against the plan: positive means later than agreed.
 *
 * This is the whole reason baselines are stored separately. Overwriting the planned
 * date with the current one loses the only number that says whether a project is
 * drifting, and a project that has quietly moved four times looks identical to one
 * that has never moved at all.
 */
export function slippageDays(baselineEnd: string | null, plannedEnd: string | null): number | null {
  return daysBetween(baselineEnd, plannedEnd);
}

/** How far a walk up a parent chain or along a dependency graph may go. */
export const MAX_GRAPH_WALK = 200;

/**
 * Would making `parentId` the parent of `childId` create a loop?
 *
 * Walks up from the proposed parent looking for the child. A loop here is not a
 * cosmetic problem: every rollup, every tree render and every scheduling pass walks
 * this structure, so one cycle hangs all three. The walk is bounded as well as
 * cycle-aware, because a database that already contains a loop must not take this
 * check down with it.
 */
export async function wouldCycleInHierarchy(
  childId: string,
  parentId: string,
  getParent: (id: string) => Promise<string | null>
): Promise<boolean> {
  if (childId === parentId) return true;
  const seen = new Set<string>([childId]);
  let cursor: string | null = parentId;
  for (let step = 0; cursor && step < MAX_GRAPH_WALK; step += 1) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = await getParent(cursor);
  }
  return false;
}

/**
 * Would a `from -> to` dependency create a loop?
 *
 * Follows the graph forward from `to`; if it reaches `from`, the new edge closes a
 * cycle and the plan becomes unschedulable — A after B after A has no start date.
 * Only ordering links are checked. A "relates" edge asserts nothing about time, so
 * two jobs may perfectly well relate to each other.
 */
export async function wouldCycleInLinks(
  fromId: string,
  toId: string,
  getSuccessors: (id: string) => Promise<string[]>
): Promise<boolean> {
  if (fromId === toId) return true;
  const seen = new Set<string>();
  const queue = [toId];
  let steps = 0;
  while (queue.length && steps < MAX_GRAPH_WALK) {
    const node = queue.shift()!;
    if (node === fromId) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    steps += 1;
    for (const next of await getSuccessors(node)) if (!seen.has(next)) queue.push(next);
  }
  return false;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
