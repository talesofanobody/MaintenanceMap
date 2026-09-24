import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MapContainer, Marker, Polygon, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import { PRIORITIES, PRIORITY_SHORT_LABELS, STATUS_LABELS, type Priority, type Property, type Schedule, type ScheduleInput, type ScheduleUnit, type Technician } from "../types";
import { formatHours, relativeDay, todayStr, addDays } from "../lib/capacity";
import { geoJsonToLatLngs, boundsOf } from "../lib/geo";
import { draftDivIcon } from "../components/issueIcon";
import { SATELLITE_ATTRIBUTION, SATELLITE_URL } from "./PropertyWorkspace";

const UNITS: { value: ScheduleUnit; label: string }[] = [
  { value: "days", label: "days" },
  { value: "weeks", label: "weeks" },
  { value: "months", label: "months" },
];

function cadence(every: number, unit: ScheduleUnit): string {
  const one = unit === "days" ? "day" : unit === "weeks" ? "week" : "month";
  return every === 1 ? `Every ${one}` : `Every ${every} ${one}s`;
}

function centerOf(property: Property | undefined): [number, number] | null {
  if (!property) return null;
  if (property.centerLat != null && property.centerLng != null) return [property.centerLat, property.centerLng];
  if (property.boundary) {
    const ring = property.boundary.coordinates[0];
    const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    const lng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
    return [lat, lng];
  }
  return null;
}

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function FitOnce({ property, point }: { property: Property | undefined; point: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (property?.boundary) {
      map.fitBounds(boundsOf(geoJsonToLatLngs(property.boundary)), { padding: [16, 16] });
    } else if (point) {
      map.setView(point, 18);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property?.id]);
  return null;
}

interface FormState {
  propertyId: string;
  title: string;
  description: string;
  actionNeeded: string;
  priority: Priority;
  technicianId: string;
  estimatedHours: string;
  every: string;
  unit: ScheduleUnit;
  leadDays: string;
  nextDue: string;
  checklistText: string;
  lat: number | null;
  lng: number | null;
}

function emptyForm(propertyId: string): FormState {
  return {
    propertyId,
    title: "",
    description: "",
    actionNeeded: "",
    priority: "medium",
    technicianId: "",
    estimatedHours: "",
    every: "3",
    unit: "months",
    leadDays: "7",
    nextDue: addDays(todayStr(), 30),
    checklistText: "",
    lat: null,
    lng: null,
  };
}

function fromSchedule(s: Schedule): FormState {
  return {
    propertyId: s.propertyId,
    title: s.title,
    description: s.description ?? "",
    actionNeeded: s.actionNeeded ?? "",
    priority: s.priority,
    technicianId: s.technicianId ?? "",
    estimatedHours: s.estimatedHours != null ? String(s.estimatedHours) : "",
    every: String(s.every),
    unit: s.unit,
    leadDays: String(s.leadDays),
    nextDue: s.nextDue,
    checklistText: s.checklist.join("\n"),
    lat: s.lat,
    lng: s.lng,
  };
}

export default function Schedules() {
  const [params, setParams] = useSearchParams();
  const propertyFilter = params.get("property") ?? "";
  const [properties, setProperties] = useState<Property[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    api
      .listSchedules(propertyFilter || undefined)
      .then(setSchedules)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    api.listProperties().then(setProperties).catch(() => {});
    api.listTechnicians().then(setTechnicians).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyFilter]);

  const formProperty = useMemo(() => properties.find((p) => p.id === form?.propertyId), [properties, form?.propertyId]);
  const formCenter = centerOf(formProperty);
  const pin: [number, number] | null = form?.lat != null && form?.lng != null ? [form.lat, form.lng] : formCenter;

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm(propertyFilter || properties[0]?.id || ""));
    setNotice(null);
  }

  function startEdit(s: Schedule) {
    setEditingId(s.id);
    setForm(fromSchedule(s));
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    const point = form.lat != null && form.lng != null ? { lat: form.lat, lng: form.lng } : formCenter ? { lat: formCenter[0], lng: formCenter[1] } : {};
    const payload: ScheduleInput = {
      propertyId: form.propertyId,
      title: form.title.trim(),
      description: form.description.trim() || null,
      actionNeeded: form.actionNeeded.trim() || null,
      priority: form.priority,
      technicianId: form.technicianId || null,
      estimatedHours: form.estimatedHours === "" ? null : Number(form.estimatedHours),
      every: Number(form.every),
      unit: form.unit,
      leadDays: Number(form.leadDays),
      nextDue: form.nextDue,
      checklist: form.checklistText
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean),
      ...point,
    };
    try {
      if (editingId) await api.updateSchedule(editingId, payload);
      else await api.createSchedule(payload);
      setForm(null);
      setEditingId(null);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function runNow(s: Schedule) {
    if (!confirm(`Create the next "${s.title}" job now (due ${s.nextDue})?`)) return;
    try {
      const r = await api.runScheduleNow(s.id);
      setNotice(`Created "${r.issue.title}" — due ${r.issue.dueDate}. The schedule moved on to ${r.schedule?.nextDue}.`);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function togglePause(s: Schedule) {
    try {
      await api.updateSchedule(s.id, { active: !s.active });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function remove(s: Schedule) {
    if (!confirm(`Delete the recurring task "${s.title}"? Issues already created from it are kept.`)) return;
    try {
      await api.deleteSchedule(s.id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const today = todayStr();

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Recurring maintenance</h1>
          <p className="muted">Gutters, boiler services, alarm tests — set them once and a job appears on the boards ahead of every due date, with its checklist ready.</p>
        </div>
        <div className="form-actions" style={{ margin: 0 }}>
          <select value={propertyFilter} onChange={(e) => setParams(e.target.value ? { property: e.target.value } : {}, { replace: true })} aria-label="Filter by property">
            <option value="">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {!form && (
            <button type="button" className="btn btn-primary" onClick={startCreate} disabled={properties.length === 0}>
              + Add recurring task
            </button>
          )}
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {notice && <div className="banner banner-info">{notice}</div>}

      {form && (
        <form className="card schedule-form" onSubmit={handleSubmit}>
          <h3>{editingId ? "Edit recurring task" : "New recurring task"}</h3>
          <label>
            Property
            <select value={form.propertyId} onChange={(e) => setForm({ ...form, propertyId: e.target.value, lat: null, lng: null })} disabled={!!editingId} required>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Clear gutters, north side" required autoFocus />
          </label>
          <label>
            Priority
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_SHORT_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Team member
            <select value={form.technicianId} onChange={(e) => setForm({ ...form, technicianId: e.target.value })}>
              <option value="">Unassigned — admins are reminded</option>
              {technicians
                .filter((t) => t.active)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.trade ? ` · ${t.trade}` : ""}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Repeats
            <div className="cadence-row">
              <input type="number" min={1} max={365} value={form.every} onChange={(e) => setForm({ ...form, every: e.target.value })} aria-label="Repeat every" required />
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as ScheduleUnit })} aria-label="Repeat unit">
                {UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label>
            {editingId ? "Next due" : "First due"}
            <input type="date" value={form.nextDue} onChange={(e) => setForm({ ...form, nextDue: e.target.value })} required />
          </label>
          <label>
            Create the job this many days ahead
            <input type="number" min={0} max={365} value={form.leadDays} onChange={(e) => setForm({ ...form, leadDays: e.target.value })} aria-label="Lead days" required />
          </label>
          <label>
            Estimated hours <span className="muted">(optional)</span>
            <input type="number" min={0} step={0.25} value={form.estimatedHours} onChange={(e) => setForm({ ...form, estimatedHours: e.target.value })} placeholder="e.g. 2" />
          </label>
          <label className="span-2">
            Description <span className="muted">(optional)</span>
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What this task covers" />
          </label>
          <label className="span-2">
            What needs to be done <span className="muted">(optional)</span>
            <textarea rows={2} value={form.actionNeeded} onChange={(e) => setForm({ ...form, actionNeeded: e.target.value })} placeholder="Scope of work each time" />
          </label>
          <label className="span-2">
            Checklist <span className="muted">(one step per line — copied onto every job)</span>
            <textarea
              rows={4}
              value={form.checklistText}
              onChange={(e) => setForm({ ...form, checklistText: e.target.value })}
              placeholder={"Clear leaves and debris\nFlush downpipes\nCheck brackets and joints\nPhotograph before and after"}
            />
          </label>
          <div className="span-2">
            <span className="field-label">Location — tap the map to place the pin</span>
            {pin ? (
              <MapContainer center={pin} zoom={18} className="mini-map" scrollWheelZoom={false}>
                <TileLayer url={SATELLITE_URL} attribution={SATELLITE_ATTRIBUTION} maxZoom={21} maxNativeZoom={19} />
                {formProperty?.boundary && <Polygon positions={geoJsonToLatLngs(formProperty.boundary)} pathOptions={{ color: "#2563eb", weight: 2, fillOpacity: 0.05 }} />}
                <Marker
                  position={pin}
                  icon={draftDivIcon()}
                  draggable
                  eventHandlers={{
                    dragend: (e) => {
                      const ll = (e.target as L.Marker).getLatLng();
                      setForm((f) => (f ? { ...f, lat: ll.lat, lng: ll.lng } : f));
                    },
                  }}
                />
                <ClickToPlace onPick={(lat, lng) => setForm((f) => (f ? { ...f, lat, lng } : f))} />
                <FitOnce property={formProperty} point={pin} />
              </MapContainer>
            ) : (
              <p className="muted small">Draw this property's border (or search its address) on the map first so the pin has somewhere to go.</p>
            )}
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving || !pin}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Create recurring task"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setForm(null);
                setEditingId(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="loading-state">Loading…</p>
      ) : schedules.length === 0 ? (
        !form && (
          <p className="empty-state">
            {properties.length === 0 ? "Add a property first." : "No recurring tasks yet. Add one and it will create a job with its checklist ahead of each due date."}
          </p>
        )
      ) : (
        <div className="schedule-list">
          {schedules.map((s) => {
            const due = s.nextDue < today ? "overdue" : s.nextDue === today ? "today" : "";
            return (
              <div key={s.id} className={`card schedule-card ${s.active ? "" : "paused"}`}>
                <div className="schedule-card-top">
                  <div>
                    <h3>{s.title}</h3>
                    <span className="muted small">
                      <Link to={`/properties/${s.propertyId}`}>{s.property.name}</Link>
                    </span>
                  </div>
                  <div className="issue-card-badges">
                    <span className={`tag tag-${s.priority}`}>{PRIORITY_SHORT_LABELS[s.priority]}</span>
                    {!s.active && <span className="badge badge-warn">Paused</span>}
                  </div>
                </div>
                <div className="schedule-facts">
                  <span>{cadence(s.every, s.unit)}</span>
                  <span>
                    Next due <strong className={due ? "text-danger" : ""}>{relativeDay(s.nextDue)}</strong>
                  </span>
                  <span>Job created {s.leadDays === 0 ? "on the day" : `${s.leadDays} day${s.leadDays === 1 ? "" : "s"} ahead`}</span>
                  {s.technician ? <span>Assigned to {s.technician.name}</span> : <span>Unassigned</span>}
                  {s.estimatedHours != null && <span>Est. {formatHours(s.estimatedHours)}</span>}
                  {s.checklist.length > 0 && (
                    <span>
                      {s.checklist.length} checklist step{s.checklist.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                {s.issues.length > 0 && (
                  <div className="schedule-open">
                    Open now:{" "}
                    {s.issues.map((i, idx) => (
                      <span key={i.id}>
                        {idx > 0 && ", "}
                        <Link to={`/properties/${s.propertyId}?issue=${i.id}`}>
                          {i.title}
                          {i.dueDate ? ` (due ${relativeDay(i.dueDate).toLowerCase()})` : ""}
                        </Link>{" "}
                        <span className="muted small">{STATUS_LABELS[i.status]}</span>
                      </span>
                    ))}
                  </div>
                )}
                <div className="card-actions">
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => startEdit(s)}>
                    Edit
                  </button>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => runNow(s)} title="Create the next job right now">
                    Run now
                  </button>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => togglePause(s)}>
                    {s.active ? "Pause" : "Resume"}
                  </button>
                  <button type="button" className="btn btn-ghost btn-small btn-danger-text" onClick={() => remove(s)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
