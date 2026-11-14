import { ValidationError } from "./validation";

/**
 * Daily utility readings: the conversions, the day boundary, and the sums.
 *
 * Kept free of Prisma for the usual reason — the arithmetic is the part worth
 * testing, and none of it should need a database. The route supplies rows; this
 * decides what they mean.
 */

export const UTILITY_KINDS = ["electricity", "water", "propane", "diesel"] as const;
export type UtilityKind = (typeof UTILITY_KINDS)[number];

export const ENTRY_MODES = ["direct", "percentage", "tank_height"] as const;
export type EntryMode = (typeof ENTRY_MODES)[number];

/** The two rounds. Metric throughout, so litres and kWh rather than gallons. */
export const SLOTS = ["0200", "0500"] as const;
export type Slot = (typeof SLOTS)[number];

/**
 * The units a meter point may be read in.
 *
 * `gal` is here under protest. The department's own note flags the water meter as
 * unresolved between litres and US gallons, and the right answer to an unresolved
 * unit is to record which one was used rather than to pick one and hope. A point
 * read in gallons converts once, visibly, and the ambiguity stops being global.
 */
export const UNITS = ["kWh", "litre", "m3", "gal"] as const;
export type Unit = (typeof UNITS)[number];

/** US gallons, which is what a gauge on this site would be marked in. */
const LITRES_PER_GALLON = 3.785411784;
const LITRES_PER_M3 = 1000;

export function toLitres(value: number, unit: string): number {
  if (unit === "litre") return value;
  if (unit === "gal") return value * LITRES_PER_GALLON;
  if (unit === "m3") return value * LITRES_PER_M3;
  throw new ValidationError(`${unit} is not a volume`);
}

export interface MeterShape {
  entryMode: string;
  unit: string;
  capacityLitres: number | null;
  tankMaxHeightMm: number | null;
}

/**
 * What a raw reading means in the meter's own unit.
 *
 * A percentage and a tank height are both really "how full is it", and both need
 * the tank's own numbers to become a volume. Doing this on write, and keeping the
 * raw value beside it, means a wrong capacity can be corrected later and every
 * reading recomputed — which would be impossible if only the converted figure had
 * been kept.
 */
export function convertReading(raw: number, meter: MeterShape): number {
  switch (meter.entryMode) {
    case "percentage": {
      if (raw < 0 || raw > 100) throw new ValidationError("A percentage reading has to be between 0 and 100.");
      if (!meter.capacityLitres) throw new ValidationError("This tank has no capacity set, so a percentage cannot be turned into litres.");
      // Written as 47 or as 0.47: both are said in practice, and 0.47 per cent of
      // a propane tank is not a reading anybody takes.
      const fraction = raw > 1 ? raw / 100 : raw;
      return round3(meter.capacityLitres * fraction);
    }
    case "tank_height": {
      if (raw < 0) throw new ValidationError("A height cannot be negative.");
      if (!meter.tankMaxHeightMm) throw new ValidationError("This tank has no maximum height set, so a level cannot be turned into litres.");
      if (!meter.capacityLitres) throw new ValidationError("This tank has no capacity set, so a level cannot be turned into litres.");
      if (raw > meter.tankMaxHeightMm) {
        throw new ValidationError(`That is higher than the tank (${meter.tankMaxHeightMm}mm).`);
      }
      // A fraction of the maximum height applied to the capacity — which assumes
      // the tank has straight sides. For a cylinder on its side that is wrong in
      // the middle, and worth knowing before anybody trusts it to the litre.
      return round3(meter.capacityLitres * (raw / meter.tankMaxHeightMm));
    }
    default:
      return round3(raw);
  }
}

/**
 * The 05:00-to-05:00 day a reading belongs to.
 *
 * The department's day runs from one 05:00 round to the next, so a reading taken
 * at 02:00 belongs to the day that began at 05:00 the *previous* morning — it is
 * the overnight end of that day, not the start of a new one. Getting this wrong
 * puts every night's consumption on the wrong date, which is the kind of error
 * that survives for months because each day still looks plausible.
 *
 * Worked in the site's own local time, which is passed in rather than taken from
 * the server: a container in another timezone must not shift the day boundary.
 */
export function readingDayFor(takenAt: Date, utcOffsetMinutes = 0): string {
  const local = new Date(takenAt.getTime() + utcOffsetMinutes * 60000);
  const anchored = new Date(local);
  // 05:00 opens a day, so anything earlier still belongs to the one before.
  if (local.getUTCHours() < 5) anchored.setUTCDate(anchored.getUTCDate() - 1);
  return anchored.toISOString().slice(0, 10);
}

export interface ReadingRow {
  meterPointId: string;
  readingDay: string;
  slot: string;
  value: number;
}

export interface DayConsumption {
  day: string;
  /** The 05:00 round that opened this day. */
  opening: number | null;
  /** The 02:00 round, taken three hours before the day closes. */
  twoAm: number | null;
  /** The 05:00 round that closed it — which is the next day's opening. */
  closing: number | null;
  /** Used across the whole day, 05:00 to 05:00. */
  used: number | null;
  /** Used between 02:00 and 05:00 — the quiet hours. */
  usedOvernight: number | null;
  /** Used between 05:00 and 02:00 — while the hotel was open. */
  usedTrading: number | null;
  /** True where a round is missing, so a gap is visible rather than read as zero. */
  incomplete: boolean;
}

/**
 * Consumption per day for one meter point.
 *
 * The day runs 05:00 to 05:00, so the 05:00 round **opens** its day and the 02:00
 * round falls near the end of the day before it closes:
 *
 *     05:00 on D .......... 02:00 on D+1 ... 05:00 on D+1
 *     opens day D           late in day D    closes day D
 *
 * Which makes the sums:
 *
 *     used          = next opening − opening
 *     usedOvernight = next opening − the 02:00 reading      (02:00 → 05:00)
 *     usedTrading   = the 02:00 reading − opening           (05:00 → 02:00)
 *
 * Worth spelling out because the obvious reading — treating the 05:00 round as the
 * day's close — puts every day's consumption on the day before and makes the
 * overnight figure come out negative, and each individual day still looks
 * plausible enough for that to survive for months.
 *
 * For a cumulative meter use is the rise; for a tank it is the drop, and a rise
 * means the tank was filled. That is not negative consumption and must not be
 * reported as though the site produced propane overnight, so a refill day's usage
 * is unknown rather than zero: what was burnt before the delivery cannot be
 * recovered from two numbers.
 */
export function dailyConsumption(rows: ReadingRow[], cumulative: boolean): DayConsumption[] {
  const byDay = new Map<string, { opening?: number; twoAm?: number }>();
  for (const r of rows) {
    const entry = byDay.get(r.readingDay) ?? {};
    if (r.slot === "0500") entry.opening = r.value;
    if (r.slot === "0200") entry.twoAm = r.value;
    byDay.set(r.readingDay, entry);
  }

  const days = [...byDay.keys()].sort();
  const out: DayConsumption[] = [];

  /** A drop for a tank, a rise for a meter; negative either way means unknown. */
  const consumed = (earlier: number | null | undefined, later: number | null | undefined): number | null => {
    if (earlier === null || earlier === undefined || later === null || later === undefined) return null;
    const delta = cumulative ? later - earlier : earlier - later;
    return delta >= 0 ? round3(delta) : null;
  };

  for (const [index, day] of days.entries()) {
    const entry = byDay.get(day)!;
    const opening = entry.opening ?? null;
    const twoAm = entry.twoAm ?? null;
    // The day closes at the next day's opening — and only if that day is actually
    // the next one. A gap in the log must not be summed as a single long day.
    const nextKey = days[index + 1];
    const closing = nextKey && nextKey === nextDay(day) ? byDay.get(nextKey)!.opening ?? null : null;

    out.push({
      day,
      opening,
      twoAm,
      closing,
      used: consumed(opening, closing),
      usedOvernight: consumed(twoAm, closing),
      usedTrading: consumed(opening, twoAm),
      incomplete: opening === null || twoAm === null,
    });
  }
  return out;
}

export interface PeriodTotals {
  /** Week to date, from Monday. */
  wtd: number;
  /** Month to date. */
  mtd: number;
  /** Year to date, from 1 July — the financial year this operation runs on. */
  ytd: number;
  /** Days in each window that had a usable figure, so a total can be trusted. */
  days: { wtd: number; mtd: number; ytd: number };
}

/** 1 July, matching the Jul–Jun financial year the monthly reporting uses. */
export function financialYearStart(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return m >= 7 ? `${y}-07-01` : `${y - 1}-07-01`;
}

/** The Monday of the week a day falls in. */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  // Monday-first: getUTCDay is 0 for Sunday.
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Running totals to date.
 *
 * Days with no usable figure are skipped rather than counted as zero, and the
 * count of days that did contribute is returned alongside. A month-to-date total
 * built from nine of twenty days is not wrong, but it is not comparable with last
 * month either, and only the day count shows that.
 */
export function periodTotals(days: DayConsumption[], today: string): PeriodTotals {
  const monthStart = `${today.slice(0, 7)}-01`;
  const fyStart = financialYearStart(today);
  const wkStart = weekStart(today);

  const sum = (from: string) => {
    let total = 0;
    let counted = 0;
    for (const d of days) {
      if (d.day < from || d.day > today) continue;
      if (d.used === null) continue;
      total += d.used;
      counted += 1;
    }
    return { total: round3(total), counted };
  };

  const w = sum(wkStart);
  const m = sum(monthStart);
  const y = sum(fyStart);
  return {
    wtd: w.total,
    mtd: m.total,
    ytd: y.total,
    days: { wtd: w.counted, mtd: m.counted, ytd: y.counted },
  };
}

export interface InvoiceRow {
  kind: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  quantity: number;
  unit: string;
}

export interface UnitCost {
  periodStart: string;
  periodEnd: string;
  amount: number;
  quantity: number;
  unit: string;
  /** Amount divided by quantity — derived, never typed in. */
  costPerUnit: number;
  /** Change against the previous period, as a percentage. */
  changePercent: number | null;
}

/**
 * Cost per unit from the invoices, period by period, with the change between them.
 *
 * This exists so the app never has to accept a claim like "electricity is up
 * thirty per cent". It stores the bill and does the division, which means any
 * trend it states has a document behind it — the difference between a figure that
 * can go into a monthly report and one that cannot.
 */
export function unitCosts(invoices: InvoiceRow[]): UnitCost[] {
  const ordered = [...invoices]
    .filter((i) => i.quantity > 0)
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));

  return ordered.map((invoice, index) => {
    const costPerUnit = round4(invoice.amount / invoice.quantity);
    const previous = ordered[index - 1];
    const previousCost = previous ? previous.amount / previous.quantity : null;
    return {
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      amount: invoice.amount,
      quantity: invoice.quantity,
      unit: invoice.unit,
      costPerUnit,
      changePercent:
        previousCost && previousCost > 0 ? Math.round(((costPerUnit - previousCost) / previousCost) * 1000) / 10 : null,
    };
  });
}

/**
 * Days where a round was not taken, within a window.
 *
 * Reported because a missing reading is the most common fault in a log of this
 * kind and the easiest to miss: the chart simply has a shorter line, and nothing
 * says a round was skipped rather than nothing being used.
 */
export function missingRounds(days: DayConsumption[], from: string, to: string): { day: string; missing: Slot[] }[] {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const out: { day: string; missing: Slot[] }[] = [];
  for (let day = from; day <= to; day = nextDay(day)) {
    const entry = byDay.get(day);
    const missing: Slot[] = [];
    if (!entry || entry.twoAm === null) missing.push("0200");
    if (!entry || entry.opening === null) missing.push("0500");
    if (missing.length) out.push({ day, missing });
  }
  return out;
}

export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
