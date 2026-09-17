import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { PRIORITY_SHORT_LABELS, WEEKDAYS, categoryShort, type Rota as RotaData } from "../types";
import { addDays, formatDay, formatHours, todayStr } from "../lib/capacity";

function mondayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return addDays(day, -((date.getUTCDay() + 6) % 7));
}

/** The week's rota for every technician: shift times and the work booked into them. */
export default function Rota() {
  const [params, setParams] = useSearchParams();
  const week = params.get("week") || mondayOf(todayStr());
  const [data, setData] = useState<RotaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showJobs, setShowJobs] = useState(true);

  useEffect(() => {
    api
      .getRota(week)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [week]);

  function goto(day: string) {
    setParams({ week: mondayOf(day) }, { replace: true });
  }

  const today = todayStr();

  return (
    <div className="page rota">
      <div className="page-header no-print">
        <div>
          <h1>Week schedule</h1>
          <p className="muted">Everyone's shifts for the week, with the jobs already booked into them. Print it for the crew room.</p>
        </div>
        <div className="rota-controls">
          <button type="button" className="btn btn-ghost btn-small" onClick={() => goto(addDays(week, -7))}>
            ← Previous
          </button>
          <input type="date" value={week} onChange={(e) => e.target.value && goto(e.target.value)} aria-label="Week beginning" />
          <button type="button" className="btn btn-ghost btn-small" onClick={() => goto(addDays(week, 7))}>
            Next →
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => goto(todayStr())}>
            This week
          </button>
        </div>
      </div>

      <div className="rota-actions no-print">
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Print / save as PDF
        </button>
        <label className="checkbox-row">
          <input type="checkbox" checked={showJobs} onChange={(e) => setShowJobs(e.target.checked)} />
          Show booked jobs
        </label>
        <Link to="/technicians" className="btn btn-ghost btn-small">
          Back to technicians
        </Link>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {!data ? (
        <p className="loading-state">Loading…</p>
      ) : data.technicians.length === 0 ? (
        <p className="empty-state">No active technicians yet.</p>
      ) : (
        <article className="rota-sheet">
          <header className="rota-header">
            <div>
              <span className="report-kicker">Week schedule</span>
              <h2>
                {formatDay(data.weekStart, "long")} — {formatDay(data.days[6], "long")}
              </h2>
            </div>
            <div className="report-meta">
              <div>
                <dt>Technicians</dt>
                <dd>{data.technicians.length}</dd>
              </div>
              <div>
                <dt>Printed</dt>
                <dd>{new Date(data.generatedAt).toLocaleDateString()}</dd>
              </div>
            </div>
          </header>

          <table className={`rota-table ${showJobs ? "" : "compact"}`}>
            <thead>
              <tr>
                <th>Technician</th>
                {data.days.map((day, i) => (
                  <th key={day} className={day === today ? "is-today" : ""}>
                    {WEEKDAYS[i]}
                    <span>{formatDay(day).replace(/^\w+,?\s*/, "")}</span>
                  </th>
                ))}
                <th>Week</th>
              </tr>
            </thead>
            <tbody>
              {data.technicians.map((tech) => (
                <tr key={tech.id}>
                  <th scope="row">
                    <span className="rota-name">
                      <span className="rota-dot" style={{ background: tech.color }} />
                      {tech.name}
                    </span>
                    {tech.trade && <span className="muted small">{tech.trade}</span>}
                    {tech.categories.length > 0 && <span className="muted small">{tech.categories.map(categoryShort).join(", ")}</span>}
                  </th>
                  {tech.days.map((d) => (
                    <td key={d.day} className={`${d.shift ? "" : "is-off"} ${d.day === today ? "is-today" : ""}`}>
                      {d.shift ? (
                        <>
                          <span className="rota-shift">
                            {d.shift.start}–{d.shift.end}
                          </span>
                          <span className="rota-load">
                            {formatHours(d.bookedHours)} of {formatHours(d.hours)}
                          </span>
                          {showJobs && d.jobs.length > 0 && (
                            <ul className="rota-jobs">
                              {d.jobs.map((job) => (
                                <li key={job.id}>
                                  <span className={`tag tag-${job.priority}`}>{PRIORITY_SHORT_LABELS[job.priority]}</span>
                                  <span>
                                    {job.title}
                                    {job.roomName ? ` · ${job.roomName}` : ""}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </>
                      ) : (
                        <span className="rota-off">Off</span>
                      )}
                    </td>
                  ))}
                  <td className="rota-total">{formatHours(tech.weekHours)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <footer className="report-footer">
            <span>Week schedule</span>
            <span>MaintenanceMap · {new Date(data.generatedAt).toLocaleDateString()}</span>
          </footer>
        </article>
      )}
    </div>
  );
}
