import { useMemo } from "react";
import { PRIORITY_SHORT_LABELS } from "../types";
import { formatDurationMs } from "../lib/dates";
import { formatHours, initials, loadSummary, relativeDay, todayStr } from "../lib/capacity";
import { averageResolveMs, completedRecently, isOverdue, openIssues, SEVERITY } from "./derive";
import { useDashboard } from "./useDashboardData";

export default function SummaryBoard() {
  const { data } = useDashboard();
  const today = todayStr();

  const view = useMemo(() => {
    if (!data) return null;
    const open = openIssues(data);
    const closed = completedRecently(data);
    const counts = {
      open: open.length,
      urgent: open.filter((i) => i.priority === "urgent").length,
      high: open.filter((i) => i.priority === "high").length,
      inProgress: open.filter((i) => i.status === "in_progress").length,
      unassigned: open.filter((i) => !i.technicianId).length,
      overdue: open.filter((i) => isOverdue(i, today)).length,
      closedWeek: closed.length,
      avgResolve: averageResolveMs(closed),
    };
    const techs = data.technicians
      .filter((t) => t.active)
      .map((t) => {
        const mine = open.filter((i) => i.technicianId === t.id);
        return { t, mine, load: loadSummary(t.weeklyHours, mine, today) };
      });
    const attention = open.filter((i) => i.priority === "urgent" || i.priority === "high" || isOverdue(i, today)).slice(0, 8);
    const properties = data.properties
      .map((p) => {
        const mine = open.filter((i) => i.propertyId === p.id);
        return { p, total: mine.length, byPriority: { urgent: 0, high: 0, medium: 0, low: 0, ...Object.fromEntries(Object.keys(SEVERITY).map((k) => [k, mine.filter((i) => i.priority === k).length])) } };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
    return { counts, techs, attention, properties };
  }, [data, today]);

  if (!data || !view) return null;
  const { counts, techs, attention, properties } = view;

  return (
    <div className="summary">
      <section className="summary-kpis">
        <div className="kpi">
          <span className="kpi-value">{counts.open}</span>
          <span className="kpi-label">Open issues</span>
        </div>
        <div className={`kpi kpi-urgent ${counts.urgent ? "hot" : ""}`}>
          <span className="kpi-value">{counts.urgent}</span>
          <span className="kpi-label">Urgent</span>
        </div>
        <div className="kpi kpi-high">
          <span className="kpi-value">{counts.high}</span>
          <span className="kpi-label">High</span>
        </div>
        <div className="kpi kpi-progress">
          <span className="kpi-value">{counts.inProgress}</span>
          <span className="kpi-label">In progress</span>
        </div>
        <div className={`kpi ${counts.overdue ? "hot" : ""}`}>
          <span className="kpi-value">{counts.overdue}</span>
          <span className="kpi-label">Overdue</span>
        </div>
        <div className={`kpi ${counts.unassigned ? "warn" : ""}`}>
          <span className="kpi-value">{counts.unassigned}</span>
          <span className="kpi-label">Unassigned</span>
        </div>
        <div className="kpi kpi-done">
          <span className="kpi-value">{counts.closedWeek}</span>
          <span className="kpi-label">Closed, last 7 days</span>
        </div>
        <div className="kpi">
          <span className="kpi-value kpi-value-sm">{counts.avgResolve !== null ? formatDurationMs(counts.avgResolve) : "—"}</span>
          <span className="kpi-label">Avg. time to resolve</span>
        </div>
      </section>

      <div className="summary-grid">
        <section className="summary-panel">
          <h2>Crew today</h2>
          {techs.length === 0 && <p className="dash-muted">No active team members.</p>}
          <ul className="crew-list">
            {techs.map(({ t, mine, load }) => {
              const pct = load.today.capacity ? Math.min(100, (load.today.committed / load.today.capacity) * 100) : 0;
              const over = load.today.committed > load.today.capacity;
              const active = (data.activeEntries ?? []).find((e) => e.technicianId === t.id);
              const onJob = active ? data.issues.find((i) => i.id === active.issueId) : undefined;
              return (
                <li key={t.id} className="crew-row">
                  <span className="avatar" style={{ background: t.color }}>
                    {initials(t.name)}
                  </span>
                  <div className="crew-main">
                    <div className="crew-line">
                      <strong>{t.name}</strong>
                      <span className="dash-muted">
                        {mine.length} open · {load.overdueCount ? `${load.overdueCount} overdue · ` : ""}
                        {load.today.capacity === 0 ? "off today" : over ? `overbooked by ${formatHours(load.today.committed - load.today.capacity)}` : `${formatHours(load.today.free)} free today`}
                      </span>
                    </div>
                    {onJob && <span className="crew-now">▶ On the job: {onJob.title}</span>}
                    <div className="crew-bar">
                      <span style={{ width: `${pct}%`, background: over ? "#f87171" : t.color }} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="summary-panel">
          <h2>Needs attention</h2>
          {attention.length === 0 && <p className="dash-muted">Nothing urgent, high-priority or overdue.</p>}
          <ul className="attention-list">
            {attention.map((i) => (
              <li key={i.id} className={isOverdue(i, today) ? "overdue" : ""}>
                <span className={`dash-tag dash-tag-${i.priority}`}>{PRIORITY_SHORT_LABELS[i.priority].toUpperCase()}</span>
                <span className="attention-title">{i.title}</span>
                <span className="dash-muted">
                  {i.property.name} · {i.technician ? i.technician.name : "Unassigned"}
                  {i.dueDate ? ` · ${isOverdue(i, today) ? "overdue, was due" : "due"} ${relativeDay(i.dueDate, today).toLowerCase()}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="summary-panel summary-properties">
          <h2>By property</h2>
          {properties.length === 0 && <p className="dash-muted">No properties yet.</p>}
          <ul className="property-list">
            {properties.map(({ p, total, byPriority }) => (
              <li key={p.id}>
                <span className="property-name">{p.name}</span>
                <span className="property-bar">
                  {(["urgent", "high", "medium", "low"] as const).map((k) => (
                    <span key={k} className={`seg seg-${k}`} style={{ flex: byPriority[k] || 0 }} title={`${byPriority[k]} ${k}`} />
                  ))}
                </span>
                <span className="property-count">{total}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
