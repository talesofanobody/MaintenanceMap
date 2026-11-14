import { analyseSchedule, rollUpTree, type ScheduleLink, type TreeItem } from "../server/src/lib/planning";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "PASS" : "FAIL") + " — " + m); if (!c) fail++; };
const isClosed = (s: string) => s === "completed" || s === "cancelled";
const t = (o: Partial<TreeItem> & { id: string }): TreeItem =>
  ({ parentId: null, start: null, end: null, isMilestone: false, status: "pending", percentComplete: null, ...o });
const link = (fromId: string, toId: string, kind = "precedes", lagDays: number | null = null): ScheduleLink =>
  ({ fromId, toId, kind, lagDays });

// ---- a parent's dates come from its children -----------------------------
let r = rollUpTree([
  // The typed dates on the parent are deliberately wrong, to prove they are ignored.
  t({ id: "phase", start: "2027-09-01", end: "2027-09-02" }),
  t({ id: "excavate", parentId: "phase", start: "2027-05-03", end: "2027-05-14" }),
  t({ id: "pour", parentId: "phase", start: "2027-05-17", end: "2027-05-28" }),
], isClosed);
ok(r.phase.isSummary, "a parent is a summary");
ok(r.phase.start === "2027-05-03", `starting when the first child starts (${r.phase.start})`);
ok(r.phase.end === "2027-05-28", `and ending when the last one ends (${r.phase.end})`);
ok(r.excavate.isSummary === false, "a leaf is not a summary");

// ---- and a grandparent spans the grandchildren ---------------------------
r = rollUpTree([
  t({ id: "programme" }),
  t({ id: "substructure", parentId: "programme" }),
  t({ id: "piling", parentId: "substructure", start: "2027-03-01", end: "2027-03-26" }),
  t({ id: "caps", parentId: "substructure", start: "2027-04-05", end: "2027-04-16" }),
  t({ id: "frame", parentId: "programme", start: "2027-05-03", end: "2027-08-27" }),
], isClosed);
ok(r.substructure.start === "2027-03-01" && r.substructure.end === "2027-04-16",
   `the middle level spans its own children (${r.substructure.start} to ${r.substructure.end})`);
ok(r.programme.start === "2027-03-01" && r.programme.end === "2027-08-27",
   `and the top spans everything beneath (${r.programme.start} to ${r.programme.end})`);

// ---- progress is weighted by duration, not counted per task --------------
// Ten days of excavation done, one day of signage not. Counting tasks says 50%.
r = rollUpTree([
  t({ id: "p" }),
  t({ id: "dig", parentId: "p", start: "2027-05-03", end: "2027-05-14", status: "completed" }),
  t({ id: "sign", parentId: "p", start: "2027-05-17", end: "2027-05-17", status: "pending" }),
], isClosed);
ok(r.p.percentComplete === 92, `twelve days of thirteen done reads as 92, not 50 (${r.p.percentComplete})`);

// A reported percentage is used where it exists.
r = rollUpTree([
  t({ id: "p" }),
  t({ id: "a", parentId: "p", start: "2027-05-03", end: "2027-05-12", percentComplete: 60 }),
  t({ id: "b", parentId: "p", start: "2027-05-13", end: "2027-05-22", percentComplete: 0 }),
], isClosed);
ok(r.p.percentComplete === 30, `60 per cent of half the work is 30 (${r.p.percentComplete})`);

// ---- nobody having said is not the same as zero --------------------------
r = rollUpTree([t({ id: "lone", start: "2027-05-03", end: "2027-05-05" })], isClosed);
ok(r.lone.percentComplete === null, "an unreported leaf has no percentage, rather than zero");
r = rollUpTree([t({ id: "done", start: "2027-05-03", end: "2027-05-05", status: "completed" })], isClosed);
ok(r.done.percentComplete === 100, "a closed one is complete without anybody typing it");

// ---- a milestone carries no weight ---------------------------------------
r = rollUpTree([
  t({ id: "p" }),
  t({ id: "work", parentId: "p", start: "2027-05-03", end: "2027-05-12", status: "completed" }),
  t({ id: "ms", parentId: "p", start: "2027-06-01", end: "2027-06-01", isMilestone: true, status: "pending" }),
], isClosed);
ok(r.p.percentComplete === 100, `an outstanding milestone does not drag progress down (${r.p.percentComplete})`);
ok(r.p.end === "2027-06-01", "but it does extend the span");

// ---- what stops a parent being finished ----------------------------------
r = rollUpTree([
  t({ id: "p" }),
  t({ id: "a", parentId: "p", status: "completed" }),
  t({ id: "b", parentId: "p", status: "in_progress" }),
  t({ id: "c", parentId: "p", status: "cancelled" }),
], isClosed);
ok(r.p.openBeneath === 1, `one thing beneath is still open (${r.p.openBeneath})`);
ok(r.a.openBeneath === 0, "a leaf has nothing beneath it");

// ---- start-to-start: things that run alongside ---------------------------
// Shoring starts two days after excavation starts, not after it finishes.
let a = analyseSchedule(
  [
    { id: "excavate", start: "2027-05-03", end: "2027-05-14", isMilestone: false },
    { id: "shore", start: "2027-05-05", end: "2027-05-18", isMilestone: false },
  ],
  [link("excavate", "shore", "starts_after_start", 2)]
);
ok(a.violations.length === 0, "a start-to-start plan with the right offset is consistent");
ok(a.items.shore.earliestStart - a.items.excavate.earliestStart === 2,
   "and the two run together, offset by the lag");

// Pull it too early and it is caught.
a = analyseSchedule(
  [
    { id: "excavate", start: "2027-05-03", end: "2027-05-14", isMilestone: false },
    { id: "shore", start: "2027-05-03", end: "2027-05-18", isMilestone: false },
  ],
  [link("excavate", "shore", "starts_after_start", 2)]
);
ok(a.violations.length === 1 && a.violations[0].tooEarlyByDays === 2,
   `starting it with no offset is two days too early (${a.violations[0]?.tooEarlyByDays})`);

// ---- finish-to-finish: things that must end together ---------------------
// Curing finishes when the pour finishes. It may well start earlier.
a = analyseSchedule(
  [
    { id: "pour", start: "2027-06-01", end: "2027-06-10", isMilestone: false },
    { id: "cure", start: "2027-06-08", end: "2027-06-17", isMilestone: false },
  ],
  [link("pour", "cure", "finishes_after_finish", 7)]
);
ok(a.violations.length === 0, "a finish-to-finish plan with the right offset is consistent");
ok(a.items.cure.earliestFinish - a.items.pour.earliestFinish === 7,
   `the finishes are held apart by the lag (${a.items.cure.earliestFinish - a.items.pour.earliestFinish})`);

// ---- finish-to-start is unchanged by any of this -------------------------
a = analyseSchedule(
  [
    { id: "x", start: "2027-05-03", end: "2027-05-07", isMilestone: false },
    { id: "y", start: "2027-05-10", end: "2027-05-14", isMilestone: false },
  ],
  [link("x", "y")]
);
ok(a.violations.length === 0 && a.longestChain.join(",") === "x,y",
   `plain finish-to-start still chains (${a.longestChain.join(",")})`);
ok(a.longestChainDays === 10, `ten days end to end (${a.longestChainDays})`);

// ---- a mixed chain, as a real programme would have it --------------------
a = analyseSchedule(
  [
    { id: "dig", start: "2027-05-03", end: "2027-05-14", isMilestone: false },
    { id: "shore", start: "2027-05-05", end: "2027-05-18", isMilestone: false },
    { id: "pour", start: "2027-05-19", end: "2027-05-28", isMilestone: false },
  ],
  [link("dig", "shore", "starts_after_start", 2), link("shore", "pour")]
);
ok(a.violations.length === 0, "a mixed start-to-start and finish-to-start plan holds");
ok(a.longestChain.length === 3, `and the chain runs through all three (${a.longestChain.join(",")})`);

console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
