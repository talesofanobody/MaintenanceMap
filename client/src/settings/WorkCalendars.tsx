import { useEffect, useState } from "react";
import { api } from "../api";
import { WEEKDAY_NAMES, type Property, type WorkCalendar } from "../types";

function weekOf(calendar: WorkCalendar): boolean[] {
  try {
    const parsed = JSON.parse(calendar.workingDays);
    if (Array.isArray(parsed) && parsed.length === 7) return parsed.map((v) => !!v);
  } catch {
    // A corrupt row should not take the screen down.
  }
  return [true, true, true, true, true, true, false];
}

/**
 * Which days work actually happens on.
 *
 * Opt-in, and the screen says why. Setting a calendar changes every float figure
 * on that property's programmes: a job finishing Friday and the next starting
 * Monday has two days of slack when every day counts and one when Sunday is not
 * worked. That is the point of having one — the old figure was generous, and
 * generous float is the kind that gets believed — but it is a change somebody
 * should make deliberately rather than discover.
 */
export default function WorkCalendars() {
  const [calendars, setCalendars] = useState<WorkCalendar[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newFor, setNewFor] = useState("");
  const [exDay, setExDay] = useState<Record<string, string>>({});
  const [exReason, setExReason] = useState<Record<string, string>>({});
  const [exWorking, setExWorking] = useState<Record<string, boolean>>({});

  useEffect(() => {
    Promise.all([api.listCalendars(), api.listProperties()])
      .then(([cals, props]) => {
        setCalendars(cals);
        setProperties(props);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      setCalendars(await api.listCalendars());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const hasFallback = calendars.some((c) => c.propertyId === null);
  const spoken = properties.filter((p) => !calendars.some((c) => c.propertyId === p.id));

  if (loading) return <div className="loading-state">Loading…</div>;

  return (
    <section className="card cal-page">
      <h2>Working days</h2>
      <p className="muted small">
        Which days work happens on. Without a calendar, a programme counts every day, so a job finishing
        Friday and the next starting Monday shows two days of slack. With one, that gap is as long as the
        days actually worked — which is usually shorter, and is the figure worth believing.
      </p>

      {error && <div className="banner banner-error">{error}</div>}

      {calendars.length === 0 ? (
        <p className="muted small">No calendars set, so every day counts everywhere.</p>
      ) : (
        <ul className="cal-list">
          {calendars.map((cal) => {
            const week = weekOf(cal);
            return (
              <li key={cal.id} className="cal">
                <div className="cal-head">
                  <strong>{cal.property?.name ?? "Everywhere else"}</strong>
                  <span className="muted small">
                    {week.filter(Boolean).length} day{week.filter(Boolean).length === 1 ? "" : "s"} a week
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-small danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Remove this calendar? ${cal.property?.name ?? "Properties without their own"} goes back to counting every day, and float figures will go up.`)) {
                        run(() => api.deleteCalendar(cal.id));
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>

                <div className="cal-week">
                  {WEEKDAY_NAMES.map((name, i) => (
                    <label key={name} className={`cal-day ${week[i] ? "is-on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={week[i]}
                        disabled={busy}
                        onChange={(e) => {
                          const next = [...week];
                          next[i] = e.target.checked;
                          if (!next.some(Boolean)) {
                            setError("At least one day of the week has to be a working day.");
                            return;
                          }
                          run(() => api.updateCalendar(cal.id, { workingDays: next }));
                        }}
                      />
                      {name}
                    </label>
                  ))}
                </div>

                {/* Both directions. A calendar that held only holidays would be
                    wrong on exactly the days a programme cares about. */}
                <div className="cal-ex">
                  <div className="cal-ex-new">
                    <label>
                      Date
                      <input
                        type="date"
                        value={exDay[cal.id] ?? ""}
                        onChange={(e) => setExDay((v) => ({ ...v, [cal.id]: e.target.value }))}
                      />
                    </label>
                    <label>
                      Why
                      <input
                        value={exReason[cal.id] ?? ""}
                        maxLength={200}
                        placeholder="Public holiday, shutdown, catch-up day"
                        onChange={(e) => setExReason((v) => ({ ...v, [cal.id]: e.target.value }))}
                      />
                    </label>
                    <label className="cal-ex-dir">
                      <input
                        type="checkbox"
                        checked={!!exWorking[cal.id]}
                        onChange={(e) => setExWorking((v) => ({ ...v, [cal.id]: e.target.checked }))}
                      />
                      Worked anyway
                    </label>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      disabled={busy || !exDay[cal.id]}
                      onClick={() =>
                        run(async () => {
                          await api.setCalendarException(cal.id, {
                            day: exDay[cal.id],
                            working: !!exWorking[cal.id],
                            reason: exReason[cal.id]?.trim() || undefined,
                          });
                          setExDay((v) => ({ ...v, [cal.id]: "" }));
                          setExReason((v) => ({ ...v, [cal.id]: "" }));
                          setExWorking((v) => ({ ...v, [cal.id]: false }));
                        })
                      }
                    >
                      Add
                    </button>
                  </div>

                  {cal.exceptions.length > 0 && (
                    <ul className="cal-ex-list">
                      {cal.exceptions.map((e) => (
                        <li key={e.id} className={e.working ? "is-worked" : "is-off"}>
                          <span>{e.day}</span>
                          <span className="muted small">{e.working ? "worked anyway" : "not worked"}{e.reason ? ` · ${e.reason}` : ""}</span>
                          <button
                            type="button"
                            className="btn btn-ghost btn-small"
                            disabled={busy}
                            onClick={() => run(() => api.removeCalendarException(cal.id, e.id))}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="cal-new">
        <label>
          Add a calendar for
          <select value={newFor} onChange={(e) => setNewFor(e.target.value)}>
            <option value="">Choose…</option>
            {!hasFallback && <option value="__fallback">Everywhere without its own</option>}
            {spoken.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={busy || !newFor}
          onClick={() =>
            run(async () => {
              await api.createCalendar(newFor === "__fallback" ? {} : { propertyId: newFor });
              setNewFor("");
            })
          }
        >
          Create
        </button>
        <span className="muted small">Starts as a six-day week with Sunday off. Change it below.</span>
      </div>
    </section>
  );
}
