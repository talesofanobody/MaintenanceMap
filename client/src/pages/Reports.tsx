import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { GroupedBars, LineChart, RankedBars } from "../components/Charts";
import { money } from "../components/CostPanel";
import { PRIORITY_LABELS, PRIORITY_SHORT_LABELS, type Portfolio, type Trends } from "../types";
import { relativeDay } from "../lib/capacity";

const PRIORITY_COLOUR: Record<string, string> = { urgent: "#dc2626", high: "#f97316", medium: "#eab308", low: "#16a34a" };

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function TrendsView({ months, onMonths }: { months: number; onMonths: (n: number) => void }) {
  const [data, setData] = useState<Trends | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getTrends(months)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [months]);

  const labels = useMemo(() => (data ? data.months.map((m) => monthLabel(m.month)) : []), [data]);

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!data) return <p className="loading-state">Loading…</p>;

  const totalLogged = data.months.reduce((s, m) => s + m.logged, 0);
  const totalClosed = data.months.reduce((s, m) => s + m.closed, 0);
  const totalSpend = data.months.reduce((s, m) => s + m.spend, 0);
  const resolved = data.months.filter((m) => m.avgResolveDays != null);
  const avgResolve = resolved.length ? resolved.reduce((s, m) => s + (m.avgResolveDays ?? 0), 0) / resolved.length : null;

  return (
    <>
      <div className="trend-range">
        <span className="muted small">Period</span>
        {[6, 12, 24].map((n) => (
          <button key={n} type="button" className={`chip ${months === n ? "selected" : ""}`} onClick={() => onMonths(n)}>
            {n} months
          </button>
        ))}
      </div>

      <div className="trend-stats">
        <div className="card myday-stat">
          <span className="myday-stat-label">Logged</span>
          <strong>{totalLogged}</strong>
          <span className="muted small">over {data.months.length} months</span>
        </div>
        <div className="card myday-stat">
          <span className="myday-stat-label">Closed</span>
          <strong>{totalClosed}</strong>
          <span className="muted small">{totalLogged > 0 ? `${Math.round((totalClosed / totalLogged) * 100)}% of what came in` : "nothing logged yet"}</span>
        </div>
        <div className="card myday-stat">
          <span className="myday-stat-label">Open now</span>
          <strong>{data.openTotal}</strong>
          <span className="muted small">{data.overdueTotal} overdue</span>
        </div>
        <div className="card myday-stat">
          <span className="myday-stat-label">Average to resolve</span>
          <strong>{avgResolve != null ? `${avgResolve.toFixed(1)}d` : "—"}</strong>
          <span className="muted small">{totalSpend > 0 ? `${money(totalSpend)} spent` : "no costs recorded"}</span>
        </div>
      </div>

      <GroupedBars
        title="Work in and out"
        subtitle="Issues logged against issues closed, by month"
        labels={labels}
        series={[
          { label: "Logged", colour: "#94a3b8", values: data.months.map((m) => m.logged) },
          { label: "Closed", colour: "#16a34a", values: data.months.map((m) => m.closed) },
        ]}
      />

      <LineChart
        title="Average days to resolve"
        subtitle="From the day an issue was logged to the day it was closed"
        labels={labels}
        values={data.months.map((m) => m.avgResolveDays)}
        formatValue={(n) => `${n}d`}
      />

      <GroupedBars title="Spend by month" subtitle="Recorded cost lines, by the date they were incurred" labels={labels} series={[{ label: "Spend", colour: "#2563eb", values: data.months.map((m) => m.spend) }]} formatValue={money} />

      <div className="chart-row">
        <RankedBars
          title="Open work by property"
          subtitle="Where the backlog is"
          rows={data.byProperty.slice(0, 8).map((p) => ({ label: p.name, value: p.open, note: p.overdue ? `· ${p.overdue} overdue` : undefined }))}
        />
        <RankedBars title="Spend by property" rows={data.byProperty.filter((p) => p.spend > 0).slice(0, 8).map((p) => ({ label: p.name, value: p.spend }))} formatValue={money} />
      </div>

      <div className="chart-row">
        <RankedBars
          title="Issues closed by team member"
          rows={data.byTechnician.map((t) => ({
            label: t.name,
            value: t.closed,
            colour: t.color,
            note: t.avgResolveDays != null ? `· ${t.avgResolveDays}d average` : undefined,
          }))}
        />
        <RankedBars title="Spend by contractor" rows={data.byContractor.map((c) => ({ label: c.name, value: c.spend }))} formatValue={money} />
      </div>

      <RankedBars
        title="Open issues by priority"
        rows={(["urgent", "high", "medium", "low"] as const).map((p) => ({ label: PRIORITY_LABELS[p], value: data.openByPriority[p] ?? 0, colour: PRIORITY_COLOUR[p] }))}
      />
    </>
  );
}

function PortfolioView() {
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getPortfolio()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!data) return <p className="loading-state">Loading…</p>;

  const totals = data.properties.reduce(
    (acc, p) => ({ open: acc.open + p.openTotal, overdue: acc.overdue + p.overdue, spend: acc.spend + p.spend, closed: acc.closed + p.closedTotal }),
    { open: 0, overdue: 0, spend: 0, closed: 0 }
  );

  return (
    <div className="portfolio">
      <div className="portfolio-actions no-print">
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Print / save as PDF
        </button>
        <a className="btn btn-secondary" href={api.exportIssuesUrl()} download>
          Export issues CSV
        </a>
        <a className="btn btn-ghost" href={api.exportCostsUrl()} download>
          Export costs CSV
        </a>
      </div>

      <article className="portfolio-sheet">
        <header className="portfolio-header">
          <div>
            <span className="report-kicker">Portfolio summary</span>
            <h2>{data.properties.length} properties</h2>
          </div>
          <div className="report-meta">
            <div>
              <dt>Generated</dt>
              <dd>{new Date(data.generatedAt).toLocaleString()}</dd>
            </div>
          </div>
        </header>

        <section className="report-stats">
          <div className="stat stat-total">
            <span className="stat-value">{totals.open}</span>
            <span className="stat-label">Open issues</span>
          </div>
          <div className="stat stat-urgent">
            <span className="stat-value">{totals.overdue}</span>
            <span className="stat-label">Overdue</span>
          </div>
          <div className="stat stat-low">
            <span className="stat-value">{totals.closed}</span>
            <span className="stat-label">Closed to date</span>
          </div>
          <div className="stat stat-spend">
            <span className="stat-value">{money(totals.spend)}</span>
            <span className="stat-label">Total cost</span>
          </div>
        </section>

        <table className="portfolio-table">
          <thead>
            <tr>
              <th>Property</th>
              <th>Open</th>
              <th>Urgent</th>
              <th>High</th>
              <th>Overdue</th>
              <th>Avg. days</th>
              <th>Cost</th>
              <th>Next scheduled</th>
            </tr>
          </thead>
          <tbody>
            {data.properties.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/properties/${p.id}`}>{p.name}</Link>
                  {p.address && <span className="muted small">{p.address}</span>}
                </td>
                <td>{p.openTotal}</td>
                <td className={p.byPriority.urgent ? "text-danger" : ""}>{p.byPriority.urgent}</td>
                <td>{p.byPriority.high}</td>
                <td className={p.overdue ? "text-danger" : ""}>{p.overdue}</td>
                <td>{p.avgResolveDays != null ? `${p.avgResolveDays}d` : "—"}</td>
                <td>{p.spend > 0 ? money(p.spend) : "—"}</td>
                <td>{p.nextScheduled ? `${p.nextScheduled.title} · ${relativeDay(p.nextScheduled.nextDue)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {data.properties.some((p) => p.attention.length > 0) && (
          <section className="portfolio-attention">
            <h3>Needs attention</h3>
            {data.properties
              .filter((p) => p.attention.length > 0)
              .map((p) => (
                <div key={p.id} className="portfolio-attention-block">
                  <h4>{p.name}</h4>
                  <ul>
                    {p.attention.map((issue) => (
                      <li key={issue.id}>
                        <span className={`tag tag-${issue.priority}`}>{PRIORITY_SHORT_LABELS[issue.priority]}</span>
                        <Link to={`/properties/${p.id}?issue=${issue.id}`}>{issue.title}</Link>
                        <span className="muted small">
                          {issue.dueDate ? `due ${relativeDay(issue.dueDate).toLowerCase()}` : "no due date"}
                          {issue.technician ? ` · ${issue.technician}` : " · unassigned"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </section>
        )}

        <footer className="report-footer">
          <span>Portfolio summary</span>
          <span>MaintenanceMap · {new Date(data.generatedAt).toLocaleDateString()}</span>
        </footer>
      </article>
    </div>
  );
}

/** Admin reporting: trends over time, and a printable portfolio summary. */
export default function Reports() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("view") === "portfolio" ? "portfolio" : "trends";
  const months = Number(params.get("months")) || 12;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  }

  return (
    <div className="page reports">
      <div className="page-header no-print">
        <div>
          <h1>Reports</h1>
          <p className="muted">How the work is going over time, and one page covering every property.</p>
        </div>
        <div className="tab-switch" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "trends"} className={`chip ${tab === "trends" ? "selected" : ""}`} onClick={() => setParam("view", "trends")}>
            Trends
          </button>
          <button type="button" role="tab" aria-selected={tab === "portfolio"} className={`chip ${tab === "portfolio" ? "selected" : ""}`} onClick={() => setParam("view", "portfolio")}>
            Portfolio
          </button>
        </div>
      </div>

      {tab === "trends" ? <TrendsView months={months} onMonths={(n) => setParam("months", String(n))} /> : <PortfolioView />}
    </div>
  );
}
