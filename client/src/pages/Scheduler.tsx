import { DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { categoryLabel, PRIORITY_SHORT_LABELS, STATUS_SHORT_LABELS, TIME_OFF_LABELS, type DaySchedule, type ScheduledJob, type ScheduleRow } from "../types";
import { addDays, formatDay, timeLeftPhrase, todayStr } from "../lib/capacity";

/** What is being dragged, and where it came from, so a drop knows what to ask for. */
interface Dragging {
  issueId: string;
  fromTechnicianId: string | null;
}

function jobHours(job: ScheduledJob): string {
  return job.hours === 1 && job.estimatedHours == null ? "~1h" : `${job.hours}h`;
}

/** A card in a technician's column, or in the backlog. */
function JobCard({
  job,
  onDragStart,
  onDragEnd,
  draggable,
  onEmergency,
}: {
  job: ScheduledJob;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  draggable: boolean;
  onEmergency?: () => void;
}) {
  // Straight from the deadline: the card only needs "how long is left", not the whole
  // elapsed-fraction calculation the issue panel does.
  const hoursLeft = job.dueAt ? (new Date(job.dueAt).getTime() - Date.now()) / 3_600_000 : null;
  return (
    <li
      className={`sched-job p-${job.priority} ${job.isEmergency ? "is-emergency" : ""} ${job.shiftedBy ? "is-shifted" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="sched-job-head">
        <span className="sched-time">{job.plannedStart ? `${job.plannedStart}–${job.plannedEnd}` : "—"}</span>
        <span className={`sched-pri p-${job.priority}`}>{PRIORITY_SHORT_LABELS[job.priority]}</span>
      </div>
      <Link to={`/properties/${job.propertyId}?issue=${job.id}`} className="sched-title">
        {job.isEmergency && <span className="sched-flag" title="Emergency">⚡</span>}
        {job.title}
      </Link>
      <div className="sched-meta">
        {job.property}
        {job.roomName ? ` · ${job.roomName}` : ""}
        {job.category ? ` · ${categoryLabel(job.category)}` : ""}
      </div>
      <div className="sched-foot">
        <span>{jobHours(job)}</span>
        <span className={`sched-status s-${job.status}`}>{STATUS_SHORT_LABELS[job.status]}</span>
        {hoursLeft !== null && (
          <span className={`sched-left ${hoursLeft < 0 ? "is-late" : hoursLeft < 4 ? "is-close" : ""}`}>{timeLeftPhrase(hoursLeft)}</span>
        )}
        {job.shiftedBy && <span className="sched-pushed" title="Pushed back by an emergency">pushed</span>}
        {onEmergency && (
          <button type="button" className="sched-emg" onClick={onEmergency} title="Slot this in as an emergency">
            ⚡
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * A day, technician by technician, that an admin can rearrange by dragging. Every drop
 * writes straight through, so what is on screen is what the crew will see on their
 * phones a moment later.
 */
export default function Scheduler() {
  const [day, setDay] = useState(todayStr());
  const [data, setData] = useState<DaySchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [tradeFilter, setTradeFilter] = useState("");
  const dragRef = useRef<Dragging | null>(null);
  dragRef.current = dragging;

  const load = useCallback(
    (quiet = false) => {
      if (!quiet) setLoading(true);
      api
        .getSchedule(day)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    },
    [day]
  );

  useEffect(() => load(), [load]);

  // Someone else may be moving work about; refresh quietly rather than going stale.
  useEffect(() => {
    const timer = setInterval(() => load(true), 45000);
    const onFocus = () => load(true);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const trades = useMemo(() => [...new Set((data?.technicians ?? []).map((t) => t.trade).filter(Boolean))].sort() as string[], [data]);
  const rows = useMemo(
    () => (data?.technicians ?? []).filter((t) => !tradeFilter || t.trade === tradeFilter),
    [data, tradeFilter]
  );

  async function drop(technicianId: string | null, position: number | null) {
    const drag = dragRef.current;
    setDropTarget(null);
    setDragging(null);
    if (!drag) return;
    try {
      await api.scheduleAssign({ issueId: drag.issueId, technicianId, day: technicianId ? day : null, position });
      setNotice(null);
      load(true);
    } catch (e: any) {
      setError(e.message);
      load(true);
    }
  }

  async function makeEmergency(job: ScheduledJob, technicianId: string) {
    if (!confirm(`Slot "${job.title}" in as an emergency? Everything else in that day moves back one place until it's closed.`)) return;
    try {
      const r = await api.scheduleEmergency({ issueId: job.id, technicianId, day, position: 0 });
      setNotice(`Emergency slotted in — ${r.displaced} job${r.displaced === 1 ? "" : "s"} pushed back. Closing it puts the day back.`);
      load(true);
    } catch (e: any) {
      setError(e.message);
    }
  }

  function dragProps(job: ScheduledJob, fromTechnicianId: string | null) {
    return {
      draggable: true,
      onDragStart: (e: DragEvent) => {
        setDragging({ issueId: job.id, fromTechnicianId });
        e.dataTransfer.effectAllowed = "move";
        // Firefox refuses to start a drag without payload.
        e.dataTransfer.setData("text/plain", job.id);
      },
      onDragEnd: () => {
        setDragging(null);
        setDropTarget(null);
      },
    };
  }

  return (
    <div className="page sched-page">
      <div className="page-head sched-head">
        <div>
          <h1>Day scheduler</h1>
          <p className="muted">Drag a job onto whoever is doing it. Times are worked out from their shift and each job's estimate.</p>
        </div>
        <div className="sched-controls">
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">
            ←
          </button>
          <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Day" />
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setDay(addDays(day, 1))} aria-label="Next day">
            →
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setDay(todayStr())}>
            Today
          </button>
          {trades.length > 1 && (
            <select value={tradeFilter} onChange={(e) => setTradeFilter(e.target.value)} aria-label="Filter by trade">
              <option value="">All trades</option>
              {trades.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <p className="sched-day-label">{formatDay(day, "long")}</p>

      {error && <div className="banner banner-error">{error}</div>}
      {notice && <div className="banner banner-info">{notice}</div>}

      {loading && !data ? (
        <div className="loading-state">Loading…</div>
      ) : (
        <div className="sched-board">
          <section
            className={`sched-column sched-backlog ${dropTarget === "backlog" ? "is-over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget("backlog");
            }}
            onDragLeave={() => setDropTarget((t) => (t === "backlog" ? null : t))}
            onDrop={(e) => {
              e.preventDefault();
              drop(null, null);
            }}
          >
            <header className="sched-col-head">
              <strong>Unassigned</strong>
              <span className="muted small">{data?.unassigned.length ?? 0} waiting</span>
            </header>
            <ul className="sched-jobs">
              {(data?.unassigned ?? []).map((job) => (
                <JobCard key={job.id} job={job} {...(dragProps(job, null) as any)} />
              ))}
              {data && data.unassigned.length === 0 && <li className="sched-empty">Nothing waiting.</li>}
            </ul>
          </section>

          {rows.map((tech) => (
            <TechColumn
              key={tech.id}
              tech={tech}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              onDrop={drop}
              dragProps={dragProps}
              onEmergency={(job) => makeEmergency(job, tech.id)}
              dragging={dragging}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TechColumn({
  tech,
  dropTarget,
  setDropTarget,
  onDrop,
  dragProps,
  onEmergency,
  dragging,
}: {
  tech: ScheduleRow;
  dropTarget: string | null;
  setDropTarget: (v: string | null) => void;
  onDrop: (technicianId: string | null, position: number | null) => void;
  dragProps: (job: ScheduledJob, from: string | null) => Record<string, unknown>;
  onEmergency: (job: ScheduledJob) => void;
  dragging: Dragging | null;
}) {
  const away = !!tech.timeOff;
  const over = dropTarget === tech.id;
  const load = tech.capacityHours > 0 ? Math.min(1, tech.bookedHours / tech.capacityHours) : 0;
  const overbooked = tech.capacityHours > 0 && tech.bookedHours > tech.capacityHours;

  return (
    <section
      className={`sched-column ${over ? "is-over" : ""} ${away ? "is-away" : ""}`}
      onDragOver={(e) => {
        if (away) return;
        e.preventDefault();
        setDropTarget(tech.id);
      }}
      onDragLeave={() => setDropTarget(dropTarget === tech.id ? null : dropTarget)}
      onDrop={(e) => {
        e.preventDefault();
        if (away) return;
        onDrop(tech.id, null);
      }}
    >
      <header className="sched-col-head">
        <span className="sched-col-name">
          <span className="crew-dot" style={{ background: tech.color }} aria-hidden="true" />
          <strong>{tech.name}</strong>
        </span>
        <span className="muted small">{tech.trade}</span>
        {away ? (
          <span className="sched-away">{TIME_OFF_LABELS[tech.timeOff!.kind]}</span>
        ) : tech.shift ? (
          <span className="muted small">
            {tech.shift.start}–{tech.shift.end} · {tech.bookedHours}h of {tech.capacityHours}h
          </span>
        ) : (
          <span className="sched-away">Off</span>
        )}
        {!away && tech.shift && (
          <div className={`sched-load ${overbooked ? "is-over" : ""}`} aria-hidden="true">
            <span style={{ width: `${Math.round(load * 100)}%` }} />
          </div>
        )}
      </header>

      <ul className="sched-jobs">
        {tech.jobs.map((job, index) => (
          <li key={job.id} className="sched-slot">
            <div
              className="sched-gap"
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDrop(tech.id, index);
              }}
              aria-hidden="true"
            />
            <JobCard job={job} {...(dragProps(job, tech.id) as any)} onEmergency={() => onEmergency(job)} />
          </li>
        ))}
        {tech.jobs.length === 0 && (
          <li className="sched-empty">{away ? `Away — ${TIME_OFF_LABELS[tech.timeOff!.kind].toLowerCase()}` : dragging ? "Drop here" : "Nothing booked."}</li>
        )}
      </ul>
      {overbooked && <p className="sched-overbooked">Over their shift by {Math.round((tech.bookedHours - tech.capacityHours) * 10) / 10}h</p>}
    </section>
  );
}
