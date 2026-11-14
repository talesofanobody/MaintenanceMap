import { analyseSchedule, blockerSummary, progressCurve, type ScheduleItem, type ScheduleLink } from "../server/src/lib/planning";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "PASS" : "FAIL") + " — " + m); if (!c) fail++; };
const it = (id: string, start: string | null, end: string | null, isMilestone = false): ScheduleItem => ({ id, start, end, isMilestone });
const link = (fromId: string, toId: string, kind = "precedes", lagDays: number | null = null): ScheduleLink => ({ fromId, toId, kind, lagDays });

// ---- a simple chain -------------------------------------------------------
// a: 5 days, then b: 5 days. b cannot start before a finishes.
let r = analyseSchedule(
  [it("a", "2027-01-04", "2027-01-08"), it("b", "2027-01-11", "2027-01-15")],
  [link("a", "b")]
);
ok(r.projectStart === "2027-01-04", `the project starts when the first job does (${r.projectStart})`);
ok(r.projectEnd === "2027-01-15", `and ends when the last one does (${r.projectEnd})`);
// a finishes Friday and b is planned for Monday, so a can slip into the weekend.
// That is what float means against a plan with typed dates, and it is why the
// longest chain is reported separately.
ok(r.items.a.floatDays === 2, `a has the weekend as slack (${r.items.a.floatDays} days)`);
ok(r.items.b.floatDays === 0, "b has none, being last");
ok(r.criticalPath.join(",") === "b", `so only b is critical against the plan (${r.criticalPath.join(",")})`);
ok(r.longestChain.join(",") === "a,b", `but the chain the end date hangs on is both (${r.longestChain.join(",")})`);
ok(r.longestChainDays === 10, `ten days of dependent work (${r.longestChainDays})`);
ok(r.violations.length === 0, "and the plan does not contradict itself");

// ---- a parallel branch gets float ----------------------------------------
// a -> b -> d is the long way round; a -> c -> d is shorter, so c has slack.
r = analyseSchedule(
  [
    it("a", "2027-01-04", "2027-01-08"),
    it("b", "2027-01-11", "2027-01-22"),
    it("c", "2027-01-11", "2027-01-13"),
    it("d", "2027-01-25", "2027-01-29"),
  ],
  [link("a", "b"), link("a", "c"), link("b", "d"), link("c", "d")]
);
ok(r.items.c.floatDays > r.items.b.floatDays,
   `the short branch has more slack than the long one (${r.items.c.floatDays} vs ${r.items.b.floatDays})`);
ok(r.longestChain.join(",") === "a,b,d", `the longest chain goes the long way round (${r.longestChain.join(",")})`);
ok(!r.longestChain.includes("c"), "and leaves the short branch out");
ok(r.longestChainDays === 22, `five plus twelve plus five days of it (${r.longestChainDays})`);

// ---- lag pushes the successor --------------------------------------------
// Paint needs a day to dry whether or not anybody is working.
r = analyseSchedule(
  [it("fog", "2027-01-04", "2027-01-05"), it("paint", "2027-01-06", "2027-01-08")],
  [link("fog", "paint", "precedes", 1)]
);
ok(r.projectEnd === "2027-01-09", `a day of lag moves the end out by a day (${r.projectEnd})`);
ok(r.items.paint.earliestStart - r.items.fog.earliestFinish === 2, "leaving a clear day between them");
ok(r.longestChainDays === 6, `and the lag counts toward the chain (${r.longestChainDays} days for 2+1+3)`);

// ---- only `precedes` constrains ------------------------------------------
r = analyseSchedule(
  [it("x", "2027-02-01", "2027-02-05"), it("y", "2027-02-01", "2027-02-05")],
  [link("x", "y", "blocks"), link("x", "y", "relates")]
);
ok(r.items.y.earliestStart === r.items.x.earliestStart,
   "a blocks link carries no dates, so it does not push anything");
ok(r.projectEnd === "2027-02-05", `and the end is unchanged (${r.projectEnd})`);

// ---- a milestone occupies its day, not zero days -------------------------
r = analyseSchedule(
  [it("m", "2026-12-14", "2026-12-14", true), it("work", "2026-12-15", "2026-12-19")],
  [link("m", "work")]
);
ok(r.items.m.earliestFinish === r.items.m.earliestStart,
   "a milestone starts and finishes on the same day");
ok(r.items.work.earliestStart > r.items.m.earliestFinish, "and still gates what follows");

// ---- dates that disagree with the dependency ------------------------------
// Somebody typed b as starting before a finishes. CPM should push b, not lie.
r = analyseSchedule(
  [it("a", "2027-03-01", "2027-03-10"), it("b", "2027-03-02", "2027-03-06")],
  [link("a", "b")]
);
ok(r.items.b.earliestStart > r.items.a.earliestFinish,
   "an impossible start is pushed to when it could actually begin");
ok(r.projectEnd === "2027-03-15", `and the real end is later than the typed one (${r.projectEnd})`);
ok(r.violations.length === 1 && r.violations[0].id === "b", "the contradiction is reported");
ok(r.violations[0].tooEarlyByDays === 9,
   `by exactly how many days it is out (${r.violations[0].tooEarlyByDays})`);
ok(r.violations[0].plannedStart === "2027-03-02" && r.violations[0].earliestStart === "2027-03-11",
   `naming both dates (planned ${r.violations[0].plannedStart}, possible ${r.violations[0].earliestStart})`);

// ---- a summary row is an envelope, not work -------------------------------
// The parent spans two months; the chain of dependent work inside it is shorter.
// Letting the parent compete is how a phase wins "longest chain" over its own
// children, which is the opposite of useful.
r = analyseSchedule(
  [
    { id: "phase", start: "2027-01-04", end: "2027-02-05", isMilestone: false, isSummary: true },
    it("fog", "2027-01-04", "2027-01-08"),
    it("paint", "2027-01-11", "2027-01-22"),
  ],
  [link("fog", "paint", "precedes", 1)]
);
ok(r.summaries.join(",") === "phase", `the parent is named as a summary (${r.summaries.join(",")})`);
ok(!r.items.phase, "and takes no part in the analysis");
ok(r.longestChain.join(",") === "fog,paint", `so the chain is the real work (${r.longestChain.join(",")})`);
ok(r.longestChainDays === 18, `eighteen days, not the parent's thirty-three (${r.longestChainDays})`);
ok(!r.unscheduled.includes("phase"), "a summary is excluded deliberately, not for want of dates");

// ---- items without dates are reported, never dropped silently ------------
r = analyseSchedule(
  [it("a", "2027-01-04", "2027-01-08"), it("nodate", null, null), it("halfdate", "2027-01-04", null)],
  []
);
ok(r.unscheduled.length === 2, `two items cannot be scheduled (${r.unscheduled.length})`);
ok(r.unscheduled.includes("nodate") && r.unscheduled.includes("halfdate"), "and both are named");
ok(!!r.items.a, "the one with dates is still analysed");

// ---- nothing to schedule at all ------------------------------------------
r = analyseSchedule([it("x", null, null)], []);
ok(r.projectStart === null && r.criticalPath.length === 0 && r.longestChain.length === 0, "no dates means no schedule, not a crash");

// ---- a loop in the data must not hang ------------------------------------
r = analyseSchedule(
  [it("a", "2027-01-04", "2027-01-08"), it("b", "2027-01-11", "2027-01-15")],
  [link("a", "b"), link("b", "a")]
);
ok(r.cyclic === true, "a loop is reported");
ok(r.criticalPath.length === 0 && r.longestChain.length === 0 && r.projectEnd === null, "and nothing is invented from it");

// ---- links pointing outside the set are ignored ---------------------------
r = analyseSchedule([it("a", "2027-01-04", "2027-01-08")], [link("a", "elsewhere")]);
ok(r.items.a.critical && !r.cyclic, "a link to something not in scope is skipped");

// ---- blockers: age is the number that matters ----------------------------
const now = new Date("2026-11-14T12:00:00Z");
let b = blockerSummary([
  { raisedAt: "2026-11-14T08:00:00Z", clearedAt: null },
  { raisedAt: "2026-10-15T08:00:00Z", clearedAt: null },
  { raisedAt: "2026-11-01T08:00:00Z", clearedAt: "2026-11-05T08:00:00Z" },
], now);
ok(b.open === 2 && b.cleared === 1, `two open, one cleared (${b.open}/${b.cleared})`);
ok(b.oldestOpenDays === 30, `the oldest has been there a month (${b.oldestOpenDays} days)`);
ok(b.meanDaysToClear === 4, `and cleared ones took four days on average (${b.meanDaysToClear})`);
b = blockerSummary([], now);
ok(b.oldestOpenDays === null && b.meanDaysToClear === null, "nothing blocked means no figures, not zeroes");

// ---- progress curve from real close dates --------------------------------
let curve = progressCurve([
  { id: "p", parentId: null, isMilestone: false, closedAt: null },
  { id: "a", parentId: "p", isMilestone: false, closedAt: "2027-01-05T10:00:00Z" },
  { id: "b", parentId: "p", isMilestone: false, closedAt: "2027-01-05T16:00:00Z" },
  { id: "c", parentId: "p", isMilestone: false, closedAt: "2027-01-09T09:00:00Z" },
  { id: "d", parentId: "p", isMilestone: false, closedAt: null },
  { id: "m", parentId: "p", isMilestone: true, closedAt: "2027-01-06T09:00:00Z" },
]);
ok(curve.length === 2, `one point per day, not per job (${curve.length} points)`);
ok(curve[0].day === "2027-01-05" && curve[0].done === 2, `two finished on the first day (${curve[0].done})`);
ok(curve[1].done === 3, `three by the second (${curve[1].done})`);
ok(curve[1].percent === 75, `which is 75 per cent of the four jobs (${curve[1].percent})`);
ok(!curve.some((p) => p.day === "2027-01-06"), "a milestone is not counted as work done");
ok(progressCurve([]).length === 0, "no work means no curve");

console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
