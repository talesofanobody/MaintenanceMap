import { FormEvent, useEffect, useState } from "react";
import { useSettings } from "../settings/SettingsContext";
import Backups from "../components/Backups";
import TagAdmin from "../components/TagAdmin";
import { PRIORITY_DESCRIPTIONS, PRIORITY_SHORT_LABELS, type AppSettings, type Priority } from "../types";
import { describeWindow } from "../lib/capacity";

const ORDER: Priority[] = ["critical", "urgent", "high", "medium", "low"];

/**
 * Compares two settings by value. JSON.stringify would do it, except that it is
 * sensitive to key order, and the server returns the priorities in its own order —
 * which made a freshly saved form look like it still had unsaved changes.
 */
function sameSettings(a: AppSettings, b: AppSettings): boolean {
  if (Number(a.warnAtPercent) !== Number(b.warnAtPercent)) return false;
  if (!!a.escalation.enabled !== !!b.escalation.enabled) return false;
  if (Number(a.escalation.afterOverdueHours) !== Number(b.escalation.afterOverdueHours)) return false;
  return ORDER.every((p) => Number(a.responseHours[p]) === Number(b.responseHours[p]));
}

export default function Settings() {
  const ctx = useSettings();
  const [draft, setDraft] = useState<AppSettings>({ responseHours: { ...ctx.responseHours }, warnAtPercent: ctx.warnAtPercent, escalation: { ...ctx.escalation } });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Adopt the server values once they arrive (the provider starts with fallbacks).
  useEffect(() => {
    setDraft({ responseHours: { ...ctx.responseHours }, warnAtPercent: ctx.warnAtPercent, escalation: { ...ctx.escalation } });
  }, [ctx.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  function setWindow(p: Priority, value: string) {
    setDraft((d) => ({ ...d, responseHours: { ...d.responseHours, [p]: value === "" ? ("" as unknown as number) : Number(value) } }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await ctx.save(draft);
      setSavedAt(Date.now());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const dirty = !sameSettings(draft, { responseHours: ctx.responseHours, warnAtPercent: ctx.warnAtPercent, escalation: ctx.escalation });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">Response windows and what happens when work runs late. Changes apply to issues logged from now on and to the reminder checks.</p>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <form className="settings-form" onSubmit={handleSubmit}>
        <section className="card settings-section">
          <h2>Response window by priority</h2>
          <p>
            <strong>Hours</strong> to resolve an issue, counted from the moment it is logged. Anything under 24 hours is a
            stopwatch — a critical job logged at 16:00 with a two-hour window is late at 18:01, not tomorrow. Longer windows are
            counted in days from the start date, as before. Every new issue gets its deadline from this, and it can still be
            changed job by job.
          </p>
          <div className="sla-grid">
            {ORDER.map((p) => (
              <label key={p}>
                <span className={`tag tag-${p}`}>{PRIORITY_SHORT_LABELS[p]}</span>
                <input
                  type="number"
                  min={1}
                  max={8760}
                  step={1}
                  inputMode="numeric"
                  value={draft.responseHours[p]}
                  onChange={(e) => setWindow(p, e.target.value)}
                  aria-label={`${PRIORITY_SHORT_LABELS[p]} response window in hours`}
                  required
                />
                <span className="muted small">
                  {describeWindow(Number(draft.responseHours[p]))} · {PRIORITY_DESCRIPTIONS[p]}
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="card settings-section">
          <h2>Running-out-of-time warning</h2>
          <p>Team members get a reminder, and boards flag the issue as at risk, once this share of the response window has gone. Set to 0 to turn it off.</p>
          <div className="settings-row">
            Warn at
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              inputMode="numeric"
              value={draft.warnAtPercent}
              onChange={(e) => setDraft((d) => ({ ...d, warnAtPercent: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) }))}
              aria-label="Warn at percent of turnaround"
            />
            % of the window
          </div>
        </section>

        <section className="card settings-section">
          <h2>Automatic escalation</h2>
          <p>
            Overdue issues climb one priority level after a set number of hours, and again every time that many hours pass — so a forgotten low-priority job
            works its way up the boards until someone deals with it. Each escalation is recorded in the activity log and notifies the team member and admins.
          </p>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.escalation.enabled}
              onChange={(e) => setDraft((d) => ({ ...d, escalation: { ...d.escalation, enabled: e.target.checked } }))}
            />
            Escalate overdue issues automatically
          </label>
          <div className="settings-row" style={{ marginTop: 10 }}>
            Escalate after
            <input
              type="number"
              min={1}
              max={2160}
              step={1}
              inputMode="numeric"
              value={draft.escalation.afterOverdueHours}
              disabled={!draft.escalation.enabled}
              onChange={(e) =>
                setDraft((d) => ({ ...d, escalation: { ...d.escalation, afterOverdueHours: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) } }))
              }
              aria-label="Escalate after hours overdue"
            />
            hour{Number(draft.escalation.afterOverdueHours) === 1 ? "" : "s"} overdue ({describeWindow(Number(draft.escalation.afterOverdueHours))})
          </div>
        </section>

        <div className="settings-actions">
          <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setDraft({ responseHours: { ...ctx.defaults.responseHours }, warnAtPercent: ctx.defaults.warnAtPercent, escalation: { ...ctx.defaults.escalation } })}
          >
            Reset to defaults
          </button>
          {savedAt && !dirty && <span className="muted small">Saved.</span>}
        </div>
      </form>

      <div className="settings-form" style={{ marginTop: 20 }}>
        <TagAdmin />
        <Backups />
      </div>
    </div>
  );
}
