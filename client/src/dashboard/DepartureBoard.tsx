import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { PRIORITY_LABELS, PRIORITY_SHORT_LABELS, categoryShort } from "../types";
import { formatHours, initials, todayStr } from "../lib/capacity";
import { activeIssueIds, buildBoard, dueCell, isOverdue, startCell, statusBoardLabel, type BoardFilters, type BoardSection, type GroupMode } from "./derive";
import { useDashboard } from "./useDashboardData";
import { useSettings } from "../settings/SettingsContext";

const SCROLL_STEP_MS = 60;

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

/**
 * Wall displays can hold more rows than fit. Rather than paging — which hides whole
 * priorities for ten seconds at a time — the board keeps every row in one ranked list and
 * creeps down it, pausing at each end.
 */
function useCreepScroll(dependency: unknown) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = 0;
    let direction = 1;
    let hold = 40;
    const timer = setInterval(() => {
      const slack = el.scrollHeight - el.clientHeight;
      if (slack <= 4) return;
      if (hold > 0) {
        hold -= 1;
        return;
      }
      el.scrollTop += direction;
      if (el.scrollTop >= slack - 1 || el.scrollTop <= 0) {
        direction *= -1;
        hold = 40;
      }
    }, SCROLL_STEP_MS);
    return () => clearInterval(timer);
  }, [dependency]);

  return ref;
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
  const settings = useSettings();
  const active = useMemo(() => activeIssueIds(data!), [data]);
  const today = todayStr();
  const [filters, setFilters] = useBoardFilters();
  const sections = useMemo(() => (data ? buildBoard(data, today, filters) : []), [data, today, filters]);
  const lines = useMemo(() => flatten(sections), [sections]);
  const bodyRef = useCreepScroll(`${filters.group}-${lines.length}`);

  if (!data) return null;

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

      <div className="board-body" ref={bodyRef} key={filters.group}>
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
          const due = dueCell(issue, today, settings.warnAtPercent);
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
                {issue.category && <span className="board-cat">{categoryShort(issue.category).toUpperCase()}</span>}
                {issue.workOrderNumber && <span className="board-wo">{issue.workOrderNumber}</span>}
              </span>
              <span className="board-col-loc">
                {issue.property.name.toUpperCase()}
                {issue.roomName && <span className="board-room">{issue.roomName.toUpperCase()}</span>}
              </span>
              <span className="board-col-pri">
                <span className={`dash-tag dash-tag-${issue.priority}`}>{PRIORITY_SHORT_LABELS[issue.priority].toUpperCase()}</span>
              </span>
              <span className={`board-col-status board-status-${active.has(issue.id) ? "active" : issue.status}`}>
                <span className="board-status-dot" />
                {statusBoardLabel(issue, active)}
              </span>
            </div>
          );
        })}
      </div>

    </div>
  );
}
