import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, TechnicianInput } from "../api";
import type { Technician } from "../types";
import { PRIORITY_SHORT_LABELS, WEEKDAYS } from "../types";
import { formatHours, initials, loadSummary, relativeDay, todayStr } from "../lib/capacity";

const SWATCHES = ["#2563eb", "#0891b2", "#16a34a", "#ca8a04", "#ea580c", "#dc2626", "#9333ea", "#db2777", "#475569"];
const DEFAULT_HOURS = [8, 8, 8, 8, 8, 0, 0];

interface FormState {
  name: string;
  trade: string;
  phone: string;
  color: string;
  weeklyHours: number[];
  notes: string;
  active: boolean;
}

function toForm(t?: Technician): FormState {
  return {
    name: t?.name ?? "",
    trade: t?.trade ?? "",
    phone: t?.phone ?? "",
    color: t?.color ?? SWATCHES[Math.floor(Math.random() * SWATCHES.length)],
    weeklyHours: t?.weeklyHours ?? DEFAULT_HOURS,
    notes: t?.notes ?? "",
    active: t?.active ?? true,
  };
}

function TechnicianForm({ initial, onCancel, onSaved }: { initial?: Technician; onCancel: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setHours(idx: number, value: string) {
    const n = value === "" ? 0 : Math.max(0, Math.min(24, Number(value)));
    setForm((f) => ({ ...f, weeklyHours: f.weeklyHours.map((h, i) => (i === idx ? n : h)) }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Give the technician a name.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload: TechnicianInput = {
      name: form.name.trim(),
      trade: form.trade.trim() || null,
      phone: form.phone.trim() || null,
      color: form.color,
      weeklyHours: form.weeklyHours,
      notes: form.notes.trim() || null,
      active: form.active,
    };
    try {
      if (initial) await api.updateTechnician(initial.id, payload);
      else await api.createTechnician(payload);
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const weekTotal = form.weeklyHours.reduce((a, b) => a + b, 0);

  return (
    <form className="card form technician-form" onSubmit={handleSubmit}>
      <h3>{initial ? `Edit ${initial.name}` : "New technician"}</h3>
      {error && <div className="banner banner-error">{error}</div>}
      <div className="form-row">
        <label>
          Name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sam Patel" autoFocus required />
        </label>
        <label>
          Trade <span className="muted">(optional)</span>
          <input value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} placeholder="Plumber, electrician, general…" />
        </label>
      </div>
      <div className="form-row">
        <label>
          Phone <span className="muted">(optional)</span>
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
        </label>
        <div className="field">
          <span className="field-label">Colour</span>
          <div className="swatches">
            {SWATCHES.map((c) => (
              <button
                type="button"
                key={c}
                className={`swatch ${form.color === c ? "selected" : ""}`}
                style={{ background: c }}
                onClick={() => setForm({ ...form, color: c })}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="field">
        <span className="field-label">
          Working hours per day <span className="muted">— {formatHours(weekTotal)} a week</span>
        </span>
        <div className="hours-grid">
          {WEEKDAYS.map((d, i) => (
            <label key={d} className="hours-cell">
              <span>{d}</span>
              <input type="number" min={0} max={24} step={0.5} value={form.weeklyHours[i]} onChange={(e) => setHours(i, e.target.value)} />
            </label>
          ))}
        </div>
        <div className="chip-group">
          <button type="button" className="chip" onClick={() => setForm({ ...form, weeklyHours: [8, 8, 8, 8, 8, 0, 0] })}>
            Mon–Fri, 8h
          </button>
          <button type="button" className="chip" onClick={() => setForm({ ...form, weeklyHours: [8, 8, 8, 8, 8, 4, 0] })}>
            Mon–Sat
          </button>
          <button type="button" className="chip" onClick={() => setForm({ ...form, weeklyHours: [4, 4, 4, 4, 4, 0, 0] })}>
            Part-time
          </button>
          <button type="button" className="chip" onClick={() => setForm({ ...form, weeklyHours: [0, 0, 0, 0, 0, 0, 0] })}>
            Clear
          </button>
        </div>
      </div>

      <label>
        Notes <span className="muted">(optional)</span>
        <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Certifications, areas covered, preferred days…" />
      </label>

      {initial && (
        <label className="checkbox-row">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Active (shown on boards and available for assignment)
        </label>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : initial ? "Save changes" : "Add technician"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function Technicians() {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const today = todayStr();

  function reload() {
    api
      .listTechnicians()
      .then(setTechnicians)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function remove(t: Technician) {
    if (!confirm(`Remove ${t.name}? Their ${t.assignments.length} open issue${t.assignments.length === 1 ? "" : "s"} will become unassigned.`)) return;
    await api.deleteTechnician(t.id);
    reload();
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Technicians</h1>
          <p className="muted">Set each person's working hours, then assign issues to them — free time is worked out from what's scheduled.</p>
        </div>
        <div className="page-header-actions">
          <a className="btn btn-secondary" href={api.exportTechniciansUrl()} download>
            Export CSV
          </a>
          {!adding && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              + Add technician
            </button>
          )}
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {adding && (
        <TechnicianForm
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      )}

      {loading ? (
        <p className="loading-state">Loading…</p>
      ) : technicians.length === 0 && !adding ? (
        <section className="welcome card">
          <h2>No technicians yet</h2>
          <p>Add the people who do the work. Each one gets weekly working hours; when you assign issues with an estimated duration, the app shows how much of their day is still free.</p>
          <button type="button" className="btn btn-primary btn-large" onClick={() => setAdding(true)}>
            Add the first technician
          </button>
        </section>
      ) : (
        <div className="tech-list">
          {technicians.map((t) => {
            const load = loadSummary(t.weeklyHours, t.assignments, today);
            const todayPct = load.today.capacity > 0 ? Math.min(100, (load.today.committed / load.today.capacity) * 100) : 0;
            const weekPct = load.week.capacity > 0 ? Math.min(100, (load.week.committed / load.week.capacity) * 100) : 0;
            const overbooked = load.today.committed > load.today.capacity;
            if (editingId === t.id) {
              return (
                <TechnicianForm
                  key={t.id}
                  initial={t}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => {
                    setEditingId(null);
                    reload();
                  }}
                />
              );
            }
            return (
              <article className={`card tech-card ${t.active ? "" : "inactive"}`} key={t.id}>
                <div className="tech-card-head">
                  <span className="avatar" style={{ background: t.color }}>
                    {initials(t.name)}
                  </span>
                  <div className="tech-card-title">
                    <h3>
                      {t.name}
                      {!t.active && <span className="badge badge-warn">Inactive</span>}
                    </h3>
                    <span className="muted">
                      {[t.trade, t.phone].filter(Boolean).join(" · ") || "No trade or phone set"}
                    </span>
                  </div>
                  <div className="card-actions">
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditingId(t.id)}>
                      Edit hours &amp; details
                    </button>
                    <button type="button" className="btn btn-ghost btn-small btn-danger-text" onClick={() => remove(t)}>
                      Remove
                    </button>
                  </div>
                </div>

                <div className="tech-load">
                  <div className="load-block">
                    <div className="load-label">
                      <span>Today · {relativeDay(today) === "Today" ? WEEKDAYS[(new Date().getDay() + 6) % 7] : today}</span>
                      <strong className={overbooked ? "text-danger" : ""}>
                        {load.today.capacity === 0 ? "Day off" : `${formatHours(load.today.free)} free`}
                      </strong>
                    </div>
                    <div className="load-bar">
                      <span style={{ width: `${todayPct}%`, background: overbooked ? "var(--danger)" : t.color }} />
                    </div>
                    <span className="muted small">
                      {formatHours(load.today.committed)} scheduled of {formatHours(load.today.capacity)}
                      {overbooked && " — overbooked"}
                    </span>
                  </div>
                  <div className="load-block">
                    <div className="load-label">
                      <span>This week</span>
                      <strong>{formatHours(load.week.free)} free</strong>
                    </div>
                    <div className="load-bar">
                      <span style={{ width: `${weekPct}%`, background: t.color }} />
                    </div>
                    <span className="muted small">
                      {formatHours(load.week.committed)} scheduled of {formatHours(load.week.capacity)}
                    </span>
                  </div>
                  <div className="load-block load-facts">
                    <span>
                      <strong>{t.assignments.length}</strong> open issue{t.assignments.length === 1 ? "" : "s"}
                    </span>
                    <span>
                      <strong>{formatHours(load.backlogHours)}</strong> unscheduled ({load.backlogCount})
                    </span>
                    <span className={load.overdueCount ? "text-danger" : ""}>
                      <strong>{load.overdueCount}</strong> overdue
                    </span>
                  </div>
                </div>

                <div className="week-strip" aria-label="Weekly hours">
                  {WEEKDAYS.map((d, i) => (
                    <span key={d} className={`week-day ${t.weeklyHours[i] ? "" : "off"}`}>
                      <em>{d}</em>
                      {t.weeklyHours[i] ? formatHours(t.weeklyHours[i]) : "—"}
                    </span>
                  ))}
                </div>

                {t.assignments.length > 0 && (
                  <ul className="assignment-list">
                    {[...t.assignments]
                      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || (a.scheduledFor ?? "9999").localeCompare(b.scheduledFor ?? "9999"))
                      .slice(0, 6)
                      .map((a) => (
                        <li key={a.id}>
                          <span className={`pill pill-${a.priority}`}>{PRIORITY_SHORT_LABELS[a.priority]}</span>
                          <Link to={`/properties/${a.propertyId}`}>{a.title}</Link>
                          <span className="muted small">
                            {a.scheduledFor ? `Start ${relativeDay(a.scheduledFor, today).toLowerCase()}` : "Unscheduled"}
                            {a.dueDate && (
                              <span className={a.dueDate < today ? "text-danger" : ""}>
                                {` · due ${relativeDay(a.dueDate, today).toLowerCase()}`}
                              </span>
                            )}
                            {a.estimatedHours ? ` · ${formatHours(a.estimatedHours)}` : ""}
                            {a.status === "in_progress" ? " · in progress" : ""}
                          </span>
                        </li>
                      ))}
                    {t.assignments.length > 6 && <li className="muted small">+{t.assignments.length - 6} more</li>}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
