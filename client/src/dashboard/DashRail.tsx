import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { PRIORITY_SHORT_LABELS, STATUS_LABELS, categoryShort, type DashboardIssue } from "../types";
import { relativeDay, todayStr } from "../lib/capacity";
import { activeIssueIds, applyFilters, isOverdue, openIssues } from "./derive";
import { useDashboard } from "./useDashboardData";
import { useBoardFilters } from "./DepartureBoard";

/** How many cards are on screen, and how long before the list moves on. */
const CARDS = 4;
const DWELL_MS = 12000;

interface RailFocus {
  current: DashboardIssue | null;
  cards: DashboardIssue[];
  /** Restarts the fill animation on the leading card. */
  cycle: number;
}

const RailContext = createContext<RailFocus>({ current: null, cards: [], cycle: 0 });

export function useRailFocus(): RailFocus {
  return useContext(RailContext);
}

/**
 * Owns the rotation through open issues so the rail and the live map stay on the same
 * one: whatever is at the top of the rail is what the map has flown to.
 */
export function RailProvider({ children }: { children: ReactNode }) {
  const { data } = useDashboard();
  const [filters] = useBoardFilters();
  const issues = useMemo(() => (data ? applyFilters(openIssues(data), filters) : []), [data, filters]);
  const [index, setIndex] = useState(0);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (issues.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % issues.length);
      setCycle((c) => c + 1);
    }, DWELL_MS);
    return () => clearInterval(timer);
  }, [issues.length]);

  useEffect(() => {
    if (index >= issues.length) setIndex(0);
  }, [issues.length, index]);

  const value = useMemo<RailFocus>(() => {
    const cards = issues.length ? Array.from({ length: Math.min(CARDS, issues.length) }, (_, k) => issues[(index + k) % issues.length]) : [];
    return { current: cards[0] ?? null, cards, cycle };
  }, [issues, index, cycle]);

  return <RailContext.Provider value={value}>{children}</RailContext.Provider>;
}

function Card({ issue, lead, cycle, active, today }: { issue: DashboardIssue; lead: boolean; cycle: number; active: boolean; today: string }) {
  const overdue = isOverdue(issue, today);
  return (
    <article className={`rail-card pri-${issue.priority} ${lead ? "lead" : ""} ${overdue ? "is-overdue" : ""}`}>
      {lead && <span className="rail-card-progress" key={cycle} style={{ animationDuration: `${DWELL_MS}ms` }} />}
      <header className="rail-card-top">
        <span className={`dash-tag dash-tag-${issue.priority}`}>{PRIORITY_SHORT_LABELS[issue.priority].toUpperCase()}</span>
        {issue.category && <span className="rail-cat">{categoryShort(issue.category).toUpperCase()}</span>}
        <span className={`rail-due ${overdue ? "overdue" : ""}`}>
          {issue.dueDate ? (overdue ? "OVERDUE" : relativeDay(issue.dueDate, today).toUpperCase()) : "NO DUE DATE"}
        </span>
      </header>

      <h3 className="rail-title">{issue.title}</h3>

      <p className="rail-where">
        {issue.property.name}
        {issue.roomName ? ` · ${issue.roomName}` : ""}
      </p>

      {issue.tags && issue.tags.length > 0 && (
        <div className="rail-tags">
          {issue.tags.slice(0, lead ? 5 : 3).map((t) => (
            <span key={t.tagId} className="rail-tag" style={{ background: t.tag.color }}>
              {t.tag.name}
            </span>
          ))}
        </div>
      )}

      {lead && issue.description && <p className="rail-desc">{issue.description}</p>}
      {lead && !issue.description && issue.actionNeeded && <p className="rail-desc">{issue.actionNeeded}</p>}

      <footer className="rail-card-bottom">
        <span className={`rail-tech ${issue.technician ? "" : "unassigned"}`}>
          {issue.technician ? issue.technician.name : "UNASSIGNED"}
          {active ? " · ON THE JOB" : ""}
        </span>
        <span className="rail-status">{STATUS_LABELS[issue.status].toUpperCase()}</span>
      </footer>

      {lead && issue.photos[0] && <img className="rail-photo" src={api.photoThumbUrl(issue.photos[0].id)} alt="" />}
    </article>
  );
}

/** The column of issue cards down the right of every dashboard view. */
export default function DashRail() {
  const { data } = useDashboard();
  const { cards, cycle } = useRailFocus();
  const today = todayStr();
  const active = useMemo(() => (data ? activeIssueIds(data) : new Set<string>()), [data]);

  return (
    <aside className="dash-rail" aria-label="Open issues">
      {cards.length === 0 ? (
        <div className="rail-empty">
          <strong>All clear</strong>
          <span>No open issues.</span>
        </div>
      ) : (
        cards.map((issue, i) => <Card key={issue.id} issue={issue} lead={i === 0} cycle={cycle} active={active.has(issue.id)} today={today} />)
      )}
    </aside>
  );
}
