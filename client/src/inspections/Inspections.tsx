import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { formatDate, formatDateTime } from "../lib/dates";
import type { InspectionSummary, InspectionTemplate, Property } from "../types";

const TABS: { key: string; label: string }[] = [
  { key: "in_progress", label: "Under way" },
  { key: "completed", label: "Finished" },
  { key: "", label: "Everything" },
];

/**
 * The way into an inspection: what is part-done, what has been finished, and the
 * form that starts the next one. Deliberately thin — the walk itself and the
 * report are the two screens that matter.
 */
export default function Inspections() {
  const navigate = useNavigate();
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";

  const [tab, setTab] = useState("in_progress");
  const [inspections, setInspections] = useState<InspectionSummary[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [templates, setTemplates] = useState<InspectionTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Picking rooms for one combined report. Kept per-page rather than in the URL
  // so switching tabs to find the rest of a round does not lose the selection.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const [propertyId, setPropertyId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [roomName, setRoomName] = useState("");
  const [starting, setStarting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .listInspections(tab ? { status: tab } : {})
      .then((rows) => {
        setInspections(rows);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(load, [load]);

  useEffect(() => {
    api
      .listProperties()
      .then((rows) => {
        setProperties(rows);
        setPropertyId((current) => current || rows[0]?.id || "");
      })
      .catch(() => setProperties([]));
  }, []);

  // Templates can be scoped to one property, so the list follows the choice above it.
  useEffect(() => {
    if (!propertyId) return;
    api
      .listTemplates({ propertyId })
      .then((rows) => {
        setTemplates(rows);
        setTemplateId((current) => (rows.some((t) => t.id === current) ? current : rows[0]?.id ?? ""));
      })
      .catch(() => setTemplates([]));
  }, [propertyId]);

  const chosenTemplate = useMemo(() => templates.find((t) => t.id === templateId) ?? null, [templates, templateId]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!propertyId || !roomName.trim()) return;
    setStarting(true);
    try {
      const inspection = await api.startInspection({ propertyId, roomName: roomName.trim(), templateId: templateId || null });
      navigate(`/inspections/${inspection.id}`);
    } catch (err: any) {
      setError(err.message);
      setStarting(false);
    }
  }

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function remove(inspection: InspectionSummary) {
    if (!confirm(`Delete the inspection of ${inspection.roomName}? The report goes with it.`)) return;
    try {
      await api.deleteInspection(inspection.id);
      setInspections((prev) => prev.filter((i) => i.id !== inspection.id));
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="page insp-list-page">
      <div className="page-header">
        <div>
          <h1>Inspections</h1>
          <p className="muted">Walk a room against a checklist, photograph what is wrong, then turn the findings into work.</p>
        </div>
        <div className="page-header-actions">
          <Link to="/projects" className="btn btn-secondary btn-small">
            Projects
          </Link>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <section className="card insp-start">
        <h2>Start an inspection</h2>
        <form className="form insp-start-form" onSubmit={start}>
          <label>
            Property
            <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Room
            <input value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={120} placeholder="Room 214" required />
          </label>
          <label>
            Checklist
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.length === 0 && <option value="">No checklist — findings only</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.pointCount} points)
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-primary" disabled={starting || !propertyId || !roomName.trim()}>
            {starting ? "Starting…" : "Start"}
          </button>
        </form>
        {chosenTemplate?.description && <p className="muted small">{chosenTemplate.description}</p>}
      </section>

      <section className="card insp-round-picker">
        <h2>One report for every room</h2>
        <p className="muted small">
          Tick rooms below, or report on everything walked at a property between two dates. Nothing is generated until you ask —
          the findings sit on the server from the moment they are typed.
        </p>
        <div className="insp-round-controls">
          <label>
            From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <Link
            className="btn btn-secondary"
            to={`/inspections/report?propertyId=${propertyId}&from=${from}&to=${to}`}
            aria-disabled={!propertyId}
          >
            Report on {properties.find((p) => p.id === propertyId)?.name ?? "this property"}
          </Link>
          <Link className={`btn btn-primary ${picked.size ? "" : "is-disabled"}`} to={`/inspections/report?ids=${[...picked].join(",")}`}>
            Report on {picked.size || "the"} ticked room{picked.size === 1 ? "" : "s"}
          </Link>
          {picked.size > 0 && (
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setPicked(new Set())}>
              Clear
            </button>
          )}
        </div>
      </section>

      <div className="tab-row" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? "selected" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-state">Loading…</div>
      ) : inspections.length === 0 ? (
        <p className="empty-state">Nothing here yet.</p>
      ) : (
        <>
        <div className="insp-cards-head no-print">
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => setPicked((prev) => new Set([...prev, ...inspections.map((i) => i.id)]))}
          >
            Tick all {inspections.length} shown
          </button>
          {picked.size > 0 && <span className="muted small">{picked.size} ticked</span>}
        </div>
        <ul className="insp-cards">
          {inspections.map((i) => (
            <li key={i.id} className={`insp-card status-${i.status} ${picked.has(i.id) ? "is-picked" : ""}`}>
              <label className="insp-card-pick" title="Include this room in the combined report">
                <input type="checkbox" checked={picked.has(i.id)} onChange={() => togglePick(i.id)} aria-label={`Include ${i.roomName} in the report`} />
              </label>
              <div className="insp-card-main">
                <Link to={i.status === "in_progress" ? `/inspections/${i.id}` : `/inspections/${i.id}/report`} className="insp-card-title">
                  {i.roomName}
                </Link>
                <p className="muted small">
                  {i.property.name} · {i.templateName} · {i.inspector} · {formatDateTime(i.startedAt)}
                </p>
              </div>
              <div className="insp-card-counts">
                <span className={i.counts.flagged ? "is-flagged" : ""}>
                  <strong>{i.counts.flagged}</strong> flagged
                </span>
                <span>
                  <strong>{i.counts.raised}</strong> raised
                </span>
                <span className="muted">{i.counts.total} points</span>
              </div>
              <div className="insp-card-actions">
                {i.status === "in_progress" && (
                  <Link to={`/inspections/${i.id}`} className="btn btn-primary btn-small">
                    Carry on
                  </Link>
                )}
                <Link to={`/inspections/${i.id}/report`} className="btn btn-secondary btn-small">
                  Report
                </Link>
                {isAdmin && (
                  <button type="button" className="btn btn-ghost btn-small danger" onClick={() => remove(i)}>
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  );
}
