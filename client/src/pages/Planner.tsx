import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useCurrentUser } from "../auth/AuthContext";
import { PRIORITY_SHORT_LABELS, type DayPlan, type Technician } from "../types";
import { addDays, formatDay, formatHours, relativeDay, todayStr } from "../lib/capacity";

function distance(metres: number): string {
  if (metres < 1000) return `${metres} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

/**
 * Proposes an order of work for one technician on one day: what's already pinned there,
 * then the most urgent open jobs, nearest first, until the day is full.
 */
export default function Planner() {
  const user = useCurrentUser();
  const isAdmin = user?.role === "admin";
  const [params, setParams] = useSearchParams();
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const day = params.get("day") || todayStr();
  const technicianId = params.get("tech") || user?.technicianId || technicians[0]?.id || "";

  useEffect(() => {
    api
      .listTechnicians()
      .then((list) => setTechnicians(list.filter((t) => t.active)))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!technicianId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .getDayPlan({ technicianId, day })
      .then((p) => {
        setPlan(p);
        setChosen(new Set(p.stops.map((s) => s.issue.id)));
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [technicianId, day]);

  useEffect(load, [load]);

  const technician = technicians.find((t) => t.id === technicianId);
  const chosenStops = useMemo(() => (plan ? plan.stops.filter((s) => chosen.has(s.issue.id)) : []), [plan, chosen]);
  const chosenHours = chosenStops.reduce((sum, s) => sum + s.hours, 0);
  const travel = chosenStops.reduce((sum, s) => sum + s.travelMetres, 0);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
    setNotice(null);
  }

  function toggle(id: string) {
    setChosen((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply() {
    if (chosenStops.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      const r = await api.applyDayPlan({ technicianId, day, issueIds: chosenStops.map((s) => s.issue.id) });
      setNotice(`${r.applied} job${r.applied === 1 ? "" : "s"} scheduled for ${formatDay(day)}${technician ? ` and assigned to ${technician.name}` : ""}.`);
      setPlan(r.plan);
      setChosen(new Set(r.plan.stops.map((s) => s.issue.id)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  }

  if (!user) return null;
  if (!isAdmin && !user.technicianId) {
    return (
      <div className="page">
        <h1>Plan a day</h1>
        <p className="empty-state">Your login isn't linked to a technician, so there's no day to plan.</p>
      </div>
    );
  }

  const capacity = plan?.capacityHours ?? 0;
  const over = chosenHours > capacity;

  return (
    <div className="page planner">
      <div className="page-header">
        <div>
          <h1>Plan a day</h1>
          <p className="muted">
            Overdue and due-today work comes first, then the nearest job to where they already are, until the day is full. Nothing changes until you apply it.
          </p>
        </div>
        <div className="planner-controls">
          {isAdmin && technicians.length > 0 && (
            <label>
              Technician
              <select value={technicianId} onChange={(e) => setParam("tech", e.target.value)}>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Day
            <input type="date" value={day} onChange={(e) => setParam("day", e.target.value)} />
          </label>
          <div className="planner-jump">
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setParam("day", todayStr())}>
              Today
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setParam("day", addDays(todayStr(), 1))}>
              Tomorrow
            </button>
          </div>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {notice && <div className="banner banner-info">{notice}</div>}

      {loading ? (
        <p className="loading-state">Building the plan…</p>
      ) : !plan ? (
        <p className="empty-state">Add a technician first.</p>
      ) : (
        <>
          <div className="planner-summary card">
            <div>
              <span className="myday-stat-label">{relativeDay(day)}</span>
              <strong>
                {formatHours(chosenHours)} <span className="muted">of {formatHours(capacity)}</span>
              </strong>
              <span className="muted small">
                {chosenStops.length} job{chosenStops.length === 1 ? "" : "s"} selected
                {travel > 0 ? ` · ${distance(travel)} between stops` : ""}
              </span>
            </div>
            <div className="load-bar" aria-hidden="true">
              <span className={over ? "over" : ""} style={{ width: `${capacity ? Math.min(100, (chosenHours / capacity) * 100) : chosenHours ? 100 : 0}%` }} />
            </div>
            <button type="button" className="btn btn-primary" disabled={applying || chosenStops.length === 0} onClick={apply}>
              {applying ? "Applying…" : `Schedule ${chosenStops.length || ""} job${chosenStops.length === 1 ? "" : "s"} for this day`}
            </button>
            {over && <span className="banner banner-warn">That's more than the {formatHours(capacity)} available — untick something, or go ahead knowing it will overrun.</span>}
          </div>

          {plan.stops.length === 0 ? (
            <p className="empty-state">Nothing to plan: no open work is due in the next two weeks for this technician.</p>
          ) : (
            <ol className="planner-list">
              {plan.stops.map((stop, idx) => {
                const picked = chosen.has(stop.issue.id);
                return (
                  <li key={stop.issue.id} className={`card planner-stop ${picked ? "" : "dropped"}`}>
                    <span className="planner-order">{idx + 1}</span>
                    <input type="checkbox" checked={picked} onChange={() => toggle(stop.issue.id)} aria-label={`Include ${stop.issue.title}`} />
                    <div className="planner-stop-main">
                      <Link to={`/properties/${stop.issue.propertyId}?issue=${stop.issue.id}`} className="planner-stop-title">
                        {stop.issue.title}
                      </Link>
                      <span className="muted small">
                        {stop.issue.property.name} · {stop.reason}
                        {stop.travelMetres > 0 ? ` · ${distance(stop.travelMetres)} from the last stop` : ""}
                      </span>
                    </div>
                    <span className={`tag tag-${stop.issue.priority}`}>{PRIORITY_SHORT_LABELS[stop.issue.priority]}</span>
                    <span className="planner-hours">
                      {formatHours(stop.hours)}
                      {stop.assumedHours && <span className="muted small"> est.</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {plan.leftOver.length > 0 && (
            <section className="planner-left">
              <h2>
                Didn't fit <span className="count">{plan.leftOver.length}</span>
              </h2>
              <ul className="planner-list">
                {plan.leftOver.map((item) => (
                  <li key={item.issue.id} className="card planner-stop dropped">
                    <span className="planner-order">—</span>
                    <span />
                    <div className="planner-stop-main">
                      <Link to={`/properties/${item.issue.propertyId}?issue=${item.issue.id}`} className="planner-stop-title">
                        {item.issue.title}
                      </Link>
                      <span className="muted small">
                        {item.issue.property.name} · {item.reason}
                      </span>
                    </div>
                    <span className={`tag tag-${item.issue.priority}`}>{PRIORITY_SHORT_LABELS[item.issue.priority]}</span>
                    <span className="planner-hours">{formatHours(item.hours)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
