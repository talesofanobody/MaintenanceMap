import { useState } from "react";
import { Link } from "react-router-dom";
import { entryMs, formatClock, useOpenEntry, useTicker } from "./useTimer";

/** Header strip showing the job the signed-in technician is clocked in on. */
export default function ActiveTimer() {
  const { entry, clockOut } = useOpenEntry();
  const now = useTicker(1000);
  const [busy, setBusy] = useState(false);
  if (!entry) return null;

  return (
    <div className="active-timer" title={`${entry.issue.title} · ${entry.issue.property.name}`}>
      <span className="active-timer-dot" aria-hidden="true" />
      <Link to={`/properties/${entry.issue.propertyId}?issue=${entry.issueId}`} className="active-timer-text">
        <span className="active-timer-title hide-mobile">{entry.issue.title}</span>
        <strong>{formatClock(entryMs(entry, now))}</strong>
      </Link>
      <button
        type="button"
        className="btn btn-small btn-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await clockOut();
          } finally {
            setBusy(false);
          }
        }}
      >
        Clock out
      </button>
    </div>
  );
}
