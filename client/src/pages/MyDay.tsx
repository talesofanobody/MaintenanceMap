import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useCurrentUser } from "../auth/AuthContext";
import { useDashboardPolling } from "../dashboard/useDashboardData";
import { sortIssues } from "../dashboard/derive";
import { addDays, capacityOn, formatDay, formatHours, relativeDay, slaProgress, todayStr } from "../lib/capacity";
import { useSettings } from "../settings/SettingsContext";
import { PRIORITY_SHORT_LABELS, STATUS_LABELS, type DashboardIssue, type TimeEntry } from "../types";
import { entryMs, formatClock, useOpenEntry, useTicker, TIMER_EVENT } from "../time/useTimer";

type Bucket = "overdue" | "today" | "week" | "later";

const BUCKET_TITLES: Record<Bucket, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "Later this week",
  later: "Further out",
};

function bucketOf(issue: DashboardIssue, today: string): Bucket {
  const due = issue.dueDate;
  const start = issue.scheduledFor;
  if ((due && due < today) || (start && start < today && !due)) return "overdue";
  if (due === today || start === today || (start && start < today)) return "today";
  const weekEnd = addDays(today, 6);
  if ((due && due <= weekEnd) || (start && start <= weekEnd)) return "week";
  return "later";
}

function dueText(issue: DashboardIssue, today: string): string {
  const bits: string[] = [];
  if (issue.scheduledFor) bits.push(`starts ${relativeDay(issue.scheduledFor, today).toLowerCase()}`);
  if (issue.dueDate) bits.push(`due ${relativeDay(issue.dueDate, today).toLowerCase()}`);
  return bits.join(" · ") || "no dates";
}

export default function MyDay() {
  const user = useCurrentUser();
  const isAdmin = user?.role === "admin";
  const [params, setParams] = useSearchParams();
  const state = useDashboardPolling(30000);
  const today = todayStr();
  const now = useTicker(1000);
  const { warnAtPercent } = useSettings();

  const technicians = useMemo(() => (state.data?.technicians ?? []).filter((t) => t.active), [state.data]);
  const technicianId = isAdmin ? params.get("tech") || user?.technicianId || technicians[0]?.id || "" : user?.technicianId ?? "";
  const technician = technicians.find((t) => t.id === technicianId) ?? state.data?.technicians.find((t) => t.id === technicianId);

  const { entry: running, clockIn, clockOut } = useOpenEntry(isAdmin ? technicianId || undefined : undefined);
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!technicianId) return;
    const load = () => api.listTimeEntries({ technicianId, day: today }).then(setTodayEntries).catch(() => {});
    load();
    window.addEventListener(TIMER_EVENT, load);
    const t = setInterval(load, 60000);
    return () => {
      window.removeEventListener(TIMER_EVENT, load);
      clearInterval(t);
    };
  }, [technicianId, today]);

  const mine = useMemo(
    () => (state.data?.issues ?? []).filter((i) => i.technicianId === technicianId && i.status !== "completed").sort(sortIssues),
    [state.data, technicianId]
  );
  const doneToday = useMemo(
    () => (state.data?.issues ?? []).filter((i) => i.technicianId === technicianId && i.status === "completed" && i.closedAt && i.closedAt.slice(0, 10) === today),
    [state.data, technicianId, today]
  );
  const buckets = useMemo(() => {
    const out: Record<Bucket, DashboardIssue[]> = { overdue: [], today: [], week: [], later: [] };
    for (const issue of mine) out[bucketOf(issue, today)].push(issue);
    return out;
  }, [mine, today]);

  const capacity = technician ? capacityOn(technician.weeklyHours, today) : 0;
  const planned = [...buckets.overdue, ...buckets.today].reduce((s, i) => s + (i.estimatedHours ?? 0), 0);
  const loggedMs = todayEntries.reduce((s, e) => s + entryMs(e, now), 0);
  const loggedHours = loggedMs / 3_600_000;

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      state.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (!user) return null;

  if (!technicianId) {
    return (
      <div className="page">
        <h1>Today</h1>
        <p className="empty-state">
          {isAdmin ? "Add a technician first — this page shows one person's day." : "Your login isn't linked to a technician, so there's no day sheet to show."}
        </p>
      </div>
    );
  }

  return (
    <div className="page myday">
      <div className="page-header">
        <div>
          <h1>{isAdmin && technician ? `${technician.name}'s day` : "My day"}</h1>
          <p className="muted">{formatDay(today, "long")}</p>
        </div>
        {isAdmin && technicians.length > 1 && (
          <label className="myday-picker">
            Technician
            <select value={technicianId} onChange={(e) => setParams({ tech: e.target.value }, { replace: true })}>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {state.error && !state.data && <div className="banner banner-error">{state.error}</div>}

      <div className="myday-stats">
        <div className="card myday-stat">
          <span className="myday-stat-label">Planned today</span>
          <strong>{formatHours(planned)}</strong>
          <span className="muted small">of {formatHours(capacity)} available</span>
          <div className="load-bar" aria-hidden="true">
            <span className={planned > capacity ? "over" : ""} style={{ width: `${capacity ? Math.min(100, (planned / capacity) * 100) : planned ? 100 : 0}%` }} />
          </div>
        </div>
        <div className="card myday-stat">
          <span className="myday-stat-label">Logged today</span>
          <strong>{formatClock(loggedMs)}</strong>
          <span className="muted small">{todayEntries.length} clock-in{todayEntries.length === 1 ? "" : "s"}</span>
          <div className="load-bar" aria-hidden="true">
            <span style={{ width: `${capacity ? Math.min(100, (loggedHours / capacity) * 100) : 0}%` }} />
          </div>
        </div>
        <div className={`card myday-stat myday-now ${running ? "on" : ""}`}>
          <span className="myday-stat-label">{running ? "On the job" : "Not clocked in"}</span>
          {running ? (
            <>
              <strong>{formatClock(entryMs(running, now))}</strong>
              <Link to={`/properties/${running.issue.propertyId}?issue=${running.issueId}`} className="myday-now-title">
                {running.issue.title}
              </Link>
              <button type="button" className="btn btn-secondary btn-small" disabled={busy !== null} onClick={() => act("out", () => clockOut())}>
                ■ Clock out
              </button>
            </>
          ) : (
            <>
              <strong>—</strong>
              <span className="muted small">Pick a job below and clock in.</span>
            </>
          )}
        </div>
      </div>

      {mine.length === 0 && doneToday.length === 0 && state.data && (
        <p className="empty-state">Nothing assigned to {isAdmin ? technician?.name ?? "this technician" : "you"} right now.</p>
      )}

      {(["overdue", "today", "week", "later"] as Bucket[]).map((b) =>
        buckets[b].length === 0 ? null : (
          <section key={b} className={`myday-section myday-${b}`}>
            <h2>
              {BUCKET_TITLES[b]} <span className="count">{buckets[b].length}</span>
            </h2>
            <ul className="myday-list">
              {buckets[b].map((issue) => {
                const here = running?.issueId === issue.id;
                const atRisk = slaProgress(issue, today, warnAtPercent).state === "warning";
                return (
                  <li key={issue.id} className={`card myday-row ${here ? "running" : ""}`}>
                    <span className={`tag tag-${issue.priority}`}>{PRIORITY_SHORT_LABELS[issue.priority]}</span>
                    <div className="myday-row-main">
                      <Link to={`/properties/${issue.propertyId}?issue=${issue.id}`} className="myday-row-title">
                        {issue.title}
                      </Link>
                      <span className="muted small">
                        {atRisk && <span className="risk-flag">At risk</span>}
                        {issue.property.name} · {dueText(issue, today)}
                        {issue.checklist && issue.checklist.length > 0 ? ` · ☑ ${issue.checklist.filter((c) => c.done).length}/${issue.checklist.length}` : ""}
                        {issue.estimatedHours != null ? ` · est. ${formatHours(issue.estimatedHours)}` : ""}
                        {issue.actualHours ? ` · logged ${formatHours(issue.actualHours)}` : ""}
                      </span>
                    </div>
                    <span className={`pill pill-status-${issue.status}`}>{here ? "On the job" : STATUS_LABELS[issue.status]}</span>
                    <div className="myday-row-actions">
                      {here ? (
                        <button type="button" className="btn btn-secondary btn-small" disabled={busy !== null} onClick={() => act(issue.id, () => clockOut())}>
                          ■ Clock out
                        </button>
                      ) : (
                        <button type="button" className="btn btn-primary btn-small" disabled={busy !== null} onClick={() => act(issue.id, () => clockIn(issue.id))}>
                          ▶ Clock in
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        disabled={busy !== null}
                        onClick={() =>
                          act(issue.id, async () => {
                            if (here) await clockOut();
                            await api.updateIssue(issue.id, { status: "completed" });
                          })
                        }
                      >
                        ✓ Done
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )
      )}

      {doneToday.length > 0 && (
        <section className="myday-section myday-done">
          <h2>
            Done today <span className="count">{doneToday.length}</span>
          </h2>
          <ul className="myday-list">
            {doneToday.map((issue) => (
              <li key={issue.id} className="card myday-row done">
                <span className={`tag tag-${issue.priority}`}>{PRIORITY_SHORT_LABELS[issue.priority]}</span>
                <div className="myday-row-main">
                  <Link to={`/properties/${issue.propertyId}?issue=${issue.id}`} className="myday-row-title">
                    {issue.title}
                  </Link>
                  <span className="muted small">
                    {issue.property.name}
                    {issue.actualHours ? ` · ${formatHours(issue.actualHours)} logged` : ""}
                  </span>
                </div>
                <span className="pill pill-status-completed">Completed</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
