import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { TIME_OFF_LABELS, type Technician, type TimeOff, type TimeOffKind } from "../types";
import { addDays, formatDay, todayStr } from "../lib/capacity";

const KINDS: TimeOffKind[] = ["vacation", "sick", "training", "other"];

/**
 * Vacation and other time off. Booking someone off stops the scheduler from putting
 * work on them that day, and the rota shows it, so a holiday is planned once rather
 * than remembered by whoever happens to be on the desk.
 */
export default function TimeOffPanel({ technicians }: { technicians: Technician[] }) {
  const [entries, setEntries] = useState<TimeOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  const [technicianId, setTechnicianId] = useState("");
  const [startDay, setStartDay] = useState(todayStr());
  const [endDay, setEndDay] = useState(todayStr());
  const [kind, setKind] = useState<TimeOffKind>("vacation");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    // A year back covers "who was off when" without dragging in everything ever booked.
    api
      .listTimeOff({ from: addDays(todayStr(), -365) })
      .then(setEntries)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!technicianId) return setError("Pick who is away.");
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { clashingJobs } = await api.createTimeOff({ technicianId, startDay, endDay, kind, note: note.trim() || undefined });
      setNote("");
      if (clashingJobs > 0) {
        setNotice(
          `Booked. ${clashingJobs} job${clashingJobs === 1 ? " is" : "s are"} already scheduled for them in that period — move ${
            clashingJobs === 1 ? "it" : "them"
          } on the day scheduler.`
        );
      }
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(entry: TimeOff) {
    if (!confirm(`Remove ${entry.technician.name}'s time off?`)) return;
    try {
      await api.deleteTimeOff(entry.id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const today = todayStr();
  const visible = entries.filter((e) => showPast || e.endDay >= today);

  return (
    <section className="card timeoff">
      <div className="timeoff-head">
        <div>
          <h2>Time off</h2>
          <p className="muted">
            Vacation, sick leave and training. Anyone booked off can't have work dragged onto them for those days.
          </p>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
          Show past
        </label>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {notice && <div className="banner banner-warn">{notice}</div>}

      <form className="form timeoff-form" onSubmit={submit}>
        <div className="form-row">
          <label>
            Who
            <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} required>
              <option value="">Pick a team member</option>
              {technicians
                .filter((t) => t.active)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.trade ? ` — ${t.trade}` : ""}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as TimeOffKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {TIME_OFF_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            From
            <input
              type="date"
              value={startDay}
              onChange={(e) => {
                setStartDay(e.target.value);
                if (e.target.value > endDay) setEndDay(e.target.value);
              }}
              required
            />
          </label>
          <label>
            To
            <input type="date" value={endDay} min={startDay} onChange={(e) => setEndDay(e.target.value)} required />
          </label>
        </div>
        <label>
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Cover arranged with Sam" />
        </label>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-small" disabled={saving}>
            {saving ? "Booking…" : "Book time off"}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="muted">Nobody is booked off{showPast ? "" : " from today onwards"}.</p>
      ) : (
        <ul className="timeoff-list">
          {visible.map((entry) => {
            const current = entry.startDay <= today && entry.endDay >= today;
            return (
              <li key={entry.id} className={`timeoff-row ${current ? "is-now" : ""} ${entry.endDay < today ? "is-past" : ""}`}>
                <span className="crew-dot" style={{ background: entry.technician.color }} aria-hidden="true" />
                <span className="timeoff-who">
                  <strong>{entry.technician.name}</strong>
                  <span className="muted small">{TIME_OFF_LABELS[entry.kind]}</span>
                </span>
                <span className="timeoff-when">
                  {formatDay(entry.startDay)}
                  {entry.endDay !== entry.startDay ? ` → ${formatDay(entry.endDay)}` : ""}
                  {current && <span className="timeoff-now">away now</span>}
                </span>
                {entry.note && <span className="muted small timeoff-note">{entry.note}</span>}
                <button type="button" className="btn btn-ghost btn-small danger" onClick={() => remove(entry)} aria-label="Remove">
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
