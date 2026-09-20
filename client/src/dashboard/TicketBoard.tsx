import { useMemo } from "react";
import { categoryShort, PRIORITY_SHORT_LABELS, type DashboardIssue, type Status } from "../types";
import { initials } from "../lib/capacity";
import { useClock, useDashboard } from "./useDashboardData";
import { useCreepScroll } from "./useCreepScroll";
import { SEVERITY } from "./derive";

/**
 * The lanes a job moves through, left to right. Waiting and blocked work sit at the
 * ends so the two columns that need someone to act are the ones nearest the edges.
 */
const LANES: { key: string; label: string; statuses: Status[] }[] = [
  { key: "waiting", label: "Waiting", statuses: ["pending"] },
  { key: "accepted", label: "Taken", statuses: ["accepted"] },
  { key: "working", label: "On the job", statuses: ["in_progress"] },
  { key: "blocked", label: "Held up", statuses: ["on_hold", "needs_parts"] },
];

/** How much trouble a ticket is in. Drives the colour and the flashing. */
type Heat = "late" | "critical" | "soon" | "ok";

/**
 * A ticket is judged two ways and takes the worse of them: the share of its window
 * that has gone, and the wall-clock time left. That way a two-hour emergency and a
 * thirty-day repaint both turn red when they genuinely need someone, rather than the
 * long job looking calm at hour 719.
 */
function heatOf(issue: DashboardIssue, now: number): { leftMs: number | null; heat: Heat } {
  if (!issue.dueAt) return { leftMs: null, heat: "ok" };
  const deadline = new Date(issue.dueAt).getTime();
  const leftMs = deadline - now;
  if (leftMs <= 0) return { leftMs, heat: "late" };

  const started = new Date(issue.createdAt).getTime();
  const total = Math.max(1, deadline - started);
  const usedFraction = 1 - leftMs / total;

  const byClock: Heat = leftMs < 30 * 60_000 ? "critical" : leftMs < 4 * 3600_000 ? "soon" : "ok";
  const byShare: Heat = usedFraction >= 0.9 ? "critical" : usedFraction >= 0.7 ? "soon" : "ok";
  const rank: Record<Heat, number> = { late: 0, critical: 1, soon: 2, ok: 3 };
  return { leftMs, heat: rank[byClock] <= rank[byShare] ? byClock : byShare };
}

/**
 * The big number. Under an hour it counts seconds, which is what makes a display like
 * this feel live; above that, hours and minutes. Overdue counts up with a minus.
 */
function countdown(leftMs: number | null): string {
  if (leftMs === null) return "—";
  const late = leftMs < 0;
  const ms = Math.abs(leftMs);
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let text: string;
  if (hours >= 48) text = `${Math.floor(hours / 24)}d`;
  else if (hours >= 1) text = `${hours}:${String(minutes).padStart(2, "0")}`;
  else text = `${minutes}:${String(seconds).padStart(2, "0")}`;
  return late ? `+${text}` : text;
}

function unitOf(leftMs: number | null): string {
  if (leftMs === null) return "no deadline";
  const hours = Math.abs(leftMs) / 3600_000;
  if (hours >= 48) return leftMs < 0 ? "days over" : "days left";
  if (hours >= 1) return leftMs < 0 ? "hrs over" : "hrs left";
  return leftMs < 0 ? "min over" : "min left";
}

function TicketCard({ issue, now }: { issue: DashboardIssue; now: number }) {
  // Worked out here, from the ticking clock, rather than taken from the memo that
  // holds the running order — otherwise the big number would freeze between re-sorts.
  const { leftMs, heat } = heatOf(issue, now);
  const crew = issue.assignees?.length ? issue.assignees : issue.technician ? [{ technician: issue.technician }] : [];
  return (
    <li className={`kds-card heat-${heat} ${issue.isEmergency ? "is-emergency" : ""}`}>
      <div className="kds-card-top">
        <span className="kds-clock">
          <strong>{countdown(leftMs)}</strong>
          <span>{unitOf(leftMs)}</span>
        </span>
        <span className={`kds-pri p-${issue.priority}`}>
          {issue.isEmergency && <span aria-hidden="true">⚡ </span>}
          {PRIORITY_SHORT_LABELS[issue.priority]}
        </span>
      </div>
      <p className="kds-title">{issue.title}</p>
      <p className="kds-where">
        {issue.roomName ? <strong>{issue.roomName}</strong> : null}
        {issue.roomName ? " · " : ""}
        {issue.property.name}
      </p>
      <div className="kds-foot">
        {issue.category && <span className="kds-cat">{categoryShort(issue.category)}</span>}
        <span className="kds-crew">
          {crew.length === 0 ? (
            <em>unassigned</em>
          ) : (
            crew.slice(0, 4).map((a: any, i: number) => (
              <span key={a.technician?.id ?? i} className="kds-face" style={{ background: a.technician?.color ?? "#64748b" }}>
                {initials(a.technician?.name ?? "?")}
              </span>
            ))
          )}
        </span>
      </div>
    </li>
  );
}

function Lane({ label, issues, now }: { label: string; issues: DashboardIssue[]; now: number }) {
  // Restart the creep whenever the queue changes shape, so a new arrival is seen.
  const listRef = useCreepScroll<HTMLUListElement>(`${label}-${issues.map((i) => i.id).join(",")}`, 55);
  const late = issues.filter((i) => heatOf(i, now).heat === "late").length;

  return (
    <section className={`kds-lane ${late > 0 ? "has-late" : ""}`}>
      <header className="kds-lane-head">
        <h2>{label}</h2>
        <span className="kds-count">{issues.length}</span>
        {late > 0 && <span className="kds-late-count">{late} over</span>}
      </header>
      <ul className="kds-cards" ref={listRef}>
        {issues.length === 0 ? (
          <li className="kds-clear">Clear</li>
        ) : (
          issues.map((issue) => <TicketCard key={issue.id} issue={issue} now={now} />)
        )}
      </ul>
    </section>
  );
}

/**
 * A kitchen-display board for maintenance: one card per open job, counting down to
 * when it should be finished, reddest and first when it is late. Cards leave the board
 * the moment the job is completed or cancelled.
 */
export default function TicketBoard() {
  const { data } = useDashboard();
  // Ticking every second is the whole point of a board like this.
  const clock = useClock(1000);
  const now = clock.getTime();

  // Re-sorting every second would make cards jump about under someone's eyes, so the
  // running order settles on a 15-second cadence. The countdowns themselves are worked
  // out per card from the live clock, so the numbers never stop moving.
  const orderTick = Math.floor(now / 15000);
  const lanes = useMemo(() => {
    const issues = data?.issues ?? [];
    return LANES.map((lane) => ({
      ...lane,
      issues: issues
        .filter((i) => (lane.statuses as string[]).includes(i.status))
        .map((issue) => ({ issue, ...heatOf(issue, orderTick * 15000) }))
        .sort(
          (a, b) =>
            // Late first, then whoever runs out soonest, then by priority, so the top
            // of every lane is the thing to deal with next.
            Number(b.heat === "late") - Number(a.heat === "late") ||
            (a.leftMs ?? Infinity) - (b.leftMs ?? Infinity) ||
            SEVERITY[a.issue.priority] - SEVERITY[b.issue.priority]
        )
        .map((t) => t.issue),
    }));
  }, [data?.issues, orderTick]);

  const all = lanes.flatMap((l) => l.issues);
  const heats = all.map((i) => heatOf(i, now).heat);
  const late = heats.filter((h) => h === "late").length;
  const critical = heats.filter((h) => h === "critical").length;

  if (all.length === 0) {
    return (
      <div className="kds kds-allclear">
        <div>
          <h2>All clear</h2>
          <p>Nothing open. Cards appear here the moment work is logged.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="kds">
      <div className="kds-summary">
        <span className={`kds-tally ${late > 0 ? "is-late" : ""}`}>
          <strong>{late}</strong> overdue
        </span>
        <span className={`kds-tally ${critical > 0 ? "is-critical" : ""}`}>
          <strong>{critical}</strong> running out
        </span>
        <span className="kds-tally">
          <strong>{all.length}</strong> open
        </span>
      </div>
      <div className="kds-lanes">
        {lanes.map((lane) => (
          <Lane key={lane.key} label={lane.label} issues={lane.issues} now={now} />
        ))}
      </div>
    </div>
  );
}

/** How long TV mode should rest on this board: longer when there is more to read. */
export function ticketBoardSeconds(openCount: number): number {
  return Math.min(75, 30 + Math.max(0, openCount - 8) * 2);
}
