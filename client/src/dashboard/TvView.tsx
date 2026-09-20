import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MapDashboard from "./MapDashboard";
import DepartureBoard from "./DepartureBoard";
import SummaryBoard from "./SummaryBoard";
import TicketBoard, { ticketBoardSeconds } from "./TicketBoard";
import { useDashboard } from "./useDashboardData";
import { isOpenStatus } from "../types";

type ViewKey = "map" | "board" | "tickets" | "summary";

const LABELS: Record<ViewKey, string> = { map: "Live map", board: "Work board", tickets: "Ticket board", summary: "Summary" };
const DEFAULT_SECONDS: Record<ViewKey, number> = { map: 45, board: 30, tickets: 30, summary: 20 };

// TV mode rotates through the boards. Tune it with ?map=60&board=30&tickets=45,
// or drop a view with ?summary=0. Space pauses, ←/→ skip.
export default function TvView() {
  const [params] = useSearchParams();
  const { data } = useDashboard();
  // The ticket board earns more time when there is more on it, so a busy morning
  // isn't cut off mid-scroll. An explicit ?tickets= in the URL always wins.
  const openCount = (data?.issues ?? []).filter((i) => isOpenStatus(i.status)).length;

  const sequence = useMemo(() => {
    return (["map", "board", "tickets", "summary"] as ViewKey[])
      .map((key) => {
        const raw = params.get(key);
        const fallback = key === "tickets" ? ticketBoardSeconds(openCount) : DEFAULT_SECONDS[key];
        const seconds = raw === null ? fallback : Math.max(0, Number(raw) || 0);
        return { key, seconds };
      })
      .filter((s) => s.seconds > 0);
  }, [params, openCount]);

  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [round, setRound] = useState(0);
  const current = sequence[step % Math.max(1, sequence.length)];

  useEffect(() => {
    if (!current || paused || sequence.length <= 1) return;
    const timer = setTimeout(() => {
      setStep((s) => (s + 1) % sequence.length);
      setRound((r) => r + 1);
    }, current.seconds * 1000);
    return () => clearTimeout(timer);
  }, [current, paused, sequence.length, round]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === "ArrowRight") {
        setStep((s) => (s + 1) % sequence.length);
        setRound((r) => r + 1);
      } else if (e.key === "ArrowLeft") {
        setStep((s) => (s - 1 + sequence.length) % sequence.length);
        setRound((r) => r + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sequence.length]);

  if (!current) {
    return (
      <div className="dash-empty">
        <h2>Nothing to show</h2>
        <p>Every view is set to 0 seconds.</p>
      </div>
    );
  }

  const next = sequence[(step + 1) % sequence.length];

  return (
    <div className="tv">
      <div className="tv-strip">
        <span className="tv-now">{LABELS[current.key]}</span>
        {sequence.length > 1 && (
          <span className="tv-next">
            {paused ? "Paused — press space to resume" : `Next: ${LABELS[next.key]}`}
          </span>
        )}
        <span className="tv-dots">
          {sequence.map((s, i) => (
            <span key={s.key} className={i === step % sequence.length ? "on" : ""} />
          ))}
        </span>
        {!paused && sequence.length > 1 && <span className="tv-progress" key={round} style={{ animationDuration: `${current.seconds}s` }} />}
      </div>
      <div className="tv-body" key={`${current.key}-${round}`}>
        {current.key === "map" && <MapDashboard />}
        {current.key === "board" && <DepartureBoard showControls={false} />}
        {current.key === "tickets" && <TicketBoard />}
        {current.key === "summary" && <SummaryBoard />}
      </div>
    </div>
  );
}
