import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { LineChart } from "../components/Charts";
import { useCan } from "../auth/AuthContext";
import {
  ENTRY_MODE_LABELS, ENTRY_MODES, READING_UNIT_OPTIONS, SLOT_LABELS, SLOTS,
  UTILITY_KINDS, UTILITY_LABELS,
  type EntryMode, type MeterPoint, type Property, type Slot, type UtilityInvoice,
  type UtilityKind, type UtilitySummary,
} from "../types";

const today = () => new Date().toISOString().slice(0, 10);

function num(n: number | null | undefined, unit?: string): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 }) + (unit ? ` ${unit}` : "");
}

/**
 * The daily round, and the property in a nutshell.
 *
 * This replaces a workbook — a tab a day, two rounds, every meter and tank, with
 * week, month and year to date worked out by hand down the side. So the entry side
 * is deliberately the plainest thing on the page: a row per meter, two boxes, and
 * the converted figure shown beside what you typed so a wrong tank capacity is
 * obvious at the moment of entry rather than a month later.
 *
 * The cost side refuses to take a number on trust. The bill goes in and the app
 * does the division, which is the difference between a trend that can go in a
 * monthly report and one that cannot.
 */
export default function Utilities() {
  const can = useCan();
  const mayConfigure = can("settings.write");

  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [day, setDay] = useState(today());
  const [rows, setRows] = useState<{ meter: MeterPoint; readings: Partial<Record<Slot, { id: string; rawValue: number; value: number }>> }[]>([]);
  const [summary, setSummary] = useState<UtilitySummary | null>(null);
  const [invoices, setInvoices] = useState<UtilityInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const [showMeters, setShowMeters] = useState(false);
  const [mName, setMName] = useState("");
  const [mKind, setMKind] = useState<UtilityKind>("electricity");
  const [mMode, setMMode] = useState<EntryMode>("direct");
  const [mUnit, setMUnit] = useState("kWh");
  const [mCapacity, setMCapacity] = useState("");
  const [mHeight, setMHeight] = useState("");
  const [mRollUp, setMRollUp] = useState(true);

  const [showInvoice, setShowInvoice] = useState(false);
  const [iKind, setIKind] = useState<UtilityKind>("electricity");
  const [iStart, setIStart] = useState("");
  const [iEnd, setIEnd] = useState("");
  const [iAmount, setIAmount] = useState("");
  const [iQuantity, setIQuantity] = useState("");
  const [iUnit, setIUnit] = useState("kWh");

  useEffect(() => {
    api.listProperties()
      .then((p) => {
        setProperties(p);
        setPropertyId((cur) => cur || p[0]?.id || "");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const load = useCallback(() => {
    if (!propertyId) return;
    setLoading(true);
    Promise.all([
      api.readingsForDay(propertyId, day),
      api.utilitySummary(propertyId, { today: today() }),
      api.listUtilityInvoices(propertyId),
    ])
      .then(([r, s, inv]) => {
        setRows(r.rows as any);
        setSummary(s);
        setInvoices(inv.invoices);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [propertyId, day]);

  useEffect(load, [load]);

  async function run(work: () => Promise<unknown>, note?: string) {
    setBusy(true);
    try {
      await work();
      load();
      setError(null);
      if (note) {
        setSaved(note);
        setTimeout(() => setSaved(null), 2500);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const byKind = useMemo(() => {
    const out: Record<string, typeof rows> = {};
    for (const row of rows) (out[row.meter.kind] ??= []).push(row);
    return out;
  }, [rows]);

  if (loading && !summary) return <div className="page"><div className="loading-state">Loading…</div></div>;

  return (
    <div className="page util-page">
      <div className="page-header">
        <div>
          <h1>Utilities</h1>
          <p className="muted">
            Two rounds a day, every meter and tank. The day runs from one 05:00 to the next, so a 02:00
            reading belongs to the day before it.
          </p>
        </div>
        <div className="page-header-actions">
          <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} aria-label="Property">
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {saved && <div className="banner banner-ok small">{saved}</div>}

      {/* ---- the property in a nutshell ---------------------------------- */}
      {summary && Object.keys(summary.siteTotals).length > 0 && (
        <section className="util-nutshell">
          {UTILITY_KINDS.filter((k) => summary.siteTotals[k]).map((kind) => {
            const t = summary.siteTotals[kind];
            const costs = summary.costs[kind] ?? [];
            const latestCost = costs[costs.length - 1] ?? null;
            const unit = summary.meters.find((m) => m.meter.kind === kind)?.meter.unit ?? "";
            return (
              <div key={kind} className="util-card">
                <h3>{UTILITY_LABELS[kind]}</h3>
                <div className="util-figures">
                  <span><small className="muted">Week</small><strong>{num(t.wtd)}</strong></span>
                  <span><small className="muted">Month</small><strong>{num(t.mtd)}</strong></span>
                  <span><small className="muted">Year</small><strong>{num(t.ytd)}</strong></span>
                </div>
                <p className="muted small">
                  {unit} · across {t.meters} meter{t.meters === 1 ? "" : "s"} that roll up
                </p>
                {/* Derived from the bill, never typed in — so the trend has a
                    document behind it. */}
                {latestCost && (
                  <p className="util-cost small">
                    {latestCost.costPerUnit} per {latestCost.unit}
                    {latestCost.changePercent !== null && (
                      <strong className={latestCost.changePercent > 0 ? "is-late" : "is-early"}>
                        {" "}{latestCost.changePercent > 0 ? "+" : ""}{latestCost.changePercent}%
                      </strong>
                    )}
                    <em className="muted"> from the {latestCost.periodStart.slice(0, 7)} invoice</em>
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* ---- today's round ----------------------------------------------- */}
      <section className="card util-round">
        <div className="util-round-head">
          <h2>The round</h2>
          <label>
            Day
            <input type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} />
          </label>
          {day !== today() && (
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setDay(today())}>
              Back to today
            </button>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="muted small">
            No meters set up at this property yet. {mayConfigure ? "Add one below." : "An admin can add them."}
          </p>
        ) : (
          UTILITY_KINDS.filter((k) => byKind[k]?.length).map((kind) => (
            <div key={kind} className="util-group">
              <h4>{UTILITY_LABELS[kind]}</h4>
              <ul className="util-rows">
                {byKind[kind].map(({ meter, readings }) => (
                  <li key={meter.id} className="util-row">
                    <span className="util-row-name">
                      {meter.name}
                      {!meter.includeInSiteTotal && <em className="muted small"> submeter</em>}
                      <small className="muted">
                        {meter.entryMode === "direct"
                          ? meter.unit
                          : meter.entryMode === "percentage"
                            ? `% of ${num(meter.capacityLitres)} litres`
                            : `mm of ${num(meter.tankMaxHeightMm)}`}
                      </small>
                    </span>
                    {SLOTS.map((slot) => {
                      const existing = readings[slot];
                      return (
                        <label key={slot} className="util-slot">
                          <small className="muted">{SLOT_LABELS[slot]}</small>
                          <input
                            type="number"
                            step="any"
                            inputMode="decimal"
                            defaultValue={existing?.rawValue ?? ""}
                            disabled={busy}
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === "") return;
                              const value = Number(raw);
                              if (!Number.isFinite(value) || value === existing?.rawValue) return;
                              run(
                                () => api.recordReading({ meterPointId: meter.id, slot, rawValue: value, readingDay: day }),
                                `${meter.name} at ${SLOT_LABELS[slot]} recorded.`
                              );
                            }}
                            aria-label={`${meter.name} at ${SLOT_LABELS[slot]}`}
                          />
                          {/* The converted figure beside what was typed, so a
                              wrong tank capacity shows up now rather than in a
                              month's report. */}
                          {existing && meter.entryMode !== "direct" && (
                            <em className="util-converted">= {num(existing.value, meter.unit)}</em>
                          )}
                        </label>
                      );
                    })}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {/* ---- what it did, day by day -------------------------------------- */}
      {summary?.meters.filter((m) => m.days.length > 1).map((entry) => {
        const recent = entry.days.slice(-30);
        return (
          <section key={entry.meter.id} className="card util-chart">
            <div className="util-chart-head">
              <h3>{entry.meter.name}</h3>
              <span className="muted small">
                {num(entry.totals.wtd)} this week · {num(entry.totals.mtd)} this month ({entry.totals.days.mtd} day
                {entry.totals.days.mtd === 1 ? "" : "s"}) · {num(entry.totals.ytd)} since July
              </span>
            </div>
            <LineChart
              title={`Used per day — ${entry.meter.unit}`}
              labels={recent.map((d) => d.day.slice(5))}
              values={recent.map((d) => d.used)}
              formatValue={(n) => num(n)}
            />
            <LineChart
              title="Overnight only — 02:00 to 05:00"
              subtitle="The quiet hours, where a leak or something left running shows up"
              labels={recent.map((d) => d.day.slice(5))}
              values={recent.map((d) => d.usedOvernight)}
              colour="#9a6700"
              formatValue={(n) => num(n)}
            />
            {/* A missed round is the commonest fault in a log like this and the
                easiest to miss: the line is simply shorter. */}
            {entry.missing.length > 0 && (
              <p className="banner banner-warn small">
                {entry.missing.length} round{entry.missing.length === 1 ? "" : "s"} not taken in the last fortnight:{" "}
                {entry.missing.slice(0, 5).map((m) => `${m.day} (${m.missing.map((s) => SLOT_LABELS[s]).join(" and ")})`).join(", ")}
                {entry.missing.length > 5 ? `, and ${entry.missing.length - 5} more` : ""}
              </p>
            )}
          </section>
        );
      })}

      {/* ---- the bills ---------------------------------------------------- */}
      <section className="card util-invoices">
        <div className="util-round-head">
          <h2>Invoices</h2>
          <span className="muted small">Cost per unit is worked out from these, not typed in</span>
          {mayConfigure && (
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setShowInvoice((v) => !v)}>
              {showInvoice ? "Cancel" : "Record one"}
            </button>
          )}
        </div>

        {showInvoice && (
          <div className="util-form">
            <label>Utility
              <select value={iKind} onChange={(e) => setIKind(e.target.value as UtilityKind)}>
                {UTILITY_KINDS.map((k) => <option key={k} value={k}>{UTILITY_LABELS[k]}</option>)}
              </select>
            </label>
            <label>From<input type="date" value={iStart} onChange={(e) => setIStart(e.target.value)} /></label>
            <label>To<input type="date" value={iEnd} onChange={(e) => setIEnd(e.target.value)} /></label>
            <label>Amount<input type="number" step="any" value={iAmount} onChange={(e) => setIAmount(e.target.value)} /></label>
            <label>Quantity billed<input type="number" step="any" value={iQuantity} onChange={(e) => setIQuantity(e.target.value)} /></label>
            <label>In
              <select value={iUnit} onChange={(e) => setIUnit(e.target.value)}>
                {READING_UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={busy || !iStart || !iEnd || !iAmount || !iQuantity}
              onClick={() =>
                run(async () => {
                  await api.recordUtilityInvoice({
                    propertyId, kind: iKind, periodStart: iStart, periodEnd: iEnd,
                    amount: Number(iAmount), quantity: Number(iQuantity), unit: iUnit,
                  });
                  setIStart(""); setIEnd(""); setIAmount(""); setIQuantity("");
                  setShowInvoice(false);
                }, "Invoice recorded.")
              }
            >
              Record it
            </button>
          </div>
        )}

        {invoices.length === 0 ? (
          <p className="muted small">
            No invoices recorded. Without one there is no cost per unit, so a claim that a utility has risen
            cannot be checked.
          </p>
        ) : (
          <ul className="util-invoice-list">
            {UTILITY_KINDS.filter((k) => (summary?.costs[k] ?? []).length).map((kind) =>
              (summary!.costs[kind] ?? []).map((c) => (
                <li key={`${kind}-${c.periodStart}`}>
                  <span>{UTILITY_LABELS[kind]}</span>
                  <span className="muted small">{c.periodStart} to {c.periodEnd}</span>
                  <span>{num(c.amount)} for {num(c.quantity)} {c.unit}</span>
                  <strong>{c.costPerUnit} / {c.unit}</strong>
                  {c.changePercent !== null && (
                    <span className={c.changePercent > 0 ? "is-late" : "is-early"}>
                      {c.changePercent > 0 ? "+" : ""}{c.changePercent}%
                    </span>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
      </section>

      {/* ---- the meters themselves ---------------------------------------- */}
      {mayConfigure && (
        <section className="card util-meters">
          <div className="util-round-head">
            <h2>Meters and tanks</h2>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setShowMeters((v) => !v)}>
              {showMeters ? "Done" : "Set up"}
            </button>
          </div>

          {showMeters && (
            <>
              <div className="util-form">
                <label>Name<input value={mName} onChange={(e) => setMName(e.target.value)} placeholder="Main meter" maxLength={120} /></label>
                <label>Utility
                  <select value={mKind} onChange={(e) => setMKind(e.target.value as UtilityKind)}>
                    {UTILITY_KINDS.map((k) => <option key={k} value={k}>{UTILITY_LABELS[k]}</option>)}
                  </select>
                </label>
                <label>Read as
                  <select
                    value={mMode}
                    onChange={(e) => {
                      const mode = e.target.value as EntryMode;
                      setMMode(mode);
                      if (mode !== "direct") setMUnit("litre");
                    }}
                  >
                    {ENTRY_MODES.map((m) => <option key={m} value={m}>{ENTRY_MODE_LABELS[m]}</option>)}
                  </select>
                </label>
                <label>Stored in
                  <select value={mUnit} onChange={(e) => setMUnit(e.target.value)}>
                    {READING_UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </label>
                {mMode !== "direct" && (
                  <label>Capacity in litres<input type="number" step="any" value={mCapacity} onChange={(e) => setMCapacity(e.target.value)} /></label>
                )}
                {mMode === "tank_height" && (
                  <label>Full height in mm<input type="number" step="any" value={mHeight} onChange={(e) => setMHeight(e.target.value)} /></label>
                )}
                <label className="util-check">
                  <input type="checkbox" checked={mRollUp} onChange={(e) => setMRollUp(e.target.checked)} />
                  Counts toward the site total
                </label>
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={busy || !mName.trim()}
                  onClick={() =>
                    run(async () => {
                      await api.createMeter({
                        propertyId, name: mName.trim(), kind: mKind, entryMode: mMode, unit: mUnit,
                        capacityLitres: mCapacity ? Number(mCapacity) : null,
                        tankMaxHeightMm: mHeight ? Number(mHeight) : null,
                        includeInSiteTotal: mRollUp,
                      });
                      setMName(""); setMCapacity(""); setMHeight("");
                    }, "Meter added.")
                  }
                >
                  Add
                </button>
              </div>

              <ul className="util-meter-list">
                {rows.map(({ meter }) => (
                  <li key={meter.id}>
                    <span>{meter.name}</span>
                    <span className="muted small">
                      {UTILITY_LABELS[meter.kind]} · {ENTRY_MODE_LABELS[meter.entryMode]} · {meter.unit}
                      {meter.includeInSiteTotal ? "" : " · submeter"}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-small danger"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const result = await api.retireMeter(meter.id);
                          if (result?.message) alert(result.message);
                        })
                      }
                    >
                      Retire
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
