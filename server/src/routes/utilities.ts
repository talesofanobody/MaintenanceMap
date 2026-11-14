import { Router } from "express";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { parseOptionalDay, parseOptionalString, ValidationError } from "../lib/validation";
import {
  convertReading, dailyConsumption, ENTRY_MODES, missingRounds, nextDay, periodTotals,
  readingDayFor, SLOTS, unitCosts, UNITS, UTILITY_KINDS,
} from "../lib/utilities";

/**
 * Daily utility readings.
 *
 * This replaces a workbook: a tab a day, two rounds, every meter and tank, with
 * week-, month- and year-to-date worked out by hand down the side. The shape here
 * follows the rules that workbook already runs on rather than inventing any —
 * rounds at 02:00 and 05:00, a day from one 05:00 to the next, site electricity as
 * the sum of the meters that roll up, tanks entered as a percentage or a height.
 *
 * The one place it deliberately refuses to follow is cost. A claim that
 * electricity rose thirty per cent is not something to type in; the invoice goes
 * in and the app does the division, so any trend it reports has a document behind
 * it.
 */
export const utilitiesRouter = Router();

const METER_INCLUDE = { property: { select: { id: true, name: true } } } as const;

function parseNumber(value: unknown, field: string, { min }: { min?: number } = {}): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${field} must be a number`);
  if (min !== undefined && n < min) throw new ValidationError(`${field} cannot be below ${min}`);
  return n;
}

function oneOf(value: unknown, allowed: readonly string[], field: string): string {
  const s = typeof value === "string" ? value : "";
  if (!allowed.includes(s)) throw new ValidationError(`${field} must be one of ${allowed.join(", ")}`);
  return s;
}

// ---------------------------------------------------------------------------
// Meter points
// ---------------------------------------------------------------------------

utilitiesRouter.get("/meters", async (req, res) => {
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
  const meters = await prisma.meterPoint.findMany({
    where: { ...(propertyId ? { propertyId } : {}), ...(req.query.all ? {} : { active: true }) },
    include: METER_INCLUDE,
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    take: 500,
  });
  res.json({ meters, kinds: UTILITY_KINDS, entryModes: ENTRY_MODES, units: UNITS, slots: SLOTS });
});

utilitiesRouter.post("/meters", requires("settings.write"), async (req, res) => {
  try {
    const propertyId = typeof req.body.propertyId === "string" ? req.body.propertyId : "";
    const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, name: true } });
    if (!property) return res.status(400).json({ error: "That property does not exist." });

    const name = parseOptionalString(req.body.name, "name", 120);
    if (!name) return res.status(400).json({ error: "A meter needs a name, such as 'Main meter' or 'Propane bulk 1'." });

    const kind = oneOf(req.body.kind, UTILITY_KINDS, "kind");
    const entryMode = oneOf(req.body.entryMode ?? "direct", ENTRY_MODES, "entryMode");
    const unit = oneOf(req.body.unit, UNITS, "unit");
    const capacityLitres = parseNumber(req.body.capacityLitres, "capacityLitres", { min: 0 }) ?? null;
    const tankMaxHeightMm = parseNumber(req.body.tankMaxHeightMm, "tankMaxHeightMm", { min: 0 }) ?? null;

    // A tank that cannot be converted is worse than no tank: every reading on it
    // would be refused later, one round at a time, by whoever is holding the phone.
    if (entryMode === "percentage" && !capacityLitres) {
      return res.status(400).json({ error: "A tank read as a percentage needs its capacity in litres." });
    }
    if (entryMode === "tank_height" && (!capacityLitres || !tankMaxHeightMm)) {
      return res.status(400).json({ error: "A tank read by height needs both its capacity and its full height." });
    }

    const meter = await prisma.meterPoint.create({
      data: {
        propertyId,
        name,
        kind,
        entryMode,
        unit,
        capacityLitres,
        tankMaxHeightMm,
        includeInSiteTotal: req.body.includeInSiteTotal !== false,
        // A tank level goes up and down; a meter only climbs. Defaulting by entry
        // mode, because a tank read as a percentage is never cumulative.
        cumulative: req.body.cumulative !== undefined ? !!req.body.cumulative : entryMode === "direct",
        notes: parseOptionalString(req.body.notes, "notes", 1000) ?? null,
        sortOrder: parseNumber(req.body.sortOrder, "sortOrder") ?? 0,
      },
      include: METER_INCLUDE,
    });

    await logActivity(req, {
      action: "meter.created",
      entityType: "system",
      entityId: meter.id,
      propertyId,
      summary: `Added the ${kind} meter "${meter.name}" at ${property.name}`,
    });
    res.status(201).json(meter);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

utilitiesRouter.put("/meters/:id", requires("settings.write"), async (req, res) => {
  const existing = await prisma.meterPoint.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not found" });
  try {
    const data: Record<string, unknown> = {};
    if (req.body.name !== undefined) {
      const name = parseOptionalString(req.body.name, "name", 120);
      if (!name) return res.status(400).json({ error: "A meter needs a name." });
      data.name = name;
    }
    if (req.body.entryMode !== undefined) data.entryMode = oneOf(req.body.entryMode, ENTRY_MODES, "entryMode");
    if (req.body.unit !== undefined) data.unit = oneOf(req.body.unit, UNITS, "unit");
    if (req.body.capacityLitres !== undefined) data.capacityLitres = parseNumber(req.body.capacityLitres, "capacityLitres", { min: 0 });
    if (req.body.tankMaxHeightMm !== undefined) data.tankMaxHeightMm = parseNumber(req.body.tankMaxHeightMm, "tankMaxHeightMm", { min: 0 });
    if (req.body.includeInSiteTotal !== undefined) data.includeInSiteTotal = !!req.body.includeInSiteTotal;
    if (req.body.cumulative !== undefined) data.cumulative = !!req.body.cumulative;
    if (req.body.active !== undefined) data.active = !!req.body.active;
    if (req.body.notes !== undefined) data.notes = parseOptionalString(req.body.notes, "notes", 1000) ?? null;
    if (req.body.sortOrder !== undefined) data.sortOrder = parseNumber(req.body.sortOrder, "sortOrder") ?? 0;

    const meter = await prisma.meterPoint.update({ where: { id: existing.id }, data, include: METER_INCLUDE });
    res.json(meter);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/**
 * Taking a meter out of use rather than deleting it.
 *
 * Deleting would take its readings with it, and a year of consumption history is
 * not something to lose because a meter was replaced. Deactivating keeps the
 * series and stops it appearing on the round.
 */
utilitiesRouter.delete("/meters/:id", requires("settings.write"), async (req, res) => {
  const meter = await prisma.meterPoint.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, propertyId: true, _count: { select: { readings: true } } },
  });
  if (!meter) return res.status(404).json({ error: "not found" });

  if (meter._count.readings > 0 && !req.body?.force) {
    await prisma.meterPoint.update({ where: { id: meter.id }, data: { active: false } });
    return res.json({
      deactivated: true,
      readings: meter._count.readings,
      message: `"${meter.name}" has ${meter._count.readings} reading${meter._count.readings === 1 ? "" : "s"} against it, so it has been taken out of use rather than deleted. Its history is kept.`,
    });
  }

  await prisma.meterPoint.delete({ where: { id: meter.id } });
  await logActivity(req, {
    action: "meter.deleted",
    entityType: "system",
    entityId: meter.id,
    propertyId: meter.propertyId,
    summary: `Deleted the meter "${meter.name}"${meter._count.readings ? ` and its ${meter._count.readings} readings` : ""}`,
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

/**
 * Record a round.
 *
 * The raw value is kept beside the converted one, always. A tank's capacity gets
 * corrected sooner or later, and when it does every reading on it can be
 * recomputed — which would be impossible if only the litres had been stored.
 *
 * Re-recording the same point, day and round replaces the reading rather than
 * adding another: a second entry for the same round is a correction, not a second
 * data point, and two of them would make the day's consumption meaningless.
 */
utilitiesRouter.post("/readings", requires("issue.write"), async (req, res) => {
  try {
    const meterPointId = typeof req.body.meterPointId === "string" ? req.body.meterPointId : "";
    const meter = await prisma.meterPoint.findUnique({ where: { id: meterPointId } });
    if (!meter) return res.status(400).json({ error: "That meter does not exist." });

    const slot = oneOf(req.body.slot, SLOTS, "slot");
    const raw = parseNumber(req.body.rawValue, "rawValue");
    if (raw === null || raw === undefined) return res.status(400).json({ error: "A reading needs a number." });

    const takenAt = req.body.takenAt ? new Date(String(req.body.takenAt)) : new Date();
    if (Number.isNaN(takenAt.getTime())) return res.status(400).json({ error: "That is not a real time." });

    // The day can be stated, for typing up a round from paper; otherwise it comes
    // from the time it was taken, through the 05:00 boundary.
    const stated = parseOptionalDay(req.body.readingDay, "readingDay");
    const readingDay = stated ?? readingDayFor(takenAt);

    const value = convertReading(raw, meter);

    const reading = await prisma.reading.upsert({
      where: { meterPointId_readingDay_slot: { meterPointId, readingDay, slot } },
      create: {
        meterPointId,
        takenAt,
        slot,
        readingDay,
        rawValue: raw,
        value,
        takenBy: req.user!.username,
        notes: parseOptionalString(req.body.notes, "notes", 500) ?? null,
      },
      update: {
        takenAt,
        rawValue: raw,
        value,
        takenBy: req.user!.username,
        notes: parseOptionalString(req.body.notes, "notes", 500) ?? null,
      },
      include: { meterPoint: { select: { id: true, name: true, kind: true, unit: true } } },
    });
    res.status(201).json(reading);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/** One day's round across every meter, for the screen that enters them. */
utilitiesRouter.get("/readings", async (req, res) => {
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
  if (!propertyId) return res.status(400).json({ error: "Which property?" });
  const day = parseOptionalDay(req.query.day, "day") ?? new Date().toISOString().slice(0, 10);

  const meters = await prisma.meterPoint.findMany({
    where: { propertyId, active: true },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  const readings = await prisma.reading.findMany({
    where: { meterPointId: { in: meters.map((m) => m.id) }, readingDay: day },
  });

  const byMeter = new Map<string, Record<string, (typeof readings)[number]>>();
  for (const r of readings) {
    const entry = byMeter.get(r.meterPointId) ?? {};
    entry[r.slot] = r;
    byMeter.set(r.meterPointId, entry);
  }

  res.json({
    day,
    rows: meters.map((meter) => ({ meter, readings: byMeter.get(meter.id) ?? {} })),
    slots: SLOTS,
  });
});

utilitiesRouter.delete("/readings/:id", requires("issue.write"), async (req, res) => {
  const reading = await prisma.reading.findUnique({ where: { id: req.params.id } });
  if (!reading) return res.status(404).json({ error: "not found" });
  await prisma.reading.delete({ where: { id: reading.id } });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

utilitiesRouter.get("/invoices", async (req, res) => {
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
  const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
  const invoices = await prisma.utilityInvoice.findMany({
    where: { ...(propertyId ? { propertyId } : {}), ...(kind ? { kind } : {}) },
    orderBy: [{ kind: "asc" }, { periodStart: "asc" }],
    take: 500,
  });
  // Grouped by utility, because cost per unit only compares within one.
  const byKind: Record<string, ReturnType<typeof unitCosts>> = {};
  for (const k of UTILITY_KINDS) {
    const rows = invoices.filter((i) => i.kind === k);
    if (rows.length) byKind[k] = unitCosts(rows);
  }
  res.json({ invoices, costs: byKind });
});

utilitiesRouter.post("/invoices", requires("settings.write"), async (req, res) => {
  try {
    const propertyId = typeof req.body.propertyId === "string" ? req.body.propertyId : "";
    const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, name: true } });
    if (!property) return res.status(400).json({ error: "That property does not exist." });

    const kind = oneOf(req.body.kind, UTILITY_KINDS, "kind");
    const unit = oneOf(req.body.unit, UNITS, "unit");
    const periodStart = parseOptionalDay(req.body.periodStart, "periodStart");
    const periodEnd = parseOptionalDay(req.body.periodEnd, "periodEnd");
    if (!periodStart || !periodEnd) return res.status(400).json({ error: "An invoice needs the period it covers." });
    if (periodEnd < periodStart) return res.status(400).json({ error: "The period ends before it starts." });

    const amount = parseNumber(req.body.amount, "amount", { min: 0 });
    const quantity = parseNumber(req.body.quantity, "quantity", { min: 0 });
    if (amount === null || amount === undefined) return res.status(400).json({ error: "An invoice needs its amount." });
    if (!quantity) {
      // Without a quantity there is no cost per unit, which is the only reason
      // this table exists.
      return res.status(400).json({ error: "An invoice needs the quantity billed, or there is no cost per unit to work out." });
    }

    const invoice = await prisma.utilityInvoice.upsert({
      where: { propertyId_kind_periodStart_periodEnd: { propertyId, kind, periodStart, periodEnd } },
      create: {
        propertyId, kind, periodStart, periodEnd, amount, quantity, unit,
        reference: parseOptionalString(req.body.reference, "reference", 120) ?? null,
        notes: parseOptionalString(req.body.notes, "notes", 1000) ?? null,
      },
      update: {
        amount, quantity, unit,
        reference: parseOptionalString(req.body.reference, "reference", 120) ?? null,
        notes: parseOptionalString(req.body.notes, "notes", 1000) ?? null,
      },
    });

    await logActivity(req, {
      action: "utility_invoice.recorded",
      entityType: "system",
      entityId: invoice.id,
      propertyId,
      summary: `${kind} invoice for ${periodStart} to ${periodEnd}: ${amount} for ${quantity} ${unit} — ${Math.round((amount / quantity) * 10000) / 10000} per ${unit}`,
    });
    res.status(201).json(invoice);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

utilitiesRouter.delete("/invoices/:id", requires("settings.write"), async (req, res) => {
  const invoice = await prisma.utilityInvoice.findUnique({ where: { id: req.params.id } });
  if (!invoice) return res.status(404).json({ error: "not found" });
  await prisma.utilityInvoice.delete({ where: { id: invoice.id } });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// The property in a nutshell
// ---------------------------------------------------------------------------

/**
 * Everything the daily screen needs, in one response.
 *
 * Per meter: the daily series, the overnight split, week-, month- and
 * year-to-date, and which rounds were missed. Per utility: the site total across
 * the meters that roll up, and cost per unit from the invoices. Nothing is cached
 * — these are sums over one property's readings, and a stale number on a screen
 * somebody uses to make a decision is worse than a recomputed one.
 */
utilitiesRouter.get("/summary", async (req, res) => {
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
  if (!propertyId) return res.status(400).json({ error: "Which property?" });

  const today = parseOptionalDay(req.query.today, "today") ?? new Date().toISOString().slice(0, 10);
  // Enough history for a year-to-date figure and a chart with context.
  const from = parseOptionalDay(req.query.from, "from") ?? `${Number(today.slice(0, 4)) - 1}-07-01`;

  const meters = await prisma.meterPoint.findMany({
    where: { propertyId, active: true },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  const readings = await prisma.reading.findMany({
    where: { meterPointId: { in: meters.map((m) => m.id) }, readingDay: { gte: from, lte: nextDay(today) } },
    select: { meterPointId: true, readingDay: true, slot: true, value: true },
    orderBy: { readingDay: "asc" },
  });

  const perMeter = meters.map((meter) => {
    const rows = readings.filter((r) => r.meterPointId === meter.id);
    const days = dailyConsumption(rows, meter.cumulative);
    /**
     * Rounds that were not taken, over the last fortnight — but never before this
     * meter was first read. Without that clamp a meter installed yesterday reports
     * a fortnight of missed rounds, which is a screen full of false alarms and the
     * quickest way to teach somebody to ignore the list.
     */
    const firstRead = days.length ? days[0].day : null;
    const window = firstRead ? (firstRead > lastDays(today, 14) ? firstRead : lastDays(today, 14)) : null;
    return {
      meter,
      days,
      totals: periodTotals(days, today),
      missing: window ? missingRounds(days, window, today) : [],
      latest: days.length ? days[days.length - 1] : null,
    };
  });

  // The site total per utility, over the meters that roll up. Summed from the
  // per-day figures rather than from the meters' own readings, so a submeter
  // excluded from the roll-up really is excluded.
  const siteTotals: Record<string, { wtd: number; mtd: number; ytd: number; meters: number }> = {};
  for (const entry of perMeter) {
    if (!entry.meter.includeInSiteTotal) continue;
    const k = entry.meter.kind;
    const acc = siteTotals[k] ?? { wtd: 0, mtd: 0, ytd: 0, meters: 0 };
    acc.wtd += entry.totals.wtd;
    acc.mtd += entry.totals.mtd;
    acc.ytd += entry.totals.ytd;
    acc.meters += 1;
    siteTotals[k] = acc;
  }
  for (const k of Object.keys(siteTotals)) {
    siteTotals[k].wtd = Math.round(siteTotals[k].wtd * 1000) / 1000;
    siteTotals[k].mtd = Math.round(siteTotals[k].mtd * 1000) / 1000;
    siteTotals[k].ytd = Math.round(siteTotals[k].ytd * 1000) / 1000;
  }

  const invoices = await prisma.utilityInvoice.findMany({ where: { propertyId }, orderBy: { periodStart: "asc" } });
  const costs: Record<string, ReturnType<typeof unitCosts>> = {};
  for (const k of UTILITY_KINDS) {
    const rows = invoices.filter((i) => i.kind === k);
    if (rows.length) costs[k] = unitCosts(rows);
  }

  res.json({ today, from, meters: perMeter, siteTotals, costs, kinds: UTILITY_KINDS });
});

function lastDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
