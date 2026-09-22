import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import PhotoLightbox from "../components/PhotoLightbox";
import { formatDate, formatDateTime } from "../lib/dates";
import Finding, { flaggedIn } from "./Finding";
import type { Inspection, InspectionReport as ReportData, Project } from "../types";

/** A room and the findings in it, ready to lay out. */
interface Room {
  inspection: Inspection;
  findings: ReturnType<typeof flaggedIn>;
  major: number;
  moderate: number;
  minor: number;
  raised: number;
  checked: number;
}

function toRooms(inspections: Inspection[]): Room[] {
  return inspections.map((inspection) => {
    const findings = flaggedIn(inspection.checks);
    return {
      inspection,
      findings,
      major: findings.filter((c) => c.severity === "major").length,
      moderate: findings.filter((c) => c.severity === "moderate").length,
      minor: findings.filter((c) => c.severity !== "major" && c.severity !== "moderate").length,
      raised: findings.filter((c) => c.issueId).length,
      checked: inspection.checks.length,
    };
  });
}

/** The span the round covers, however the rooms were picked. */
function span(inspections: Inspection[]): string {
  if (!inspections.length) return "";
  const days = inspections.map((i) => i.startedAt.slice(0, 10)).sort();
  const first = days[0];
  const last = days[days.length - 1];
  return first === last ? formatDate(inspections[0].startedAt) : `${formatDate(first)} – ${formatDate(last)}`;
}

/**
 * Every room walked, on one document.
 *
 * The summary table is the part a manager reads: one line per room, worst first,
 * so a forty-room round can be triaged without turning a page. The rooms
 * themselves follow, each starting on a fresh sheet, and rooms where nothing was
 * found are named once at the end rather than given a page of their own.
 *
 * Nothing here is stored. The findings have been on the server since the moment
 * they were typed into a phone; this only gathers them up for printing.
 */
export default function InspectionsReport() {
  const [params] = useSearchParams();
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";

  const [data, setData] = useState<ReportData | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bundle, setBundle] = useState<"none" | "new" | "existing">("new");
  const [projectName, setProjectName] = useState("");
  const [existingProjectId, setExistingProjectId] = useState("");
  const [raising, setRaising] = useState(false);

  const query = useMemo(
    () => ({
      ids: params.get("ids")?.split(",").filter(Boolean) ?? [],
      propertyId: params.get("propertyId") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      status: params.get("status") ?? undefined,
    }),
    [params]
  );

  const load = useCallback(() => {
    setLoading(true);
    api
      .inspectionReport(query)
      .then((report) => {
        setData(report);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    api
      .listProjects({ status: "open" })
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [isAdmin]);

  const rooms = useMemo(() => toRooms(data?.inspections ?? []), [data]);
  // Worst rooms first, so the table is already triaged.
  const ranked = useMemo(
    () => [...rooms].sort((a, b) => b.major - a.major || b.moderate - a.moderate || b.findings.length - a.findings.length || a.inspection.roomName.localeCompare(b.inspection.roomName)),
    [rooms]
  );
  const withFindings = useMemo(() => ranked.filter((r) => r.findings.length > 0), [ranked]);
  const clean = useMemo(() => ranked.filter((r) => r.findings.length === 0), [ranked]);
  const raisable = useMemo(() => withFindings.flatMap((r) => r.findings.filter((c) => !c.issueId)), [withFindings]);

  const properties = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rooms) seen.set(r.inspection.propertyId, r.inspection.property.name);
    return [...seen.values()];
  }, [rooms]);

  const inspectors = useMemo(() => [...new Set(rooms.map((r) => r.inspection.inspector))], [rooms]);

  useEffect(() => {
    if (!projectName && rooms.length) {
      setProjectName(`${properties[0] ?? "Inspection"} — ${span(rooms.map((r) => r.inspection))} snagging`);
    }
  }, [rooms, properties, projectName]);

  // A finding raised elsewhere must drop out of the selection or the raise 400s.
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
    if (picked.size === 0) return;
    setRaising(true);
    try {
      const payload: Parameters<typeof api.raiseAcrossRooms>[0] = { checkIds: [...picked] };
      if (bundle === "new") {
        if (!projectName.trim()) throw new Error("A project needs a name.");
        payload.projectName = projectName.trim();
      } else if (bundle === "existing") {
        if (!existingProjectId) throw new Error("Pick a project to add them to.");
        payload.projectId = existingProjectId;
      }
      const result = await api.raiseAcrossRooms(payload);
      setPicked(new Set());
      setNote(
        result.projectName
          ? `${result.created.length} issue${result.created.length === 1 ? "" : "s"} raised into the project "${result.projectName}".`
          : `${result.created.length} issue${result.created.length === 1 ? "" : "s"} raised.`
      );
      setError(null);
      load();
      if (result.projectId) api.listProjects({ status: "open" }).then(setProjects).catch(() => {});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRaising(false);
    }
  }

  if (loading) return <div className="page loading-state">Loading…</div>;
  if (!data || !rooms.length) {
    return (
      <div className="page">
        <div className="report-actions no-print">
          <Link to="/inspections" className="btn btn-ghost btn-small">
            ← Inspections
          </Link>
        </div>
        <div className="banner banner-error">{error ?? "No inspections match that."}</div>
      </div>
    );
  }

  const totals = data.totals;

  return (
    <div className="page report-page insp-report-page">
      <div className="report-actions no-print">
        <Link to="/inspections" className="btn btn-ghost btn-small">
          ← Inspections
        </Link>
        <button type="button" className="btn btn-primary btn-small" onClick={() => window.print()}>
          Print all {totals.rooms} rooms
        </button>
      </div>

      {error && <div className="banner banner-error no-print">{error}</div>}
      {note && <div className="banner banner-info no-print">{note}</div>}

      <div className="report-sheet insp-sheet">
        <header className="insp-sheet-head">
          <div>
            <h1>Inspection round</h1>
            <p className="muted">
              {properties.join(", ")} · {totals.rooms} room{totals.rooms === 1 ? "" : "s"}
            </p>
          </div>
          <dl className="insp-meta">
            <div>
              <dt>Walked by</dt>
              <dd>{inspectors.length <= 2 ? inspectors.join(", ") : `${inspectors.length} people`}</dd>
            </div>
            <div>
              <dt>Dates</dt>
              <dd>{span(rooms.map((r) => r.inspection))}</dd>
            </div>
            <div>
              <dt>Printed</dt>
              <dd>{formatDate(new Date().toISOString())}</dd>
            </div>
          </dl>
        </header>

        <section className="insp-summary">
          <div className="insp-sum-box">
            <strong>{totals.rooms}</strong>
            <span>rooms</span>
          </div>
          <div className="insp-sum-box">
            <strong>{totals.points}</strong>
            <span>checked</span>
          </div>
          <div className={`insp-sum-box ${totals.flagged ? "is-flagged" : ""}`}>
            <strong>{totals.flagged}</strong>
            <span>flagged</span>
          </div>
          <div className="insp-sum-box">
            <strong>{totals.major}</strong>
            <span>major</span>
          </div>
          <div className="insp-sum-box">
            <strong>{totals.roomsWithFindings}</strong>
            <span>rooms w/ faults</span>
          </div>
          <div className="insp-sum-box">
            <strong>{totals.raised}</strong>
            <span>raised</span>
          </div>
        </section>

        <section className="insp-round-table-wrap">
          <h2>Room by room</h2>
          <table className="insp-round-table">
            <thead>
              <tr>
                <th>Room</th>
                <th className="num">Checked</th>
                <th className="num">Major</th>
                <th className="num">Mod.</th>
                <th className="num">Minor</th>
                <th className="num">Raised</th>
                <th>Walked</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((room) => (
                <tr key={room.inspection.id} className={room.major ? "has-major" : room.findings.length ? "has-findings" : "is-clean"}>
                  <th scope="row">
                    <a href={`#room-${room.inspection.id}`}>{room.inspection.roomName}</a>
                    {rooms.length > 1 && properties.length > 1 && <span className="muted small"> · {room.inspection.property.name}</span>}
                  </th>
                  <td className="num">{room.checked}</td>
                  <td className="num">{room.major || "—"}</td>
                  <td className="num">{room.moderate || "—"}</td>
                  <td className="num">{room.minor || "—"}</td>
                  <td className="num">{room.raised || "—"}</td>
                  <td>
                    {room.inspection.inspector}
                    <span className="muted small"> · {formatDate(room.inspection.startedAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td className="num">{totals.points}</td>
                <td className="num">{totals.major || "—"}</td>
                <td className="num">{totals.moderate || "—"}</td>
                <td className="num">{totals.minor || "—"}</td>
                <td className="num">{totals.raised || "—"}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </section>

        {isAdmin && raisable.length > 0 && (
          <section className="card insp-raise no-print">
            <h2>Turn findings into work</h2>
            <p className="muted small">
              {picked.size} of {raisable.length} selected, across {withFindings.length} room{withFindings.length === 1 ? "" : "s"}. Each becomes its own
              issue in the room it was found in.
            </p>
            <div className="insp-raise-pickers">
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setPicked(new Set(raisable.map((c) => c.id)))}>
                Select all
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => setPicked(new Set(raisable.filter((c) => c.severity === "major").map((c) => c.id)))}
              >
                Major only
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

        {withFindings.map((room) => (
          <section key={room.inspection.id} id={`room-${room.inspection.id}`} className="insp-round-room">
            <div className="insp-round-room-head">
              <h2>
                {room.inspection.roomName}
                <span className="muted small">
                  {" "}
                  · {room.inspection.property.name} · {room.inspection.templateName}
                </span>
              </h2>
              <p className="muted small">
                {room.inspection.inspector} · {formatDateTime(room.inspection.startedAt)} · {room.checked} checked · {room.findings.length} flagged
              </p>
            </div>
            {room.inspection.notes && <p className="insp-finding-note">{room.inspection.notes}</p>}
            <ol className="insp-findings">
              {room.findings.map((check, idx) => (
                <Finding
                  key={check.id}
                  check={check}
                  number={idx + 1}
                  propertyId={room.inspection.propertyId}
                  pickable={isAdmin}
                  picked={picked.has(check.id)}
                  onPick={() => toggle(check.id)}
                  onView={setLightbox}
                />
              ))}
            </ol>
          </section>
        ))}

        {clean.length > 0 && (
          <section className="insp-round-clean">
            <h2>Nothing found</h2>
            <p>
              {clean.map((r) => r.inspection.roomName).join(", ")} — {clean.length} room{clean.length === 1 ? "" : "s"} walked with nothing to report.
            </p>
          </section>
        )}
      </div>

      {lightbox && <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
