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

// ---------------------------------------------------------------------------
// Blockers and stakeholders: the vocabulary, kept here with the rest of the
// planning domain so the routes and the client agree on one list.
// ---------------------------------------------------------------------------

/** The kinds of thing that actually recur as impediments. */
export const BLOCKER_KINDS = ["parts", "approval", "access", "contractor", "information", "weather", "budget", "other"] as const;
export type BlockerKind = (typeof BLOCKER_KINDS)[number];

/**
 * Stakeholder roles, following the usual responsibility split rather than a
 * vocabulary of our own. The common failure in a maintenance programme is not
 * disagreement — it is somebody finding out late — so the useful thing is simply
 * writing down who is in which group.
 */
export const STAKEHOLDER_ROLES = ["sponsor", "approver", "accountable", "consulted", "informed"] as const;
export type StakeholderRole = (typeof STAKEHOLDER_ROLES)[number];

export interface BlockerRow {
  raisedAt: Date | string;
  clearedAt: Date | string | null;
}

export interface BlockerSummary {
  open: number;
  cleared: number;
  /** Age in days of the oldest thing still in the way. */
  oldestOpenDays: number | null;
  /** Mean days a cleared blocker sat there — how long things take to shift. */
  meanDaysToClear: number | null;
}

/**
 * How bad the blocking situation is, in two numbers people can act on.
 *
 * The age of the oldest open blocker is the one that matters: a stand-up can
 * absorb three raised this morning and cannot absorb one that has been sitting
 * for a month. Mean time to clear is the honest counterweight — it says whether
 * this place actually clears things or merely records them.
 */
export function blockerSummary(rows: BlockerRow[], now = new Date()): BlockerSummary {
  const ms = (v: Date | string) => (v instanceof Date ? v.getTime() : Date.parse(v));
  const open = rows.filter((b) => !b.clearedAt);
  const cleared = rows.filter((b) => b.clearedAt);

  const oldest = open.reduce<number | null>((worst, b) => {
    const days = Math.floor((now.getTime() - ms(b.raisedAt)) / 86400000);
    return worst === null || days > worst ? days : worst;
  }, null);

  const clearDays = cleared.map((b) => Math.max(0, (ms(b.clearedAt!) - ms(b.raisedAt)) / 86400000));
  return {
    open: open.length,
    cleared: cleared.length,
    oldestOpenDays: oldest,
    meanDaysToClear: clearDays.length ? round2(clearDays.reduce((a, b) => a + b, 0) / clearDays.length) : null,
  };
}

// ---------------------------------------------------------------------------
// Critical path
// ---------------------------------------------------------------------------

export interface ScheduleItem {
  id: string;
  /** YYYY-MM-DD. Both are needed; an item missing either cannot be scheduled. */
  start: string | null;
  end: string | null;
  isMilestone: boolean;
  /**
   * True when this item has children. A summary row's dates are an envelope around
   * its children rather than work in its own right, so it takes no part in the
   * analysis — see the note on `analyseSchedule`.
   */
  isSummary?: boolean;
}

/**
 * The kinds that constrain dates, and the two that do not.
 *
 * Finish-to-start on its own cannot describe heavy work. Shoring starts two days
 * after excavation starts and then runs alongside it; curing finishes when the
 * pour finishes. Those are start-to-start and finish-to-finish, and a programme
 * without them has to be faked with padded durations that then lie about float.
 */
export const LINK_KINDS = ["precedes", "starts_after_start", "finishes_after_finish", "blocks", "relates"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** The ones the schedule pass actually acts on. */
export const ORDERING_KINDS: readonly string[] = ["precedes", "starts_after_start", "finishes_after_finish"];

export interface ScheduleLink {
  fromId: string;
  toId: string;
  kind: string;
  lagDays: number | null;
}

export interface ScheduledItem {
  id: string;
  /**
   * Working-day ordinals, inclusive. Differences between them are therefore in
   * working days, which is what float means once a calendar exists. Without a
   * calendar every day is a working day and these are plain day numbers.
   */
  earliestStart: number;
  earliestFinish: number;
  latestStart: number;
  latestFinish: number;
  /** The same four as dates, so a reader never has to invert the calendar. */
  earliestStartDate: string;
  earliestFinishDate: string;
  latestStartDate: string;
  latestFinishDate: string;
  /** Days this can slip before it moves the end of the project. */
  floatDays: number;
  critical: boolean;
}

/** A planned start that its own dependencies do not permit. */
export interface ScheduleViolation {
  id: string;
  plannedStart: string;
  earliestStart: string;
  /** How many days too early the plan has it starting. */
  tooEarlyByDays: number;
}

export interface ScheduleAnalysis {
  items: Record<string, ScheduledItem>;
  /** The ids with no slack against the plan as typed, in date order. */
  criticalPath: string[];
  /**
   * The longest chain of dependent work by duration alone, which is where the end
   * date comes from. Reported separately from `criticalPath` because the two
   * answer different questions — see the note on `analyseSchedule`.
   */
  longestChain: string[];
  longestChainDays: number;
  /**
   * Plans that contradict their own dependencies: a job typed to start before the
   * thing it follows can possibly finish. Usually the most actionable output here.
   */
  violations: ScheduleViolation[];
  projectStart: string | null;
  projectEnd: string | null;
  /** Items left out because they have no dates. Reported, never silently dropped. */
  unscheduled: string[];
  /** Summary rows, excluded deliberately rather than for want of dates. */
  summaries: string[];
  /** True when a working calendar was applied, so days above are working days. */
  workingDays: boolean;
  /**
   * True when the ordering links contain a loop. The routes refuse to create one,
   * so this should not happen — but a schedule pass must not hang on data that
   * already has one, and saying so beats looping or lying.
   */
  cyclic: boolean;
}

const DAY = 86400000;
const toDay = (iso: string): number => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const fromDay = (day: number): string => new Date(day * DAY).toISOString().slice(0, 10);

/** Day 0 of the epoch was a Thursday, so Monday-first weekday is (day + 3) % 7. */
const weekdayOf = (day: number): number => (((day + 3) % 7) + 7) % 7;

/** Which days work happens on. */
export interface CalendarSpec {
  /** Seven booleans, Monday first. */
  workingWeekdays: boolean[];
  /** YYYY-MM-DD → whether that day is worked, overriding the weekly pattern. */
  exceptions: Record<string, boolean>;
}

/**
 * No calendar at all: every day counts.
 *
 * This is the default, and it is what the app did before calendars existed. It
 * means adding this machinery changes nothing until somebody sets a calendar up,
 * which matters because a calendar alters every float figure on a programme.
 */
export const EVERY_DAY: CalendarSpec = {
  workingWeekdays: [true, true, true, true, true, true, true],
  exceptions: {},
};

export interface WorkingTime {
  isWorking(day: number): boolean;
  /** Working-day ordinal. A non-working day snaps forward to the next worked one. */
  indexOf(day: number): number;
  /** The calendar day at a working-day ordinal. */
  dayAt(index: number): number;
  /** Working days in [a, b] inclusive. */
  count(a: number, b: number): number;
  /** False when the calendar excludes nothing, so callers can skip the fuss. */
  restricted: boolean;
}

/**
 * A working-day index over a bounded window.
 *
 * Built as an explicit list rather than computed arithmetically from week
 * patterns. The arithmetic version is a page of modular reasoning that has to get
 * exceptions, both directions of them, and partial weeks right; the list is a loop
 * anybody can check. A window of a few years is about a thousand entries, which is
 * nothing, and the schedule pass only ever needs one window.
 *
 * Every date calculation downstream happens in this index space. That is the whole
 * trick: once a day number means "the nth working day", finish-to-start, lag and
 * float are the same sums they were before, and none of them has to know which
 * days are worked.
 */
export function makeWorkingTime(spec: CalendarSpec, windowStart: number, windowEnd: number): WorkingTime {
  const restricted = spec.workingWeekdays.some((w) => !w) || Object.keys(spec.exceptions).length > 0;

  const worksOn = (day: number): boolean => {
    const override = spec.exceptions[fromDay(day)];
    if (override !== undefined) return override;
    return spec.workingWeekdays[weekdayOf(day)] ?? true;
  };

  if (!restricted) {
    // Nothing is excluded, so the index is the day number itself.
    return {
      isWorking: () => true,
      indexOf: (day) => day,
      dayAt: (index) => index,
      count: (a, b) => Math.max(0, b - a + 1),
      restricted: false,
    };
  }

  const first = windowStart;
  const last = Math.max(windowEnd, windowStart);
  const days: number[] = [];
  const indexByDay = new Map<number, number>();
  for (let day = first; day <= last; day += 1) {
    if (worksOn(day)) {
      indexByDay.set(day, days.length);
      days.push(day);
    }
  }

  // For a non-working day, the ordinal of the next worked day. One backward pass.
  const snapForward = new Map<number, number>();
  let nextIndex = days.length; // past the end, for trailing non-working days
  for (let day = last; day >= first; day -= 1) {
    const own = indexByDay.get(day);
    if (own !== undefined) nextIndex = own;
    snapForward.set(day, nextIndex);
  }

  return {
    isWorking: worksOn,
    indexOf: (day) => {
      const own = indexByDay.get(day);
      if (own !== undefined) return own;
      const snapped = snapForward.get(day);
      if (snapped !== undefined) return snapped;
      // Outside the window: fall back to proportional, which only happens for
      // dates the caller did not declare and never feeds a stored result.
      return day < first ? 0 : days.length;
    },
    dayAt: (index) => {
      if (index < 0) return days[0] ?? first;
      if (index >= days.length) {
        // Past the window. Extend by whole weeks, which is right for a weekly
        // pattern and close enough for a tail nobody has put exceptions on.
        const perWeek = Math.max(1, spec.workingWeekdays.filter(Boolean).length);
        const over = index - days.length + 1;
        return (days[days.length - 1] ?? last) + Math.ceil(over / perWeek) * 7;
      }
      return days[index];
    },
    count: (a, b) => {
      if (b < a) return 0;
      let n = 0;
      for (let day = a; day <= b; day += 1) if (worksOn(day)) n += 1;
      return n;
    },
    restricted: true,
  };
}

/**
 * Forward and backward pass over the dependency graph, producing three different
 * answers because people keep asking three different questions.
 *
 * **Float, and `criticalPath`.** Slack against the plan *as typed*. Everything here
 * has dates somebody chose, so a planned start acts as a "not before this" and
 * float measures the gap to whatever comes next. That makes it operationally true —
 * how long can this slip before something else has to move.
 *
 * With a working calendar this is counted in **working days**, which is the point of
 * having one: a job finishing Friday and the next starting Monday had two days of
 * float when every day counted, and has one when Sunday is not worked. Every float
 * figure was slightly generous before, and generous float is the kind that gets
 * believed. Without a calendar, every day counts and the numbers are unchanged.
 *
 * **`longestChain`.** The chain of dependent work with the greatest total duration,
 * computed from durations alone and ignoring the typed starts. This is the classic
 * sense of a critical path — where the end date comes from — and unlike float it is
 * stable against gaps somebody left in the calendar. It is what a chart should
 * highlight. A single unlinked activity can be the longest; that is correct, and it
 * is not a chain, so anything displaying it should say which it has.
 *
 * **`violations`.** Jobs the plan has starting earlier than their own dependencies
 * permit. This tends to be the most useful output of the three, because it finds
 * plans that contradict themselves rather than merely describing one.
 *
 * **Summary rows take no part in any of it.** A parent's dates are an envelope
 * around its children, so letting it compete is how a phase spanning two months
 * comes out as "the longest chain" while the actual chain of dependent work inside
 * it is ignored. It is the same reason the progress rollup counts leaves only: a
 * parent restates its children rather than adding to them.
 *
 * A milestone occupies the single working day it falls on rather than zero days.
 * Classic CPM gives it zero duration, which makes finish fall before start and needs
 * a special case in every expression; one day is consistent and shifts nothing.
 */
export function analyseSchedule(
  items: ScheduleItem[],
  links: ScheduleLink[],
  calendar: CalendarSpec = EVERY_DAY
): ScheduleAnalysis {
  const summaries = items.filter((i) => i.isSummary).map((i) => i.id);
  const work = items.filter((i) => !i.isSummary);
  const schedulable = work.filter((i) => i.start && i.end);
  const unscheduled = work.filter((i) => !i.start || !i.end).map((i) => i.id);
  const ids = new Set(schedulable.map((i) => i.id));

  const empty = (cyclic: boolean): ScheduleAnalysis => ({
    items: {},
    criticalPath: [],
    longestChain: [],
    longestChainDays: 0,
    violations: [],
    projectStart: null,
    projectEnd: null,
    unscheduled,
    summaries,
    cyclic,
    workingDays: calendar !== EVERY_DAY,
  });

  if (!schedulable.length) return empty(false);

  // A window wide enough to hold the plan and anything it could be pushed into.
  const allDays = schedulable.flatMap((i) => [toDay(i.start!), toDay(i.end!)]);
  const wt = makeWorkingTime(calendar, Math.min(...allDays) - 14, Math.max(...allDays) + 1100);

  const ordering = links.filter((l) => ORDERING_KINDS.includes(l.kind) && ids.has(l.fromId) && ids.has(l.toId));
  const succ = new Map<string, ScheduleLink[]>();
  const pred = new Map<string, ScheduleLink[]>();
  for (const l of ordering) {
    (succ.get(l.fromId) ?? succ.set(l.fromId, []).get(l.fromId)!).push(l);
    (pred.get(l.toId) ?? pred.set(l.toId, []).get(l.toId)!).push(l);
  }

  // Everything from here on is in working-day ordinals, not calendar days.
  const dur = new Map<string, number>();
  const ownStart = new Map<string, number>();
  for (const i of schedulable) {
    const startDay = toDay(i.start!);
    const endDay = Math.max(toDay(i.end!), startDay);
    const startIdx = wt.indexOf(startDay);
    ownStart.set(i.id, startIdx);
    // Counted from the snapped start, so a job nominally starting on a Sunday is
    // not credited with a day nobody worked.
    const snapped = wt.dayAt(startIdx);
    dur.set(i.id, Math.max(1, wt.count(snapped, Math.max(endDay, snapped))));
  }

  // Topological order by Kahn's algorithm. If it cannot consume every node the
  // graph has a loop, and no amount of passing over it will help.
  const indegree = new Map<string, number>();
  for (const id of ids) indegree.set(id, (pred.get(id) ?? []).length);
  const queue = [...ids].filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const l of succ.get(id) ?? []) {
      const left = (indegree.get(l.toId) ?? 0) - 1;
      indegree.set(l.toId, left);
      if (left === 0) queue.push(l.toId);
    }
  }
  if (order.length !== ids.size) return empty(true);

  /**
   * The earliest `to` may start, given one constraint from `from`.
   *
   * Finish-to-start pushes past the predecessor's finish. Start-to-start pushes
   * past its start, so the two run together with an offset. Finish-to-finish
   * constrains the finish, which becomes a start by subtracting the duration —
   * which is why a finish-to-finish link on a long successor can pull its start
   * earlier than its predecessor's, correctly. All in working days.
   */
  const earliestFrom = (kind: string, fromStart: number, fromFinish: number, lag: number, toDur: number): number => {
    switch (kind) {
      case "starts_after_start":
        return fromStart + lag;
      case "finishes_after_finish":
        return fromFinish + lag - toDur + 1;
      default:
        return fromFinish + lag + 1;
    }
  };

  /** The mirror, for the backward pass: the latest `from` may finish. */
  const latestFrom = (kind: string, toStart: number, toFinish: number, lag: number, fromDur: number): number => {
    switch (kind) {
      case "starts_after_start":
        // from must START by toStart - lag, so it may FINISH that much later.
        return toStart - lag + fromDur - 1;
      case "finishes_after_finish":
        return toFinish - lag;
      default:
        return toStart - lag - 1;
    }
  };

  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  const violations: ScheduleViolation[] = [];
  for (const id of order) {
    const planned = ownStart.get(id)!;
    let start = planned;
    for (const l of pred.get(id) ?? []) {
      const at = earliestFrom(l.kind, es.get(l.fromId)!, ef.get(l.fromId)!, l.lagDays ?? 0, dur.get(id)!);
      if (at > start) start = at;
    }
    if (start > planned) {
      violations.push({
        id,
        plannedStart: fromDay(wt.dayAt(planned)),
        earliestStart: fromDay(wt.dayAt(start)),
        // In working days, which is what "too early" means once a calendar exists.
        tooEarlyByDays: start - planned,
      });
    }
    es.set(id, start);
    ef.set(id, start + dur.get(id)! - 1);
  }

  /**
   * A second forward pass, anchored at zero and ignoring the typed starts, used
   * only to find the longest chain.
   *
   * Running it separately is what keeps the chain stable: the first pass answers
   * "when can this happen, given the dates people chose", and a gap left over a
   * weekend changes that. This one answers "which run of dependent work is
   * longest", which a gap in somebody's calendar should not change at all.
   */
  const anchorStart = new Map<string, number>();
  const anchorFinish = new Map<string, number>();
  const chainPrev = new Map<string, string | null>();
  for (const id of order) {
    let start = 0;
    let via: string | null = null;
    for (const l of pred.get(id) ?? []) {
      const at = earliestFrom(l.kind, anchorStart.get(l.fromId)!, anchorFinish.get(l.fromId)!, l.lagDays ?? 0, dur.get(id)!);
      if (at > start) {
        start = at;
        via = l.fromId;
      }
    }
    anchorStart.set(id, start);
    anchorFinish.set(id, start + dur.get(id)! - 1);
    chainPrev.set(id, via);
  }
  let chainTail: string | null = null;
  let longestChainDays = 0;
  for (const id of order) {
    const finish = anchorFinish.get(id)! + 1;
    if (finish > longestChainDays) {
      longestChainDays = finish;
      chainTail = id;
    }
  }
  const longestChain: string[] = [];
  for (let cursor = chainTail; cursor; cursor = chainPrev.get(cursor) ?? null) longestChain.unshift(cursor);

  const projectEnd = Math.max(...[...ef.values()]);
  const projectStart = Math.min(...[...es.values()]);

  // Backward pass: the latest anything can happen without moving the end.
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const outgoing = succ.get(id) ?? [];
    let finish = outgoing.length ? Infinity : projectEnd;
    for (const l of outgoing) {
      const before = latestFrom(l.kind, ls.get(l.toId)!, lf.get(l.toId)!, l.lagDays ?? 0, dur.get(id)!);
      if (before < finish) finish = before;
    }
    lf.set(id, finish);
    ls.set(id, finish - dur.get(id)! + 1);
  }

  const out: Record<string, ScheduledItem> = {};
  for (const id of ids) {
    const slack = ls.get(id)! - es.get(id)!;
    out[id] = {
      id,
      earliestStart: es.get(id)!,
      earliestFinish: ef.get(id)!,
      latestStart: ls.get(id)!,
      latestFinish: lf.get(id)!,
      // The same four as dates, since a working-day ordinal means nothing to a
      // reader and a caller should not have to invert the calendar itself.
      earliestStartDate: fromDay(wt.dayAt(es.get(id)!)),
      earliestFinishDate: fromDay(wt.dayAt(ef.get(id)!)),
      latestStartDate: fromDay(wt.dayAt(ls.get(id)!)),
      latestFinishDate: fromDay(wt.dayAt(lf.get(id)!)),
      floatDays: slack,
      critical: slack <= 0,
    };
  }

  const criticalPath = [...ids]
    .filter((id) => out[id].critical)
    .sort((a, b) => out[a].earliestStart - out[b].earliestStart || a.localeCompare(b));

  return {
    items: out,
    criticalPath,
    longestChain,
    longestChainDays,
    violations,
    projectStart: fromDay(wt.dayAt(projectStart)),
    projectEnd: fromDay(wt.dayAt(projectEnd)),
    unscheduled,
    summaries,
    cyclic: false,
    workingDays: wt.restricted,
  };
}

// ---------------------------------------------------------------------------
// Progress over time
// ---------------------------------------------------------------------------

export interface CurvePoint {
  day: string;
  /** Jobs finished by the end of this day. */
  done: number;
  /** As a percentage of the work in scope. */
  percent: number;
}

/**
 * Work actually completed over time, taken from the dates things closed.
 *
 * Derived from `closedAt` rather than from stored snapshots, which this app does
 * not keep. That is a real limitation and worth being plain about: the curve
 * reflects the plan *as it stands now*, so work added later appears to have been
 * in scope all along and the early part of the curve reads slightly pessimistic.
 * It is still the honest version — the alternative is an S-curve drawn from a
 * formula, which would look better and mean nothing.
 */
export function progressCurve(
  items: { closedAt: Date | string | null; isMilestone: boolean; parentId: string | null; id: string }[]
): CurvePoint[] {
  const parentIds = new Set(items.map((i) => i.parentId).filter((v): v is string => !!v));
  const leaves = items.filter((i) => !parentIds.has(i.id) && !i.isMilestone);
  if (!leaves.length) return [];

  const closed = leaves
    .map((i) => i.closedAt)
    .filter((v): v is Date | string => !!v)
    .map((v) => (v instanceof Date ? v : new Date(v)).toISOString().slice(0, 10))
    .sort();
  if (!closed.length) return [];

  const points: CurvePoint[] = [];
  let done = 0;
  for (const day of closed) {
    done += 1;
    const last = points[points.length - 1];
    // One point per day, carrying the running total — not one per job, or a day
    // on which three things finished would draw three points at the same x.
    if (last && last.day === day) {
      last.done = done;
      last.percent = Math.round((done / leaves.length) * 100);
    } else {
      points.push({ day, done, percent: Math.round((done / leaves.length) * 100) });
    }
  }
  return points;
}

// ---------------------------------------------------------------------------
// The tree: what a parent's dates and progress actually are
// ---------------------------------------------------------------------------

export interface TreeItem {
  id: string;
  parentId: string | null;
  start: string | null;
  end: string | null;
  isMilestone: boolean;
  status: string;
  percentComplete: number | null;
}

export interface TreeRollup {
  /** Earliest start across everything beneath, or its own if it is a leaf. */
  start: string | null;
  end: string | null;
  /** Duration-weighted progress across the leaves beneath. */
  percentComplete: number | null;
  /** True when this item has children. */
  isSummary: boolean;
  /** Leaves beneath it that are not yet closed — what stops it being finished. */
  openBeneath: number;
}

/**
 * What a parent's dates and progress are, as opposed to what somebody typed on it.
 *
 * On a tree, a phase does not have dates of its own: it starts when the first
 * thing in it starts and ends when the last thing ends. Typing them separately
 * is how a programme ends up with a phase running to March while everything
 * inside it finishes in January. So they are derived, bottom-up, and the typed
 * values on a parent are ignored rather than trusted.
 *
 * Progress is weighted by duration, not counted per task. Ten days of excavation
 * and one day of signage are not half the phase each, and a plain average of
 * percentages says they are. A leaf with no percentage reported falls back to its
 * status — closed counts as complete, anything else as nothing — because "nobody
 * has said" and "no progress" are different facts and only one of them is safe to
 * assume.
 */
export function rollUpTree(items: TreeItem[], isClosed: (status: string) => boolean): Record<string, TreeRollup> {
  const byParent = new Map<string | null, TreeItem[]>();
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const i of items) {
    const key = i.parentId && byId.has(i.parentId) ? i.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(i);
    byParent.set(key, list);
  }

  const out: Record<string, TreeRollup> = {};
  const dayOf = (iso: string | null) => (iso ? Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000) : null);

  /** Depth-first, so a parent of parents spans its grandchildren. */
  const visit = (item: TreeItem): { start: number | null; end: number | null; weight: number; earned: number; open: number } => {
    const kids = byParent.get(item.id) ?? [];

    if (!kids.length) {
      const s = dayOf(item.start);
      const e = dayOf(item.end) ?? s;
      // Milestones carry no duration, so they must not pull the weighted average
      // around — a delivery date is not effort.
      const weight = item.isMilestone ? 0 : Math.max(1, (e ?? 0) - (s ?? 0) + 1);
      const reported = item.percentComplete;
      const percent = reported !== null && reported !== undefined ? reported : isClosed(item.status) ? 100 : 0;
      const open = isClosed(item.status) ? 0 : 1;
      out[item.id] = {
        start: item.start,
        end: item.end ?? item.start,
        percentComplete: reported ?? (isClosed(item.status) ? 100 : null),
        isSummary: false,
        openBeneath: 0,
      };
      return { start: s, end: e, weight, earned: (weight * percent) / 100, open };
    }

    let start: number | null = null;
    let end: number | null = null;
    let weight = 0;
    let earned = 0;
    let open = 0;
    for (const kid of kids) {
      const r = visit(kid);
      if (r.start !== null && (start === null || r.start < start)) start = r.start;
      if (r.end !== null && (end === null || r.end > end)) end = r.end;
      weight += r.weight;
      earned += r.earned;
      open += r.open;
    }
    const iso = (d: number | null) => (d === null ? null : new Date(d * 86400000).toISOString().slice(0, 10));
    out[item.id] = {
      start: iso(start),
      end: iso(end),
      percentComplete: weight > 0 ? Math.round((earned / weight) * 100) : null,
      isSummary: true,
      openBeneath: open,
    };
    // A parent contributes its children's span and weight upward, never its own
    // typed dates, which is the whole point.
    return { start, end, weight, earned, open };
  };

  for (const root of byParent.get(null) ?? []) visit(root);
  return out;
}
