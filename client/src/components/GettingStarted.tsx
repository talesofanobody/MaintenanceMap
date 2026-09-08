import { Link } from "react-router-dom";

interface Props {
  propertyId: string;
  hasLocated: boolean;
  hasBoundary: boolean;
  hasPendingBoundary: boolean;
  issueCount: number;
  onLocated: () => void;
  onStartDrawing: () => void;
  onSaveBorder: () => void;
  onAddIssue: () => void;
  onDismiss: () => void;
}

interface Step {
  key: string;
  title: string;
  detail: string;
  done: boolean;
  action?: { label: string; onClick: () => void; primary?: boolean };
}

export default function GettingStarted({
  propertyId,
  hasLocated,
  hasBoundary,
  hasPendingBoundary,
  issueCount,
  onLocated,
  onStartDrawing,
  onSaveBorder,
  onAddIssue,
  onDismiss,
}: Props) {
  const steps: Step[] = [
    {
      key: "locate",
      title: "Find the property",
      detail: "Search the address or use your location, then zoom until the whole property fills the map.",
      done: hasLocated || hasBoundary,
      action: { label: "I can see it", onClick: onLocated },
    },
    {
      key: "draw",
      title: "Draw the border",
      detail: hasPendingBoundary
        ? "Border drawn — save it so it sticks. You can reshape it any time with the edit tool."
        : "Tap the polygon tool at the top-right of the map, tap each corner of the property, then tap the first corner again to close the shape.",
      done: hasBoundary,
      action: hasPendingBoundary
        ? { label: "Save border", onClick: onSaveBorder, primary: true }
        : { label: "Start drawing", onClick: onStartDrawing },
    },
    {
      key: "issue",
      title: "Log the first issue",
      detail: "Tap Add issue, then tap the spot on the map — or add a photo taken there and the pin places itself.",
      done: issueCount > 0,
      action: { label: "Add issue", onClick: onAddIssue, primary: true },
    },
  ];

  const current = steps.find((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = !current;

  return (
    <aside className={`guide ${allDone ? "guide-done" : ""}`} aria-label="Getting started">
      <div className="guide-header">
        <div>
          <strong>{allDone ? "You're set up" : "Getting started"}</strong>
          <span className="guide-progress">
            {doneCount}/{steps.length}
          </span>
        </div>
        <button type="button" className="btn-icon" onClick={onDismiss} aria-label="Hide guide">
          ✕
        </button>
      </div>

      <ol className="guide-steps">
        {steps.map((s, i) => {
          const isCurrent = current?.key === s.key;
          return (
            <li key={s.key} className={`guide-step ${s.done ? "done" : ""} ${isCurrent ? "current" : ""}`}>
              <span className="guide-step-marker" aria-hidden="true">
                {s.done ? "✓" : i + 1}
              </span>
              <div className="guide-step-body">
                <span className="guide-step-title">{s.title}</span>
                {isCurrent && (
                  <>
                    <p className="guide-step-detail">{s.detail}</p>
                    {s.action && (
                      <button
                        type="button"
                        className={`btn btn-small ${s.action.primary ? "btn-primary" : "btn-secondary"}`}
                        onClick={s.action.onClick}
                      >
                        {s.action.label}
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {allDone && (
        <div className="guide-footer">
          <p className="guide-step-detail">Keep logging issues as you walk the property, then generate the report whenever you need it.</p>
          <Link to={`/properties/${propertyId}/report`} className="btn btn-small btn-primary">
            Open report
          </Link>
        </div>
      )}
    </aside>
  );
}
