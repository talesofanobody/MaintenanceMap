import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { BrandMark } from "../App";
import { DashboardContext, useClock, useDashboardPolling } from "./useDashboardData";
import { openIssues } from "./derive";
import { PRIORITY_SHORT_LABELS } from "../types";
import { useAuth, useCurrentUser } from "../auth/AuthContext";

const TITLES: Record<string, string> = {
  "/dashboard": "TV mode",
  "/dashboard/map": "Live map",
  "/dashboard/board": "Work board",
  "/dashboard/summary": "Summary",
};

export default function DashboardLayout() {
  const state = useDashboardPolling(15000);
  const now = useClock(1000);
  const location = useLocation();
  const [fullscreen, setFullscreen] = useState(false);
  const user = useCurrentUser();
  const { logout } = useAuth();
  const isDisplay = user?.role === "display";

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }

  const title = TITLES[location.pathname] ?? "Dashboard";
  const secondsAgo = state.lastUpdated ? Math.round((now.getTime() - state.lastUpdated.getTime()) / 1000) : null;

  const ticker = useMemo(() => {
    if (!state.data) return [];
    return openIssues(state.data)
      .filter((i) => i.priority === "urgent" || i.priority === "high")
      .slice(0, 12);
  }, [state.data]);

  return (
    <DashboardContext.Provider value={state}>
      <div className="dash">
        <header className="dash-bar">
          <div className="dash-bar-left">
            <BrandMark />
            <span className="dash-brand">MaintenanceMap</span>
            <span className="dash-title">{title}</span>
          </div>
          <nav className="dash-nav" aria-label="Dashboard views">
            <NavLink to="/dashboard" end>
              TV
            </NavLink>
            <NavLink to="/dashboard/map">Map</NavLink>
            <NavLink to="/dashboard/board">Board</NavLink>
            <NavLink to="/dashboard/summary">Summary</NavLink>
          </nav>
          <div className="dash-bar-right">
            <span className={`dash-status ${state.error ? "error" : ""}`} title={state.error ?? "Live"}>
              <span className="dash-dot" />
              {state.error ? "Reconnecting…" : secondsAgo === null ? "Loading…" : secondsAgo < 3 ? "Live" : `Updated ${secondsAgo}s ago`}
            </span>
            <span className="dash-clock">
              <strong>{now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</strong>
              <span>{now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span>
            </span>
            <button type="button" className="dash-btn" onClick={toggleFullscreen} title="Toggle fullscreen (F)">
              {fullscreen ? "Exit fullscreen" : "Fullscreen"}
            </button>
            {isDisplay ? (
              <button type="button" className="dash-btn dash-btn-ghost" onClick={() => logout()}>
                Sign out
              </button>
            ) : (
              <Link to="/" className="dash-btn dash-btn-ghost">
                Exit
              </Link>
            )}
          </div>
        </header>

        <main className="dash-main">
          {state.error && !state.data ? (
            <div className="dash-empty">
              <h2>Can't reach the server</h2>
              <p>{state.error}</p>
            </div>
          ) : !state.data ? (
            <div className="dash-empty">
              <h2>Loading…</h2>
            </div>
          ) : (
            <Outlet />
          )}
        </main>

        <footer className="dash-ticker" aria-hidden="true">
          {ticker.length === 0 ? (
            <div className="dash-ticker-static">No urgent or high-priority issues open.</div>
          ) : (
            <div className="dash-ticker-track" style={{ animationDuration: `${Math.max(30, ticker.length * 8)}s` }}>
              {[...ticker, ...ticker].map((i, idx) => (
                <span className="dash-ticker-item" key={`${i.id}-${idx}`}>
                  <span className={`dash-tag dash-tag-${i.priority}`}>{PRIORITY_SHORT_LABELS[i.priority].toUpperCase()}</span>
                  {i.title} · {i.property.name} · {i.technician ? i.technician.name : "UNASSIGNED"}
                </span>
              ))}
            </div>
          )}
        </footer>
      </div>
    </DashboardContext.Provider>
  );
}
