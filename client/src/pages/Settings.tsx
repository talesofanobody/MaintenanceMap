import { FormEvent, useEffect, useState } from "react";
import { useSettings } from "../settings/SettingsContext";
import Backups from "../components/Backups";
import { PRIORITY_SHORT_LABELS, type AppSettings, type Priority } from "../types";

const ORDER: Priority[] = ["urgent", "high", "medium", "low"];

export default function Settings() {
  const ctx = useSettings();
  const [draft, setDraft] = useState<AppSettings>({ slaDays: { ...ctx.slaDays }, warnAtPercent: ctx.warnAtPercent, escalation: { ...ctx.escalation } });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Adopt the server values once they arrive (the provider starts with fallbacks).
  useEffect(() => {
    setDraft({ slaDays: { ...ctx.slaDays }, warnAtPercent: ctx.warnAtPercent, escalation: { ...ctx.escalation } });
  }, [ctx.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  function setSla(p: Priority, value: string) {
    setDraft((d) => ({ ...d, slaDays: { ...d.slaDays, [p]: value === "" ? ("" as unknown as number) : Number(value) } }));
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

  const dirty = JSON.stringify(draft) !== JSON.stringify({ slaDays: ctx.slaDays, warnAtPercent: ctx.warnAtPercent, escalation: ctx.escalation });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">Turnaround targets and what happens when work runs late. Changes apply to issues logged from now on and to the reminder checks.</p>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <form className="settings-form" onSubmit={handleSubmit}>
        <section className="card settings-section">
          <h2>Turnaround by priority</h2>
          <p>
            Days allowed to resolve an issue, counted from its start date (or the day it was logged). New issues get a due date from this automatically; it can
            still be changed per issue.
          </p>
          <div className="sla-grid">
            {ORDER.map((p) => (
              <label key={p}>
                <span className={`tag tag-${p}`}>{PRIORITY_SHORT_LABELS[p]}</span>
                <input
                  type="number"
                  min={0}
                  max={365}
                  step={1}
                  inputMode="numeric"
                  value={draft.slaDays[p]}
                  onChange={(e) => setSla(p, e.target.value)}
                  aria-label={`${PRIORITY_SHORT_LABELS[p]} turnaround in days`}
                  required
                />
                <span className="muted small">{Number(draft.slaDays[p]) === 0 ? "same day" : `${draft.slaDays[p]} day${Number(draft.slaDays[p]) === 1 ? "" : "s"}`}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="card settings-section">
          <h2>Running-out-of-time warning</h2>
          <p>Technicians get a reminder, and boards flag the issue as at risk, once this share of the turnaround has been used. Set to 0 to turn it off.</p>
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
            % of the turnaround
          </div>
        </section>

        <section className="card settings-section">
          <h2>Automatic escalation</h2>
          <p>
            Overdue issues climb one priority level after a set number of days, and again every time that many days pass — so a forgotten low-priority job
            works its way up the boards until someone deals with it. Each escalation is recorded in the activity log and notifies the technician and admins.
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
              max={90}
              step={1}
              inputMode="numeric"
              value={draft.escalation.afterOverdueDays}
              disabled={!draft.escalation.enabled}
              onChange={(e) =>
                setDraft((d) => ({ ...d, escalation: { ...d.escalation, afterOverdueDays: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) } }))
              }
              aria-label="Escalate after days overdue"
            />
            day{Number(draft.escalation.afterOverdueDays) === 1 ? "" : "s"} overdue
          </div>
        </section>

        <div className="settings-actions">
          <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setDraft({ slaDays: { ...ctx.defaults.slaDays }, warnAtPercent: ctx.defaults.warnAtPercent, escalation: { ...ctx.defaults.escalation } })}
          >
            Reset to defaults
          </button>
          {savedAt && !dirty && <span className="muted small">Saved.</span>}
        </div>
      </form>

      <div className="settings-form" style={{ marginTop: 20 }}>
        <Backups />
      </div>
    </div>
  );
}
