import { rollUp, budgetView, quoteState, slippageDays, wouldCycleInHierarchy, wouldCycleInLinks } from "../server/src/lib/planning";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "PASS" : "FAIL") + " — " + m); if (!c) fail++; };
const isClosed = (s: string) => s === "completed" || s === "cancelled";
const iss = (o: Partial<any>): any => ({ id: "x", parentId: null, status: "pending", isMilestone: false, estimatedHours: null, actualHours: null, costs: [], ...o });

// ---- rollup: progress is over leaves only ---------------------------------
const tree = [
  iss({ id: "phase", status: "in_progress" }),
  iss({ id: "a", parentId: "phase", status: "completed" }),
  iss({ id: "b", parentId: "phase", status: "pending" }),
];
let r = rollUp(tree, isClosed);
ok(r.total === 3, `three items in total (${r.total})`);
ok(r.leaves === 2, `but only two are leaves (${r.leaves})`);
ok(r.progress === 50, `so progress is 50, not 33 (${r.progress})`);

// A deeper plan with the same real work must not read as further along.
const deep = [
  iss({ id: "p1", status: "in_progress" }),
  iss({ id: "p2", parentId: "p1", status: "in_progress" }),
  iss({ id: "a", parentId: "p2", status: "completed" }),
  iss({ id: "b", parentId: "p2", status: "pending" }),
];
ok(rollUp(deep, isClosed).progress === 50, `nesting does not inflate progress (${rollUp(deep, isClosed).progress})`);

// ---- milestones are counted apart from work -------------------------------
const withMs = [
  iss({ id: "a", status: "completed" }),
  iss({ id: "m1", isMilestone: true, status: "completed" }),
  iss({ id: "m2", isMilestone: true, status: "pending" }),
];
r = rollUp(withMs, isClosed);
ok(r.leaves === 1, `a milestone is not work (${r.leaves} leaf)`);
ok(r.progress === 100, `so one done job reads as 100 (${r.progress})`);
ok(r.milestones === 2 && r.milestonesHit === 1, `and milestones report separately (${r.milestonesHit}/${r.milestones})`);

// ---- cost rolls up from every level, not only leaves ----------------------
r = rollUp([
  iss({ id: "phase", costs: [{ amount: 500, quantity: 1 }] }),
  iss({ id: "a", parentId: "phase", costs: [{ amount: 100, quantity: 3 }] }),
], isClosed);
ok(r.actualCost === 800, `cost booked on a parent still counts (${r.actualCost})`);

// ---- budget: committed and actual are not added together -----------------
let b = budgetView(10000, [4000], 3800);
ok(b.committed === 4000 && b.actual === 3800, "both are reported");
ok(b.remaining === 6000, `remaining takes the larger, not the sum (${b.remaining})`);
ok(!b.overBudget, "and is not over budget");
b = budgetView(5000, [6000], 0);
ok(b.overBudget && b.remaining === -1000, `an award beyond the budget shows over (${b.remaining})`);
ok(budgetView(null, [100], 50).remaining === null, "no approved figure means no remaining figure");

// ---- the three-quote rule counts answers, not emails ---------------------
let q = quoteState([{ status: "requested" }, { status: "requested" }, { status: "requested" }]);
ok(!q.satisfied && q.outstanding === 3, `three requests and no answers is not satisfied (${q.outstanding} outstanding)`);
q = quoteState([{ status: "received" }, { status: "received" }, { status: "awarded" }]);
ok(q.satisfied && q.received === 3, "three answers is");
ok(quoteState([{ status: "received" }, { status: "declined" }]).outstanding === 2, "a declined quote is not an answer");

// ---- slippage ------------------------------------------------------------
ok(slippageDays("2026-12-14", "2026-12-21") === 7, "seven days late");
ok(slippageDays("2026-12-14", "2026-12-07") === -7, "or seven days early");
ok(slippageDays(null, "2026-12-07") === null, "and unknown without a baseline");

(async () => {
  // ---- hierarchy cycles ----------------------------------------------------
  const parents: Record<string, string | null> = { a: null, b: "a", c: "b" };
  const getParent = async (id: string) => parents[id] ?? null;
  ok(await wouldCycleInHierarchy("a", "a", getParent), "an issue cannot be its own parent");
  ok(await wouldCycleInHierarchy("a", "c", getParent), "nor a descendant's child (a under c)");
  ok(!(await wouldCycleInHierarchy("c", "a", getParent)), "but moving deeper under an ancestor is fine");

  // A database that already holds a loop must not hang the check.
  const looped: Record<string, string | null> = { x: "y", y: "x" };
  ok(await wouldCycleInHierarchy("z", "x", async (id) => looped[id] ?? null),
     "an existing loop is detected rather than walked for ever");

  // ---- dependency cycles ---------------------------------------------------
  const succ: Record<string, string[]> = { a: ["b"], b: ["c"], c: [] };
  const getSucc = async (id: string) => succ[id] ?? [];
  ok(await wouldCycleInLinks("a", "a", getSucc), "a job cannot precede itself");
  ok(await wouldCycleInLinks("c", "a", getSucc), "c before a closes the a-b-c loop");
  ok(!(await wouldCycleInLinks("a", "c", getSucc)), "a before c is a shortcut, not a loop");

  console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})();
