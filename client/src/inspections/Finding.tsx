import { Link } from "react-router-dom";
import { api } from "../api";
import {
  categoryLabel,
  PRIORITY_LABELS,
  SEVERITY_LABELS,
  SEVERITY_PRIORITY,
  STATUS_LABELS,
  type InspectionCheck,
  type Severity,
} from "../types";

/**
 * One finding as it appears on a printed sheet.
 *
 * Shared by the single-room report and the all-rooms one so the two documents
 * agree line for line — somebody comparing a room's own sheet against the round
 * it belonged to should not find them worded differently.
 */

export const SEVERITY_ORDER: Record<Severity, number> = { major: 0, moderate: 1, minor: 2 };

/** Findings worst-first, then in walk order — the order somebody would fix them in. */
export function rank(checks: InspectionCheck[]): InspectionCheck[] {
  return [...checks].sort(
    (a, b) => SEVERITY_ORDER[(a.severity ?? "minor") as Severity] - SEVERITY_ORDER[(b.severity ?? "minor") as Severity] || a.position - b.position
  );
}

/**
 * What the inspector photographed. Raising a finding hands its photos to the issue
 * so the person doing the job has them, so the sheet looks there once it has.
 */
export function evidence(check: InspectionCheck) {
  return check.photos.length ? check.photos : check.issue?.photos ?? [];
}

export function flaggedIn(checks: InspectionCheck[]): InspectionCheck[] {
  return rank(checks.filter((c) => c.outcome === "flagged"));
}

export default function Finding({
  check,
  number,
  propertyId,
  pickable,
  picked,
  onPick,
  onView,
}: {
  check: InspectionCheck;
  number: number;
  propertyId: string;
  /** Admins can tick a finding to raise it; everyone else just reads the sheet. */
  pickable: boolean;
  picked: boolean;
  onPick: () => void;
  onView: (src: string) => void;
}) {
  const severity = (check.severity ?? "minor") as Severity;
  const photos = evidence(check);

  return (
    <li className={`insp-finding sev-${severity} ${check.issueId ? "is-raised" : ""}`}>
      <div className="insp-finding-head">
        {pickable && !check.issueId && (
          <input
            type="checkbox"
            className="no-print insp-pick"
            checked={picked}
            onChange={onPick}
            aria-label={`Raise "${check.label}" as an issue`}
          />
        )}
        <span className="insp-finding-no">{number}</span>
        <div className="insp-finding-text">
          <p className="insp-finding-label">{check.label}</p>
          <p className="muted small">
            {check.section}
            {check.category ? ` · ${categoryLabel(check.category)}` : ""}
            {!check.pointId ? " · found on the walk" : ""}
          </p>
        </div>
        <span className={`insp-sev-tag s-${severity}`}>{SEVERITY_LABELS[severity]}</span>
      </div>

      {check.note && <p className="insp-finding-note">{check.note}</p>}
      {check.hint && !check.note && <p className="muted small insp-finding-note">Looked for: {check.hint}</p>}

      {photos.length > 0 && (
        <div className="insp-finding-photos">
          {photos.map((photo) => (
            <button key={photo.id} type="button" className="insp-thumb" onClick={() => onView(api.photoUrl(photo.id))}>
              <img src={api.photoThumbUrl(photo.id)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {check.issue ? (
        <p className="insp-raised">
          Raised as <Link to={`/properties/${propertyId}?issue=${check.issue.id}`}>{check.issue.title}</Link> · {STATUS_LABELS[check.issue.status]} ·{" "}
          {PRIORITY_LABELS[check.issue.priority]}
        </p>
      ) : (
        <p className="muted small insp-would-be">Would be raised as {PRIORITY_LABELS[SEVERITY_PRIORITY[severity]]} priority.</p>
      )}
    </li>
  );
}
