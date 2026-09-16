import { useEffect, useMemo, useState } from "react";
import { PRIORITY_SHORT_LABELS } from "../types";
import { formatHours, initials, todayStr } from "../lib/capacity";
import { buildBoard, statusBoardLabel, timeCell, type BoardSection } from "./derive";
import { useDashboard } from "./useDashboardData";

const ROWS_PER_PAGE = 13;
const PAGE_MS = 10000;

type Line =
  | { kind: "section"; section: BoardSection }
  | { kind: "row"; section: BoardSection; issue: BoardSection["rows"][number] }
  | { kind: "empty"; section: BoardSection };

function flatten(sections: BoardSection[]): Line[] {
  const lines: Line[] = [];
  for (const section of sections) {
    lines.push({ kind: "section", section });
    if (section.rows.length === 0) lines.push({ kind: "empty", section });
    for (const issue of section.rows) lines.push({ kind: "row", section, issue });
  }
  return lines;
}

function paginate(lines: Line[]): Line[][] {
  const pages: Line[][] = [];
  let page: Line[] = [];
  for (const line of lines) {
    // Keep a section header with at least one of its rows.
    if (page.length >= ROWS_PER_PAGE || (line.kind === "section" && page.length >= ROWS_PER_PAGE - 1)) {
      pages.push(page);
      page = [];
    }
    page.push(line);
  }
  if (page.length) pages.push(page);
  return pages.length ? pages : [[]];
}

export default function DepartureBoard() {
  const { data } = useDashboard();
  const today = todayStr();
  const sections = useMemo(() => (data ? buildBoard(data, today) : []), [data, today]);
  const pages = useMemo(() => paginate(flatten(sections)), [sections]);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (pages.length <= 1) {
      setPage(0);
      return;
    }
    const timer = setInterval(() => setPage((p) => (p + 1) % pages.length), PAGE_MS);
    return () => clearInterval(timer);
  }, [pages.length]);

  useEffect(() => {
    if (page >= pages.length) setPage(0);
  }, [pages.length, page]);

  if (!data) return null;

  const lines = pages[page] ?? [];
  const totalRows = sections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <div className="board">
      <div className="board-head">
        <span className="board-col-time">TIME</span>
        <span className="board-col-tech">TECH</span>
        <span className="board-col-issue">ISSUE</span>
        <span className="board-col-loc">LOCATION</span>
        <span className="board-col-pri">PRIORITY</span>
        <span className="board-col-status">STATUS</span>
      </div>

      {totalRows === 0 && sections.length === 0 && (
        <div className="dash-empty">
          <h2>Nothing on the board</h2>
          <p>Add technicians and assign open issues to see daily tasks here.</p>
        </div>
      )}

      <div className="board-body" key={page}>
        {lines.map((line, idx) => {
          if (line.kind === "section") {
            const t = line.section.technician;
            const load = line.section.load;
            return (
              <div className="board-section" key={`s-${line.section.key}`} style={{ animationDelay: `${idx * 45}ms` }}>
                {t ? (
                  <>
                    <span className="avatar" style={{ background: t.color }}>
                      {initials(t.name)}
                    </span>
                    <span className="board-section-name">{t.name.toUpperCase()}</span>
                    {t.trade && <span className="board-section-trade">{t.trade.toUpperCase()}</span>}
                    {load && (
                      <span className={`board-section-load ${load.today.committed > load.today.capacity ? "over" : ""}`}>
                        {load.today.capacity === 0
                          ? "OFF TODAY"
                          : `TODAY ${formatHours(load.today.committed)} / ${formatHours(load.today.capacity)} · ${formatHours(load.today.free)} FREE`}
                        {load.overdueCount > 0 && ` · ${load.overdueCount} OVERDUE`}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="avatar avatar-empty">?</span>
                    <span className="board-section-name board-unassigned">UNASSIGNED — NEEDS A TECHNICIAN</span>
                  </>
                )}
              </div>
            );
          }
          if (line.kind === "empty") {
            return (
              <div className="board-row board-row-empty" key={`e-${line.section.key}`} style={{ animationDelay: `${idx * 45}ms` }}>
                <span className="board-col-time">—</span>
                <span className="board-col-tech" />
                <span className="board-col-issue">NO OPEN TASKS</span>
                <span className="board-col-loc" />
                <span className="board-col-pri" />
                <span className="board-col-status">AVAILABLE</span>
              </div>
            );
          }
          const { issue, section } = line;
          const time = timeCell(issue, today);
          return (
            <div
              className={`board-row tone-${time.tone} priority-${issue.priority} status-${issue.status}`}
              key={issue.id}
              style={{ animationDelay: `${idx * 45}ms` }}
            >
              <span className="board-col-time">
                <span className="board-time">{time.label}</span>
                {issue.estimatedHours != null && <span className="board-est">{formatHours(issue.estimatedHours)}</span>}
              </span>
              <span className="board-col-tech">{section.technician ? initials(section.technician.name) : "—"}</span>
              <span className="board-col-issue">
                {issue.title.toUpperCase()}
                {issue.workOrderNumber && <span className="board-wo">{issue.workOrderNumber}</span>}
              </span>
              <span className="board-col-loc">{issue.property.name.toUpperCase()}</span>
              <span className="board-col-pri">
                <span className={`dash-tag dash-tag-${issue.priority}`}>{PRIORITY_SHORT_LABELS[issue.priority].toUpperCase()}</span>
              </span>
              <span className={`board-col-status board-status-${issue.status}`}>
                <span className="board-status-dot" />
                {statusBoardLabel(issue)}
              </span>
            </div>
          );
        })}
      </div>

      {pages.length > 1 && (
        <div className="board-pager">
          {pages.map((_, i) => (
            <span key={i} className={i === page ? "on" : ""} />
          ))}
          <span className="board-pager-label">
            Page {page + 1} of {pages.length}
          </span>
        </div>
      )}
    </div>
  );
}
