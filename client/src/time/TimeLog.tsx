import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Issue, TimeEntry } from "../types";
import { formatDate } from "../lib/dates";
import { formatHours } from "../lib/capacity";
import { TIMER_EVENT, entryMs, formatClock, formatTime, useOpenEntry, useTicker } from "./useTimer";

interface Props {
  issue: Issue;
  /** Technician linked to the signed-in login, if any. */
  currentTechnicianId?: string | null;
  canManage: boolean;
  /** Called after a clock in/out/removal so the parent can refetch the issue (status, actual hours). */
  onChanged?: (what: "in" | "out" | "delete") => void;
}

/** Clock in/out controls and the list of time entries for one issue. */
export default function TimeLog({ issue, currentTechnicianId, canManage, onChanged }: Props) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { entry: running, clockIn, clockOut } = useOpenEntry();
  const now = useTicker(1000);

  const load = useCallback(() => {
    api
      .listTimeEntries({ issueId: issue.id })
      .then(setEntries)
      .catch((e) => setError(e.message));
  }, [issue.id]);

  useEffect(() => {
    load();
    window.addEventListener(TIMER_EVENT, load);
    return () => window.removeEventListener(TIMER_EVENT, load);
  }, [load]);

  const mine = !!currentTechnicianId && (issue.technicianId === currentTechnicianId || !issue.technicianId);
  const runningHere = running?.issueId === issue.id;
  const canClock = mine && issue.status !== "completed";
  const totalMs = entries.reduce((sum, e) => sum + entryMs(e, now), 0);

  async function act(what: "in" | "out" | "delete", fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
      onChanged?.(what);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!canClock && entries.length === 0) return null;

  return (
    <div className="timelog">
      <div className="timelog-head">
        <span className="field-label">Time on this job</span>
        <span className="timelog-total">{entries.length ? formatClock(totalMs) : "none yet"}</span>
      </div>
      {canClock && (
        <div className="timelog-actions">
          {runningHere ? (
            <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => act("out", () => clockOut())}>
              ■ Clock out · {formatClock(entryMs(running!, now))}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => act("in", () => clockIn(issue.id))}>
              ▶ Clock in
            </button>
          )}
          {running && !runningHere && (
            <span className="muted small">
              You're clocked in on “{running.issue.title}” — clocking in here will clock you out of that.
            </span>
          )}
        </div>
      )}
      {error && <div className="banner banner-error">{error}</div>}
      {entries.length > 0 && (
        <ul className="timelog-list">
          {entries.map((e) => (
            <li key={e.id} className={e.endedAt ? "" : "running"}>
              <span className="timelog-who" style={{ background: e.technician.color }} title={e.technician.name}>
                {e.technician.name
                  .split(/\s+/)
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
              <span className="timelog-when">
                {formatDate(e.startedAt)} · {formatTime(e.startedAt)}
                {e.endedAt ? ` – ${formatTime(e.endedAt)}` : " – now"}
                {e.note && <span className="timelog-note">{e.note}</span>}
              </span>
              <span className="timelog-dur">{formatClock(entryMs(e, now))}</span>
              {canManage && e.endedAt && (
                <button
                  type="button"
                  className="btn-icon"
                  aria-label="Remove this entry"
                  title="Remove this entry"
                  onClick={() => {
                    if (confirm("Remove this time entry? The issue's actual hours will be recalculated.")) act("delete", () => api.deleteTimeEntry(e.id));
                  }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {issue.actualHours != null && issue.status === "completed" && (
        <p className="muted small">Recorded actual hours: {formatHours(issue.actualHours)}</p>
      )}
    </div>
  );
}
