import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import PhotoLightbox from "../components/PhotoLightbox";
import { formatDateTime } from "../lib/dates";
import {
  categoryLabel,
  PRIORITY_LABELS,
  SEVERITY_LABELS,
  SEVERITY_PRIORITY,
  STATUS_LABELS,
  type Inspection,
  type InspectionCheck,
  type Project,
  type Severity,
} from "../types";

const SEVERITY_ORDER: Record<Severity, number> = { major: 0, moderate: 1, minor: 2 };

/**
 * What the inspector photographed. Raising a finding hands its photos to the issue
 * so the person doing the job has them, so the sheet looks there once it has.
 */
function evidence(check: InspectionCheck) {
  return check.photos.length ? check.photos : check.issue?.photos ?? [];
}

/** Findings worst-first, then in walk order — the order somebody would fix them in. */
function rank(checks: InspectionCheck[]): InspectionCheck[] {
  return [...checks].sort(
    (a, b) => SEVERITY_ORDER[(a.severity ?? "minor") as Severity] - SEVERITY_ORDER[(b.severity ?? "minor") as Severity] || a.position - b.position
  );
}

/**
 * The findings from one room, on one sheet, printable as it stands — and, for an
 * admin, the place each finding becomes work: one issue apiece, or all of them
 * bundled under a project.
 */
export default function InspectionReport() {
  const { id } = useParams<{ id: string }>();
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";

  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bundle, setBundle] = useState<"none" | "new" | "existing">("none");
  const [projectName, setProjectName] = useState("");
  const [existingProjectId, setExistingProjectId] = useState("");
  const [raising, setRaising] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    api
      .getInspection(id)
      .then((data) => {
        setInspection(data);
        setProjectName((current) => current || `${data.roomName} — snagging`);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    api
      .listProjects({ status: "open" })
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [isAdmin]);

  const flagged = useMemo(() => rank((inspection?.checks ?? []).filter((c) => c.outcome === "flagged")), [inspection]);
  const raisable = useMemo(() => flagged.filter((c) => !c.issueId), [flagged]);
  const alreadyRaised = useMemo(() => flagged.filter((c) => c.issueId), [flagged]);

  const counts = useMemo(() => {
    const checks = inspection?.checks ?? [];
    return {
      total: checks.length,
      ok: checks.filter((c) => c.outcome === "ok").length,
      flagged: checks.filter((c) => c.outcome === "flagged").length,
      na: checks.filter((c) => c.outcome === "na").length,
      photos: checks.reduce((n, c) => n + evidence(c).length, 0),
      major: checks.filter((c) => c.outcome === "flagged" && c.severity === "major").length,
    };
  }, [inspection]);

  // Anything already raised drops out of the selection so a stale tick cannot 400.
  useEffect(() => {
    setPicked((prev) => {
      const live = new Set(raisable.map((c) => c.id));
      const next = new Set([...prev].filter((cid) => live.has(cid)));
      return next.size === prev.size ? prev : next;
    });
  }, [raisable]);

  function toggle(checkId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(checkId)) next.delete(checkId);
      else next.add(checkId);
      return next;
    });
  }

  async function raise() {
    if (!inspection || picked.size === 0) return;
    setRaising(true);
    try {
      const payload: Parameters<typeof api.raiseFindings>[1] = { checkIds: [...picked] };
      if (bundle === "new") {
        if (!projectName.trim()) throw new Error("A project needs a name.");
        payload.projectName = projectName.trim();
      } else if (bundle === "existing") {
        if (!existingProjectId) throw new Error("Pick a project to add them to.");
        payload.projectId = existingProjectId;
      }
      const result = await api.raiseFindings(inspection.id, payload);
      setInspection(result.inspection);
      setPicked(new Set());
      setNote(
        result.projectName
          ? `${result.created.length} issue${result.created.length === 1 ? "" : "s"} raised into the project "${result.projectName}".`
          : `${result.created.length} issue${result.created.length === 1 ? "" : "s"} raised.`
      );
      setError(null);
      if (result.projectId) api.listProjects({ status: "open" }).then(setProjects).catch(() => {});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRaising(false);
    }
  }

  if (loading) return <div className="page loading-state">Loading…</div>;
  if (!inspection) {
    return (
      <div className="page">
        <div className="banner banner-error">{error ?? "Not found"}</div>
      </div>
    );
  }

  return (
    <div className="page report-page insp-report-page">
      <div className="report-actions no-print">
        <Link to="/inspections" className="btn btn-ghost btn-small">
          ← Inspections
        </Link>
        {inspection.status === "in_progress" && (
          <Link to={`/inspections/${inspection.id}`} className="btn btn-secondary btn-small">
            Carry on inspecting
          </Link>
        )}
        <button type="button" className="btn btn-primary btn-small" onClick={() => window.print()}>
          Print
        </button>
      </div>

      {error && <div className="banner banner-error no-print">{error}</div>}
      {note && <div className="banner banner-info no-print">{note}</div>}

      <div className="report-sheet insp-sheet">
        <header className="insp-sheet-head">
          <div>
            <h1>{inspection.roomName}</h1>
            <p className="muted">
              {inspection.property.name} · {inspection.templateName}
            </p>
          </div>
          <dl className="insp-meta">
            <div>
              <dt>Inspector</dt>
              <dd>{inspection.inspector}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{formatDateTime(inspection.startedAt)}</dd>
            </div>
            <div>
              <dt>{inspection.completedAt ? "Finished" : "Status"}</dt>
              <dd>{inspection.completedAt ? formatDateTime(inspection.completedAt) : "Still under way"}</dd>
            </div>
          </dl>
        </header>

        <section className="insp-summary">
          <div className="insp-sum-box">
            <strong>{counts.total}</strong>
            <span>checked</span>
          </div>
          <div className="insp-sum-box">
            <strong>{counts.ok}</strong>
            <span>fine</span>
          </div>
          <div className={`insp-sum-box ${counts.flagged ? "is-flagged" : ""}`}>
            <strong>{counts.flagged}</strong>
            <span>flagged</span>
          </div>
          <div className="insp-sum-box">
            <strong>{counts.major}</strong>
            <span>major</span>
          </div>
          <div className="insp-sum-box">
            <strong>{counts.na}</strong>
            <span>n/a</span>
          </div>
          <div className="insp-sum-box">
            <strong>{counts.photos}</strong>
            <span>photos</span>
          </div>
        </section>

        {inspection.notes && (
          <section className="insp-sheet-notes">
            <h2>Notes</h2>
            <p>{inspection.notes}</p>
          </section>
        )}

        <section>
          <h2>Findings</h2>
          {flagged.length === 0 ? (
            <p className="empty-state">Nothing was flagged in this room.</p>
          ) : (
            <ol className="insp-findings">
              {flagged.map((check, idx) => (
                <li key={check.id} className={`insp-finding sev-${check.severity ?? "minor"} ${check.issueId ? "is-raised" : ""}`}>
                  <div className="insp-finding-head">
                    {isAdmin && !check.issueId && (
                      <input
                        type="checkbox"
                        className="no-print insp-pick"
                        checked={picked.has(check.id)}
                        onChange={() => toggle(check.id)}
                        aria-label={`Raise "${check.label}" as an issue`}
                      />
                    )}
                    <span className="insp-finding-no">{idx + 1}</span>
                    <div className="insp-finding-text">
                      <p className="insp-finding-label">{check.label}</p>
                      <p className="muted small">
                        {check.section}
                        {check.category ? ` · ${categoryLabel(check.category)}` : ""}
                        {!check.pointId ? " · found on the walk" : ""}
                      </p>
                    </div>
                    <span className={`insp-sev-tag s-${check.severity ?? "minor"}`}>{SEVERITY_LABELS[(check.severity ?? "minor") as Severity]}</span>
                  </div>

                  {check.note && <p className="insp-finding-note">{check.note}</p>}
                  {check.hint && !check.note && <p className="muted small insp-finding-note">Looked for: {check.hint}</p>}

                  {evidence(check).length > 0 && (
                    <div className="insp-finding-photos">
                      {evidence(check).map((photo) => (
                        <button key={photo.id} type="button" className="insp-thumb" onClick={() => setLightbox(api.photoUrl(photo.id))}>
                          <img src={api.photoThumbUrl(photo.id)} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}

                  {check.issue ? (
                    <p className="insp-raised">
                      Raised as{" "}
                      <Link to={`/properties/${inspection.propertyId}?issue=${check.issue.id}`}>{check.issue.title}</Link> ·{" "}
                      {STATUS_LABELS[check.issue.status]} · {PRIORITY_LABELS[check.issue.priority]}
                    </p>
                  ) : (
                    <p className="muted small insp-would-be">
                      Would be raised as {PRIORITY_LABELS[SEVERITY_PRIORITY[(check.severity ?? "minor") as Severity]]} priority.
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        {isAdmin && raisable.length > 0 && (
          <section className="card insp-raise no-print">
            <h2>Turn findings into work</h2>
            <p className="muted small">
              {picked.size} of {raisable.length} selected. Each one becomes its own issue on {inspection.property.name}, in {inspection.roomName}, with
              its photos attached.
            </p>
            <div className="insp-raise-pickers">
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setPicked(new Set(raisable.map((c) => c.id)))}>
                Select all
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setPicked(new Set())} disabled={picked.size === 0}>
                Clear
              </button>
            </div>

            <fieldset className="insp-bundle">
              <legend>Group them?</legend>
              <label className="checkbox-row">
                <input type="radio" name="bundle" checked={bundle === "none"} onChange={() => setBundle("none")} />
                Separate issues
              </label>
              <label className="checkbox-row">
                <input type="radio" name="bundle" checked={bundle === "new"} onChange={() => setBundle("new")} />
                New project
              </label>
              {bundle === "new" && (
                <input className="insp-bundle-name" value={projectName} onChange={(e) => setProjectName(e.target.value)} maxLength={120} placeholder="Project name" />
              )}
              <label className="checkbox-row">
                <input type="radio" name="bundle" checked={bundle === "existing"} onChange={() => setBundle("existing")} disabled={projects.length === 0} />
                Add to an open project
              </label>
              {bundle === "existing" && (
                <select value={existingProjectId} onChange={(e) => setExistingProjectId(e.target.value)}>
                  <option value="">Pick a project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.counts.open} open)
                    </option>
                  ))}
                </select>
              )}
            </fieldset>

            <button type="button" className="btn btn-primary" disabled={raising || picked.size === 0} onClick={raise}>
              {raising ? "Raising…" : `Raise ${picked.size || ""} issue${picked.size === 1 ? "" : "s"}`.trim()}
            </button>
          </section>
        )}

        {alreadyRaised.length > 0 && (
          <p className="muted small insp-raised-count">
            {alreadyRaised.length} finding{alreadyRaised.length === 1 ? " has" : "s have"} already been raised as work.
          </p>
        )}
      </div>

      {lightbox && <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
