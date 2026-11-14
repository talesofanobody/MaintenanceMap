import { useMemo, useRef } from "react";
import type { ProjectIssue, ScheduleAnalysis } from "../types";

const DAY = 86400000;
const toDay = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const todayDay = () => Math.floor(Date.now() / DAY);

const ROW = 30;
const HEADER = 38;
const LABEL_W = 230;

interface Row {
  issue: ProjectIssue;
  depth: number;
}

/**
 * The plan as bars on a timeline, with what depends on what drawn between them.
 *
 * Hand-built rather than taken from a charting library, which is a deliberate
 * choice and not laziness. The three things that make a Gantt worth looking at —
 * dependency arrows, the agreed plan ghosted behind the current one, and the
 * critical chain picked out — are the three things general-purpose chart libraries
 * either do badly or do not do. A bar on a date axis is not hard; those are.
 *
 * Scrolls horizontally rather than compressing: a round covering four months at
 * two pixels a day is a picture of nothing. The day width shrinks to a floor and
 * then the chart gets wider than the screen, which is the honest trade.
 */
export default function Gantt({
  rows,
  analysis,
  onPick,
}: {
  rows: Row[];
  analysis: ScheduleAnalysis;
  onPick?: (issueId: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  const model = useMemo(() => {
    // The tree's dates, not the typed ones: a phase spans its children. Anything
    // with a date at all, its own, its children's or its baseline's.
    const dated = rows.filter(
      (r) => r.issue.rolled?.start || r.issue.rolled?.end || r.issue.scheduledFor || r.issue.dueDate || r.issue.baselineStart || r.issue.baselineDue
    );
    if (!dated.length) return null;

    const days: number[] = [];
    for (const { issue } of dated) {
      for (const d of [issue.rolled?.start, issue.rolled?.end, issue.scheduledFor, issue.dueDate, issue.baselineStart, issue.baselineDue]) {
        if (d) days.push(toDay(d));
      }
    }
    // A day of margin either side so a bar never touches the edge.
    const first = Math.min(...days) - 1;
    const last = Math.max(...days) + 1;
    const span = last - first + 1;

    // Wide enough to read, narrow enough that a long round still fits on a
    // couple of screens rather than twenty.
    const perDay = span > 180 ? 4 : span > 90 ? 7 : span > 45 ? 12 : 20;

    const months: { label: string; x: number; w: number }[] = [];
    let cursor = 0;
    while (cursor < span) {
      const date = new Date((first + cursor) * DAY);
      const monthEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0) / DAY;
      const width = Math.min(monthEnd - (first + cursor) + 1, span - cursor);
      months.push({
        label: date.toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" }),
        x: cursor * perDay,
        w: width * perDay,
      });
      cursor += width;
    }

    return { rows: dated, first, span, perDay, months, width: span * perDay };
  }, [rows]);

  if (!model) {
    return <p className="muted small">Nothing on this project has dates yet, so there is no timeline to draw.</p>;
  }

  const { first, perDay, months, width } = model;
  const x = (iso: string) => (toDay(iso) - first) * perDay;
  const barFor = (start: string | null, end: string | null) => {
    const s = start ?? end;
    const e = end ?? start;
    if (!s || !e) return null;
    const left = x(s);
    // Inclusive: a one-day job is one day wide, not zero.
    return { left, width: Math.max(perDay, x(e) + perDay - left) };
  };

  const rowIndex = new Map(model.rows.map((r, i) => [r.issue.id, i]));
  // A row with children is an envelope around them, and is drawn as one. It is
  // excluded from the analysis for the same reason, so it has no float to show.
  const summaryIds = new Set(rows.map((r) => r.issue.parentId).filter((v): v is string => !!v));
  /** The dates to draw: the tree's where it has them, the typed ones otherwise. */
  const dates = (i: ProjectIssue) => ({
    start: i.rolled?.start ?? i.scheduledFor,
    end: i.rolled?.end ?? i.dueDate,
  });
  const chain = new Set(analysis.longestChain);
  const violated = new Set(analysis.violations.map((v) => v.id));
  const today = todayDay();
  const todayX = (today - first) * perDay;
  const showToday = today >= first && today <= first + model.span;

  // Dependency arrows, drawn only where both ends are on the chart.
  const arrows: { x1: number; y1: number; x2: number; y2: number; critical: boolean }[] = [];
  for (const { issue } of model.rows) {
    for (const link of issue.linksOut ?? []) {
      // Only the kinds that constrain dates are worth drawing as an arrow.
      if (link.kind !== "precedes" && link.kind !== "starts_after_start" && link.kind !== "finishes_after_finish") continue;
      const fromRow = rowIndex.get(issue.id);
      const toRow = rowIndex.get(link.toIssueId);
      if (fromRow === undefined || toRow === undefined) continue;
      const fd = dates(issue);
      const fromBar = barFor(fd.start, fd.end);
      const target = model.rows[toRow].issue;
      const td = dates(target);
      const toBar = barFor(td.start, td.end);
      if (!fromBar || !toBar) continue;
      arrows.push({
        x1: fromBar.left + fromBar.width,
        y1: fromRow * ROW + ROW / 2,
        x2: toBar.left,
        y2: toRow * ROW + ROW / 2,
        critical: chain.has(issue.id) && chain.has(link.toIssueId),
      });
    }
  }

  const height = model.rows.length * ROW;

  return (
    <div className="gantt">
      <div className="gantt-legend muted small">
        <span><i className="gantt-key gantt-key-bar" /> planned</span>
        <span><i className="gantt-key gantt-key-base" /> agreed</span>
        <span><i className="gantt-key gantt-key-chain" /> longest chain</span>
        <span><i className="gantt-key gantt-key-done" /> done</span>
        {analysis.violations.length > 0 && <span className="is-late">● cannot start as planned</span>}
      </div>

      <div className="gantt-frame">
        {/* Names stay put; the timeline scrolls under them. */}
        <div className="gantt-labels" style={{ width: LABEL_W, paddingTop: HEADER }}>
          {model.rows.map(({ issue, depth }) => (
            <button
              key={issue.id}
              type="button"
              className={`gantt-label ${issue.isMilestone ? "is-milestone" : ""} ${violated.has(issue.id) ? "is-violated" : ""}`}
              style={{ height: ROW, paddingLeft: 6 + depth * 12 }}
              onClick={() => onPick?.(issue.id)}
              title={issue.title}
            >
              {issue.isMilestone && <span className="gantt-dot">◆</span>}
              <span className="gantt-label-text">{issue.title}</span>
            </button>
          ))}
        </div>

        <div className="gantt-scroll" ref={scroller}>
          <div className="gantt-canvas" style={{ width, height: height + HEADER }}>
            <div className="gantt-months" style={{ height: HEADER }}>
              {months.map((m) => (
                <span key={m.label + m.x} className="gantt-month" style={{ left: m.x, width: m.w }}>
                  {m.w > 34 ? m.label : ""}
                </span>
              ))}
            </div>

            {showToday && (
              <div className="gantt-today" style={{ left: todayX, top: HEADER, height }} title="Today" />
            )}

            <svg className="gantt-arrows" style={{ top: HEADER, width, height }} aria-hidden="true">
              {arrows.map((a, i) => {
                // Out of the predecessor, across, then into the successor. A right
                // angle reads more clearly than a curve when several overlap.
                const midX = Math.max(a.x1 + 6, a.x2 - 10);
                return (
                  <polyline
                    key={i}
                    className={`gantt-arrow ${a.critical ? "is-chain" : ""}`}
                    points={`${a.x1},${a.y1} ${midX},${a.y1} ${midX},${a.y2} ${a.x2 - 1},${a.y2}`}
                    fill="none"
                  />
                );
              })}
            </svg>

            <div className="gantt-rows" style={{ top: HEADER, height }}>
              {model.rows.map(({ issue }, i) => {
                const d = dates(issue);
                const bar = barFor(d.start, d.end);
                const pct = issue.rolled?.percentComplete;
                const base = barFor(issue.baselineStart, issue.baselineDue);
                const moved =
                  issue.baselineDue && issue.dueDate && issue.baselineDue !== issue.dueDate;
                const slack = analysis.items[issue.id]?.floatDays;
                return (
                  <div key={issue.id} className="gantt-row" style={{ top: i * ROW, height: ROW }}>
                    {/* The agreed plan, behind. Only drawn where it differs. */}
                    {base && moved && (
                      <span className="gantt-base" style={{ left: base.left, width: base.width }} title="As agreed" />
                    )}
                    {bar &&
                      (issue.isMilestone ? (
                        <span
                          className={`gantt-ms ${chain.has(issue.id) ? "is-chain" : ""} ${issue.status === "completed" ? "is-done" : ""}`}
                          style={{ left: bar.left }}
                          title={`${issue.title} — ${d.end ?? d.start}`}
                        />
                      ) : (
                        <span
                          className={`gantt-bar status-${issue.status} ${summaryIds.has(issue.id) ? "is-summary" : ""} ${chain.has(issue.id) ? "is-chain" : ""} ${violated.has(issue.id) ? "is-violated" : ""}`}
                          style={{ left: bar.left, width: bar.width }}
                          title={
                            `${issue.title}\n${d.start ?? "?"} to ${d.end ?? "?"}` +
                            (pct !== null && pct !== undefined ? `\n${pct}% complete` : "") +
                            (slack !== undefined ? `\n${slack} day${slack === 1 ? "" : "s"} of slack` : "") +
                            (issue.blockers?.some((b) => !b.clearedAt) ? "\nBlocked" : "")
                          }
                        >
                          {/* Progress along the bar, where it has been reported.
                              A bar with no fill means nobody has said, which is
                              deliberately different from nothing done. */}
                          {pct !== null && pct !== undefined && pct > 0 && (
                            <i className="gantt-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                          )}
                          {issue.blockers?.some((b) => !b.clearedAt) && <i className="gantt-blocked" title="Blocked" />}
                        </span>
                      ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* The two things a chart cannot show by drawing them. */}
      {analysis.violations.length > 0 && (
        <ul className="gantt-notes">
          {analysis.violations.map((v) => {
            const issue = rows.find((r) => r.issue.id === v.id)?.issue;
            return (
              <li key={v.id} className="is-late">
                <strong>{issue?.title ?? "A job"}</strong> is planned for {v.plannedStart} but cannot start before{" "}
                {v.earliestStart} — {v.tooEarlyByDays} day{v.tooEarlyByDays === 1 ? "" : "s"} too early for what it follows.
              </li>
            );
          })}
        </ul>
      )}
      {analysis.unscheduled.length > 0 && (
        <p className="muted small">
          {analysis.unscheduled.length} item{analysis.unscheduled.length === 1 ? "" : "s"} with no dates, so not on the
          timeline.
        </p>
      )}
      {analysis.cyclic && (
        <p className="banner banner-error small">
          The dependencies on this project contain a loop, so no schedule can be worked out from them.
        </p>
      )}
    </div>
  );
}
