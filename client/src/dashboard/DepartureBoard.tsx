import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PRIORITY_LABELS, PRIORITY_SHORT_LABELS } from "../types";
import { formatHours, initials, todayStr } from "../lib/capacity";
import { buildBoard, dueCell, isOverdue, startCell, statusBoardLabel, type BoardFilters, type BoardSection, type GroupMode } from "./derive";
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

// Grouping and filters live in the URL (?group=technician&tech=…&property=…) so a
// TV can be pointed at exactly the board it should show.
export function useBoardFilters(): [BoardFilters, (next: Partial<BoardFilters>) => void] {
  const [params, setParams] = useSearchParams();
  const group: GroupMode = params.get("group") === "technician" ? "technician" : "priority";
  const filters: BoardFilters = {
    group,
    technicianId: params.get("tech") || undefined,
    propertyId: params.get("property") || undefined,
  };
  const update = (next: Partial<BoardFilters>) => {
    const merged = { ...filters, ...next };
    const p = new URLSearchParams(params);
    if (merged.group === "priority") p.delete("group");
    else p.set("group", merged.group);
    if (merged.technicianId) p.set("tech", merged.technicianId);
    else p.delete("tech");
    if (merged.propertyId) p.set("property", merged.propertyId);
    else p.delete("property");
    setParams(p, { replace: true });
  };
  return [filters, update];
}

export default function DepartureBoard({ showControls = true }: { showControls?: boolean }) {
  const { data } = useDashboard();
  const today = todayStr();
  const [filters, setFilters] = useBoardFilters();
  const sections = useMemo(() => (data ? buildBoard(data, today, filters) : []), [data, today, filters]);
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
  const overdueTotal = sections.reduce((n, s) => n + s.rows.filter((i) => isOverdue(i, today)).length, 0);

  return (
    <div className="board">
      {showControls && (
        <div className="board-controls">
          <label>
            Group by
            <select className="dash-select" value={filters.group} onChange={(e) => setFilters({ group: e.target.value as GroupMode })}>
              <option value="priority">Priority, then due date</option>
              <option value="technician">Technician</option>
            </select>
          </label>
          <label>
            Technician
            <select className="dash-select" value={filters.technicianId ?? ""} onChange={(e) => setFilters({ technicianId: e.target.value || undefined })}>
              <option value="">Everyone</option>
              {data.technicians
                .filter((t) => t.active)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              <option value="unassigned">Unassigned only</option>
            </select>
          </label>
          <label>
            Property
            <select className="dash-select" value={filters.propertyId ?? ""} onChange={(e) => setFilters({ propertyId: e.target.value || undefined })}>
              <option value="">All properties</option>
              {data.properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <span className="board-controls-summary">
            {totalRows} open{overdueTotal ? ` · ${overdueTotal} overdue` : ""}
          </span>
        </div>
      )}

      <div className="board-head">
        <span className="board-col-time">DUE</span>
        <span className="board-col-tech">TECH</span>
        <span className="board-col-issue">ISSUE</span>
        <span className="board-col-loc">LOCATION</span>
        <span className="board-col-pri">PRIORITY</span>
        <span className="board-col-status">STATUS</span>
      </div>

      {totalRows === 0 && (
        <div className="dash-empty">
          <h2>Nothing on the board</h2>
          <p>{filters.technicianId || filters.propertyId ? "No open issues match these filters." : "Log issues and assign them to see daily tasks here."}</p>
        </div>
      )}

      <div className="board-body" key={`${page}-${filters.group}`}>
        {lines.map((line, idx) => {
          if (line.kind === "section") {
            const s = line.section;
            const sectionOverdue = s.rows.filter((i) => isOverdue(i, today)).length;
            return (
              <div className={`board-section kind-${s.kind} ${s.priority ? `pri-${s.priority}` : ""}`} key={`s-${s.key}`} style={{ animationDelay: `${idx * 45}ms` }}>
                {s.kind === "technician" && s.technician ? (
                  <>
                    <span className="avatar" style={{ background: s.technician.color }}>
                      {initials(s.technician.name)}
                    </span>
                    <span className="board-section-name">{s.technician.name.toUpperCase()}</span>
                    {s.technician.trade && <span className="board-section-trade">{s.technician.trade.toUpperCase()}</span>}
                    {s.load && (
                      <span className={`board-section-load ${s.load.today.committed > s.load.today.capacity ? "over" : ""}`}>
                        {s.load.today.capacity === 0
                          ? "OFF TODAY"
                          : `TODAY ${formatHours(s.load.today.committed)} / ${formatHours(s.load.today.capacity)} · ${formatHours(s.load.today.free)} FREE`}
                        {sectionOverdue > 0 && ` · ${sectionOverdue} OVERDUE`}
                      </span>
                    )}
                  </>
                ) : s.kind === "priority" && s.priority ? (
                  <>
                    <span className={`board-priority-mark pri-${s.priority}`} />
                    <span className="board-section-name">{PRIORITY_LABELS[s.priority].toUpperCase()}</span>
                    <span className="board-section-trade">
                      {s.rows.length} OPEN{sectionOverdue ? ` · ${sectionOverdue} OVERDUE` : ""}
                    </span>
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
          const { issue } = line;
          const due = dueCell(issue, today);
          return (
            <div
              className={`board-row tone-${due.tone} priority-${issue.priority} status-${issue.status}`}
              key={issue.id}
              style={{ animationDelay: `${idx * 45}ms` }}
            >
              <span className="board-col-time">
                <span className="board-time">{due.label}</span>
                <span className="board-est">
                  {startCell(issue, today)}
                  {issue.estimatedHours != null && ` · ${formatHours(issue.estimatedHours)}`}
                </span>
              </span>
              <span className="board-col-tech" title={issue.technician?.name}>
                {issue.technician ? initials(issue.technician.name) : "—"}
              </span>
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
