import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AppNotification } from "../types";
import { desktopAlertState, requestDesktopAlerts, timeAgo, useNotifications, type DesktopAlertState } from "./useNotifications";

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export default function NotificationBell() {
  const { items, unread, markRead, markAll, refresh } = useNotifications();
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<DesktopAlertState>(desktopAlertState());
  const wrap = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    refresh();
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, refresh]);

  function openItem(n: AppNotification) {
    if (!n.readAt) markRead(n.id);
    setOpen(false);
    // A guest report isn't an issue yet, so it opens the review queue rather than the map.
    if (n.kind === "guest_report") return navigate("/requests");
    if (n.propertyId) navigate(n.issueId ? `/properties/${n.propertyId}?issue=${n.issueId}` : `/properties/${n.propertyId}`);
  }

  return (
    <div className="bell" ref={wrap}>
      <button
        type="button"
        className="bell-btn"
        aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <BellIcon />
        {unread > 0 && <span className="bell-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button type="button" onClick={markAll}>
                Mark all as read
              </button>
            )}
          </div>
          {alerts === "default" && (
            <div className="bell-tools">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={async () => setAlerts(await requestDesktopAlerts())}
              >
                Enable desktop alerts
              </button>
              <p className="bell-hint" style={{ margin: "6px 0 0" }}>
                Get a pop-up when something is assigned to you or falls due, even with the tab in the background.
              </p>
            </div>
          )}
          {alerts === "denied" && <p className="bell-hint">Desktop alerts are blocked for this site in your browser settings.</p>}
          <ul className="bell-list">
            {items.length === 0 ? (
              <li className="bell-empty">You're all caught up.</li>
            ) : (
              items.slice(0, 40).map((n) => (
                <li key={n.id} className={n.readAt ? "" : "unread"}>
                  <button type="button" className="bell-item" onClick={() => openItem(n)}>
                    <span className={`bell-dot bell-dot-${n.kind}`} aria-hidden="true" />
                    <span>
                      <span className="bell-title">{n.title}</span>
                      {n.body && <span className="bell-body">{n.body}</span>}
                    </span>
                    <span className="bell-time">{timeAgo(n.at)}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
