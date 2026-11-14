import { analyseSchedule, EVERY_DAY, makeWorkingTime, type CalendarSpec, type ScheduleItem, type ScheduleLink } from "../server/src/lib/planning";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "PASS" : "FAIL") + " — " + m); if (!c) fail++; };
const it = (id: string, start: string, end: string, isMilestone = false): ScheduleItem => ({ id, start, end, isMilestone });
const link = (fromId: string, toId: string, kind = "precedes", lagDays: number | null = null): ScheduleLink => ({ fromId, toId, kind, lagDays });
const day = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);

// Mon–Sat worked, Sunday not: the rhythm this department actually runs.
const MON_SAT: CalendarSpec = {
  workingWeekdays: [true, true, true, true, true, true, false],
  exceptions: {},
};
// A five-day week, for comparison.
const MON_FRI: CalendarSpec = {
  workingWeekdays: [true, true, true, true, true, false, false],
  exceptions: {},
};

// ---- the weekday arithmetic is right at all ------------------------------
// 2027-01-04 is a Monday; 2027-01-09 a Saturday; 2027-01-10 a Sunday.
let wt = makeWorkingTime(MON_SAT, day("2026-12-01"), day("2027-03-01"));
ok(wt.isWorking(day("2027-01-04")), "Monday is worked");
ok(wt.isWorking(day("2027-01-09")), "Saturday is worked on a six-day week");
ok(!wt.isWorking(day("2027-01-10")), "Sunday is not");
ok(wt.count(day("2027-01-04"), day("2027-01-10")) === 6, `six working days in that week (${wt.count(day("2027-01-04"), day("2027-01-10"))})`);
wt = makeWorkingTime(MON_FRI, day("2026-12-01"), day("2027-03-01"));
ok(wt.count(day("2027-01-04"), day("2027-01-10")) === 5, "five on a five-day week");
ok(!wt.isWorking(day("2027-01-09")), "where Saturday is not worked");

// A non-working day snaps forward to the next worked one.
wt = makeWorkingTime(MON_SAT, day("2026-12-01"), day("2027-03-01"));
ok(wt.dayAt(wt.indexOf(day("2027-01-10"))) === day("2027-01-11"),
   "a Sunday snaps forward to the Monday");
ok(wt.indexOf(day("2027-01-11")) - wt.indexOf(day("2027-01-09")) === 1,
   "and Saturday to Monday is one working day apart, not two");

// ---- exceptions, in both directions --------------------------------------
const withHoliday: CalendarSpec = {
  workingWeekdays: MON_SAT.workingWeekdays,
  exceptions: { "2027-01-06": false, "2027-01-10": true },
};
wt = makeWorkingTime(withHoliday, day("2026-12-01"), day("2027-03-01"));
ok(!wt.isWorking(day("2027-01-06")), "a holiday stops a normal working day");
ok(wt.isWorking(day("2027-01-10")), "and a worked Sunday is worked");
ok(wt.count(day("2027-01-04"), day("2027-01-10")) === 6,
   `one lost and one gained leaves the week the same (${wt.count(day("2027-01-04"), day("2027-01-10"))})`);

const noCal = makeWorkingTime(EVERY_DAY, day("2027-01-01"), day("2027-02-01"));
ok(!noCal.restricted, "with no calendar nothing is excluded");
ok(noCal.count(day("2027-01-04"), day("2027-01-10")) === 7, "and every day counts");

// ---- the headline: float was generous, and now is not --------------------
// a finishes Friday 8 Jan, b is planned for Monday 11 Jan.
const chain: [ScheduleItem[], ScheduleLink[]] = [
  [it("a", "2027-01-04", "2027-01-08"), it("b", "2027-01-11", "2027-01-15")],
  [link("a", "b")],
];
let plain = analyseSchedule(chain[0], chain[1]);
ok(plain.items.a.floatDays === 2, `counting every day, a has two days of float (${plain.items.a.floatDays})`);
ok(plain.workingDays === false, "and the analysis says no calendar was used");

let sixDay = analyseSchedule(chain[0], chain[1], MON_SAT);
ok(sixDay.workingDays === true, "with a calendar it says so");
ok(sixDay.items.a.floatDays === 1,
   `and the same gap is one working day, because Sunday is not one (${sixDay.items.a.floatDays})`);

let fiveDay = analyseSchedule(chain[0], chain[1], MON_FRI);
ok(fiveDay.items.a.floatDays === 0,
   `on a five-day week there is no slack at all — the weekend was never float (${fiveDay.items.a.floatDays})`);
ok(fiveDay.criticalPath.includes("a") && fiveDay.criticalPath.includes("b"),
   "so the whole chain is critical, which counting calendar days hid");

// ---- a duration is working days, so the end moves out -------------------
// Ten working days from Monday 4 January, on a five-day week, ends Friday 15th.
let r = analyseSchedule([it("x", "2027-01-04", "2027-01-15")], [], MON_FRI);
ok(r.items.x.earliestFinish - r.items.x.earliestStart === 9,
   `a fortnight of weekdays is ten working days (${r.items.x.earliestFinish - r.items.x.earliestStart + 1})`);
ok(r.projectEnd === "2027-01-15", `ending on the Friday (${r.projectEnd})`);
ok(r.items.x.earliestFinishDate === "2027-01-15", "and reported as a date, not an ordinal");

// A job nominally starting on a Sunday starts on the Monday instead.
r = analyseSchedule([it("y", "2027-01-10", "2027-01-15")], [], MON_SAT);
ok(r.items.y.earliestStartDate === "2027-01-11",
   `a start on a Sunday moves to the Monday (${r.items.y.earliestStartDate})`);
ok(r.projectStart === "2027-01-11", "and the project starts there too");

// ---- lag is in working days too -----------------------------------------
// Paint needs a day to dry. Over a Sunday that is still one working day of lag.
// Fogging finishes Friday. One working day of drying is the Saturday, so the
// earliest the painters can start is the Monday — not the Sunday, which is not a
// day, and not the Tuesday, which would be a day of slack.
r = analyseSchedule(
  [it("fog", "2027-01-08", "2027-01-08"), it("paint", "2027-01-11", "2027-01-12")],
  [link("fog", "paint", "precedes", 1)],
  MON_SAT
);
ok(r.violations.length === 0, "a day of drying over a weekend is satisfied by the Monday");
ok(r.items.paint.earliestStart - r.items.fog.earliestFinish === 2,
   `leaving exactly one clear working day between them (${r.items.paint.earliestStart - r.items.fog.earliestFinish})`);
ok(r.items.paint.floatDays === 0, "with no slack, since the Monday is the earliest it could be");
// Pulled to the Saturday it would be a day early, the drying time being unmet.
let tooSoon = analyseSchedule(
  [it("fog", "2027-01-08", "2027-01-08"), it("paint", "2027-01-09", "2027-01-11")],
  [link("fog", "paint", "precedes", 1)],
  MON_SAT
);
ok(tooSoon.violations.length === 1 && tooSoon.violations[0].tooEarlyByDays === 1,
   `starting it the next day skips the drying (${tooSoon.violations[0]?.tooEarlyByDays} day early)`);

// ---- a shutdown inside a task's dates: what it does, and what it does not --
//
// This is the one place the model shows through. A task has no duration field —
// only typed dates — so its duration is derived as the working days *inside* that
// range. A shutdown therefore reduces how much work the range contains rather
// than pushing the end date out. Which is defensible: somebody typed that end
// date, and the app should not quietly move it.
//
// The push-out behaviour everybody expects needs a real duration field ("this
// takes five working days"), with dates derived from it. That is a bigger change
// and is recorded as a gap rather than faked here.
const shutdown: CalendarSpec = {
  workingWeekdays: MON_SAT.workingWeekdays,
  exceptions: { "2027-01-05": false, "2027-01-06": false, "2027-01-07": false },
};
r = analyseSchedule([it("z", "2027-01-04", "2027-01-08")], [], shutdown);
ok(r.items.z.earliestFinishDate === "2027-01-08",
   `the typed end date is respected rather than moved (${r.items.z.earliestFinishDate})`);
ok(r.items.z.earliestFinish - r.items.z.earliestStart === 1,
   `but the range now holds two working days, not five (${r.items.z.earliestFinish - r.items.z.earliestStart + 1})`);
// And a shutdown between two linked tasks DOES push the successor, because that
// is a gap rather than a range.
r = analyseSchedule(
  [it("before", "2027-01-04", "2027-01-04"), it("after", "2027-01-05", "2027-01-05")],
  [link("before", "after")],
  shutdown
);
ok(r.items.after.earliestStartDate === "2027-01-08",
   `a successor is pushed past the shutdown to the 8th (${r.items.after.earliestStartDate})`);
// Not a dependency violation: the typed start of the 5th is simply not a day, so
// the calendar resolves it forward to the 8th, which then satisfies the link.
// A start typed on a day nobody works is worth saying out loud, but it is a
// different complaint from "this contradicts its own dependencies" and is not
// reported as one.
ok(r.violations.length === 0, "and that resolution is not itself a contradiction");

// ---- a milestone still occupies one working day -------------------------
r = analyseSchedule([it("m", "2027-01-11", "2027-01-11", true)], [], MON_SAT);
ok(r.items.m.earliestFinish === r.items.m.earliestStart, "a milestone is one working day");
ok(r.items.m.earliestStartDate === "2027-01-11", "on the day it falls");

// ---- the longest chain is in working days -------------------------------
r = analyseSchedule(
  [it("p", "2027-01-04", "2027-01-08"), it("q", "2027-01-11", "2027-01-15")],
  [link("p", "q")],
  MON_FRI
);
ok(r.longestChainDays === 10, `ten working days end to end, not twelve calendar (${r.longestChainDays})`);

console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
