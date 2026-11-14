import {
  convertReading, dailyConsumption, financialYearStart, missingRounds, periodTotals,
  readingDayFor, toLitres, unitCosts, weekStart, type ReadingRow,
} from "../server/src/lib/utilities";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "PASS" : "FAIL") + " — " + m); if (!c) fail++; };
const at = (iso: string) => new Date(iso);

// ---- the 05:00-to-05:00 day ----------------------------------------------
// 05:00 opens a day; 02:00 is near the end of the day before.
ok(readingDayFor(at("2026-11-16T05:00:00Z")) === "2026-11-16", "a 05:00 round opens its own day");
ok(readingDayFor(at("2026-11-16T05:30:00Z")) === "2026-11-16", "and a late 05:00 round still does");
ok(readingDayFor(at("2026-11-17T02:00:00Z")) === "2026-11-16",
   `a 02:00 round belongs to the day before (${readingDayFor(at("2026-11-17T02:00:00Z"))})`);
ok(readingDayFor(at("2026-11-17T04:59:00Z")) === "2026-11-16", "and so does anything before five");
ok(readingDayFor(at("2026-11-17T23:00:00Z")) === "2026-11-17", "an evening reading is that day's");
// The day boundary must not move with the server's timezone.
ok(readingDayFor(at("2026-11-17T08:00:00Z"), -4 * 60) === "2026-11-16",
   "four hours behind UTC, 08:00Z is 04:00 local and still yesterday");

// ---- conversions ---------------------------------------------------------
ok(convertReading(918273, { entryMode: "direct", unit: "kWh", capacityLitres: null, tankMaxHeightMm: null }) === 918273,
   "a direct reading is itself");
const propane = { entryMode: "percentage", unit: "litre", capacityLitres: 4000, tankMaxHeightMm: null };
ok(convertReading(47, propane) === 1880, `47 per cent of a 4000 litre tank is 1880 (${convertReading(47, propane)})`);
ok(convertReading(0.47, propane) === 1880, "written as a fraction it means the same");
ok(convertReading(100, propane) === 4000, "and full is full");
let threw = false;
try { convertReading(140, propane); } catch { threw = true; }
ok(threw, "a percentage over a hundred is refused");
threw = false;
try { convertReading(50, { ...propane, capacityLitres: null }); } catch { threw = true; }
ok(threw, "and a percentage with no capacity to apply it to is refused");

const water = { entryMode: "tank_height", unit: "litre", capacityLitres: 50000, tankMaxHeightMm: 2500 };
ok(convertReading(1250, water) === 25000, `half the height of a 50,000 litre tank is 25,000 (${convertReading(1250, water)})`);
ok(convertReading(2500, water) === 50000, "full height is full capacity");
threw = false;
try { convertReading(2600, water); } catch { threw = true; }
ok(threw, "a height above the tank is refused rather than extrapolated");

// Units: the gallons question is answered per meter, not globally.
ok(toLitres(100, "litre") === 100, "litres are litres");
ok(Math.round(toLitres(100, "gal")) === 379, `100 US gallons is 379 litres (${Math.round(toLitres(100, "gal"))})`);
ok(toLitres(2, "m3") === 2000, "and two cubic metres is 2000");

// ---- consumption, which is where the day boundary bites -----------------
// A meter climbing 100 a day, read at both rounds. Day D opens at 05:00 on D.
const meter: ReadingRow[] = [
  { meterPointId: "m", readingDay: "2026-11-16", slot: "0500", value: 1000 }, // opens day 16
  { meterPointId: "m", readingDay: "2026-11-16", slot: "0200", value: 1090 }, // late in day 16
  { meterPointId: "m", readingDay: "2026-11-17", slot: "0500", value: 1100 }, // closes 16, opens 17
  { meterPointId: "m", readingDay: "2026-11-17", slot: "0200", value: 1185 },
  { meterPointId: "m", readingDay: "2026-11-18", slot: "0500", value: 1200 },
];
let days = dailyConsumption(meter, true);
ok(days.length === 3, `three days are described (${days.length})`);
const d16 = days.find((d) => d.day === "2026-11-16")!;
ok(d16.opening === 1000 && d16.closing === 1100, `day 16 runs 1000 to 1100 (${d16.opening}–${d16.closing})`);
ok(d16.used === 100, `so it used 100 (${d16.used})`);
ok(d16.usedTrading === 90, `90 of it while open (${d16.usedTrading})`);
ok(d16.usedOvernight === 10, `and 10 overnight (${d16.usedOvernight})`);
ok(d16.usedTrading! + d16.usedOvernight! === d16.used, "the two parts add up to the day");
const last = days.find((d) => d.day === "2026-11-18")!;
ok(last.used === null, "the last day has no close yet, so its usage is unknown rather than zero");

// A gap in the log must not be summed as one long day.
const gapped: ReadingRow[] = [
  { meterPointId: "m", readingDay: "2026-11-16", slot: "0500", value: 1000 },
  { meterPointId: "m", readingDay: "2026-11-20", slot: "0500", value: 1400 },
];
days = dailyConsumption(gapped, true);
ok(days[0].used === null, "a four-day gap is not reported as one day using 400");
ok(days[0].closing === null, "because the next reading is not the next day");

// ---- a tank falls, and a refill is not negative consumption -------------
const tank: ReadingRow[] = [
  { meterPointId: "t", readingDay: "2026-11-16", slot: "0500", value: 3000 },
  { meterPointId: "t", readingDay: "2026-11-16", slot: "0200", value: 2700 },
  { meterPointId: "t", readingDay: "2026-11-17", slot: "0500", value: 2600 },
  { meterPointId: "t", readingDay: "2026-11-17", slot: "0200", value: 2500 },
  // Filled overnight: the level jumps.
  { meterPointId: "t", readingDay: "2026-11-18", slot: "0500", value: 3900 },
];
days = dailyConsumption(tank, false);
const t16 = days.find((d) => d.day === "2026-11-16")!;
ok(t16.used === 400, `a tank dropping 3000 to 2600 used 400 (${t16.used})`);
ok(t16.usedTrading === 300 && t16.usedOvernight === 100, "split across the two parts of the day");
const t17 = days.find((d) => d.day === "2026-11-17")!;
ok(t17.used === null, "a refill day's usage is unknown, not negative");
ok(t17.usedOvernight === null, "and so is its overnight figure");

// A replaced meter reads lower, which is the same situation.
days = dailyConsumption([
  { meterPointId: "m", readingDay: "2026-11-16", slot: "0500", value: 99000 },
  { meterPointId: "m", readingDay: "2026-11-17", slot: "0500", value: 12 },
], true);
ok(days[0].used === null, "a meter that was replaced does not report negative use");

// ---- running totals ------------------------------------------------------
const run: ReadingRow[] = [];
let value = 0;
for (let d = 1; d <= 20; d++) {
  const day = `2026-11-${String(d).padStart(2, "0")}`;
  run.push({ meterPointId: "m", readingDay: day, slot: "0500", value });
  value += 100;
}
// Readings run to the 20th, so days 1 to 19 have all closed: day 19 closes at
// 05:00 on the 20th, and that reading exists. Nineteen closed days at 100.
const totals = periodTotals(dailyConsumption(run, true), "2026-11-19");
ok(totals.mtd === 1900, `nineteen closed days at 100 is 1900 month to date (${totals.mtd})`);
ok(totals.days.mtd === 19, `over nineteen counted days (${totals.days.mtd})`);
// 2026-11-19 is a Thursday, so the week began Monday the 16th.
ok(weekStart("2026-11-19") === "2026-11-16", `the week starts Monday (${weekStart("2026-11-19")})`);
ok(totals.wtd === 400, `the 16th to the 19th is 400 week to date (${totals.wtd})`);
ok(totals.ytd === 1900, "and the financial year to date covers it all");

// A day that has not closed yet contributes nothing, which is the case that
// matters: on the 20th, with no reading on the 21st, the 20th is still running.
const partway = periodTotals(dailyConsumption(run, true), "2026-11-20");
ok(partway.mtd === 1900, `the open day adds nothing until it closes (${partway.mtd})`);
ok(partway.days.mtd === 19, "and is not counted as a day");

// The financial year runs July to June.
ok(financialYearStart("2026-11-16") === "2026-07-01", "November falls in the year that began in July");
ok(financialYearStart("2026-03-16") === "2025-07-01", "and March in the one before");

// A gap is skipped rather than counted as zero, and the day count shows it.
const sparse = dailyConsumption([
  { meterPointId: "m", readingDay: "2026-11-01", slot: "0500", value: 0 },
  { meterPointId: "m", readingDay: "2026-11-02", slot: "0500", value: 100 },
  { meterPointId: "m", readingDay: "2026-11-09", slot: "0500", value: 900 },
  { meterPointId: "m", readingDay: "2026-11-10", slot: "0500", value: 1000 },
], true);
const sparseTotals = periodTotals(sparse, "2026-11-10");
ok(sparseTotals.mtd === 200, `two usable days give 200, not the 1000 the meter moved (${sparseTotals.mtd})`);
ok(sparseTotals.days.mtd === 2, `and the day count says only two counted (${sparseTotals.days.mtd})`);

// ---- missing rounds are named -------------------------------------------
const gaps = missingRounds(dailyConsumption([
  { meterPointId: "m", readingDay: "2026-11-16", slot: "0500", value: 1 },
  { meterPointId: "m", readingDay: "2026-11-16", slot: "0200", value: 2 },
  { meterPointId: "m", readingDay: "2026-11-17", slot: "0500", value: 3 },
], true), "2026-11-16", "2026-11-18");
ok(gaps.length === 2, `two days have a round missing (${gaps.length})`);
ok(gaps[0].day === "2026-11-17" && gaps[0].missing.join(",") === "0200",
   `the 17th is missing its 02:00 (${gaps[0]?.missing.join(",")})`);
ok(gaps[1].missing.length === 2, "and the 18th is missing both");

// ---- cost per unit comes from the invoice -------------------------------
const costs = unitCosts([
  { kind: "electricity", periodStart: "2026-09-01", periodEnd: "2026-09-30", amount: 120000, quantity: 300000, unit: "kWh" },
  { kind: "electricity", periodStart: "2026-10-01", periodEnd: "2026-10-31", amount: 156000, quantity: 300000, unit: "kWh" },
]);
ok(costs[0].costPerUnit === 0.4, `September is 0.40 a unit (${costs[0].costPerUnit})`);
ok(costs[1].costPerUnit === 0.52, `October is 0.52 (${costs[1].costPerUnit})`);
ok(costs[1].changePercent === 30, `which is the thirty per cent rise, derived rather than claimed (${costs[1].changePercent}%)`);
ok(costs[0].changePercent === null, "the first period has nothing to compare against");
ok(unitCosts([{ kind: "water", periodStart: "2026-10-01", periodEnd: "2026-10-31", amount: 100, quantity: 0, unit: "litre" }]).length === 0,
   "an invoice with no quantity cannot give a unit cost and is left out");

console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
