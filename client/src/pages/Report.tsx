import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MapContainer, Marker, Polygon, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import type { Issue, Priority, Property, Status } from "../types";
import { PRIORITIES, PRIORITY_DESCRIPTIONS, PRIORITY_LABELS, STATUS_LABELS } from "../types";
import { boundsOf, geoJsonToLatLngs, WORLD_RING } from "../lib/geo";
import { durationMs, formatDate, formatDuration, formatDurationMs } from "../lib/dates";
import { issueDivIcon, pinSvg } from "../components/issueIcon";
import { SATELLITE_ATTRIBUTION, SATELLITE_URL } from "./PropertyWorkspace";

const SEVERITY: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

function FitReportMap({ bounds }: { bounds: L.LatLngBounds | null }) {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 20 });
    };
    fit();
    window.addEventListener("beforeprint", fit);
    window.addEventListener("afterprint", fit);
    return () => {
      window.removeEventListener("beforeprint", fit);
      window.removeEventListener("afterprint", fit);
    };
  }, [map, bounds]);
  return null;
}

export default function Report() {
  const { id } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([api.getProperty(id), api.listIssues(id)])
      .then(([p, i]) => {
        setProperty(p);
        setIssues(i);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const numbered = useMemo(() => {
    const byCreated = [...issues].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return byCreated.map((issue, idx) => ({ ...issue, number: idx + 1 }));
  }, [issues]);

  const cards = useMemo(
    () => [...numbered].sort((a, b) => SEVERITY[a.priority] - SEVERITY[b.priority] || a.number - b.number),
    [numbered]
  );

  const counts = useMemo(() => {
    const byPriority: Record<Priority, number> = { low: 0, medium: 0, high: 0, urgent: 0 };
    const byStatus: Record<Status, number> = { pending: 0, in_progress: 0, completed: 0 };
    for (const i of issues) {
      byPriority[i.priority] += 1;
      byStatus[i.status] += 1;
    }
    const resolved = issues.filter((i) => i.status === "completed" && i.closedAt);
    const avgResolveMs = resolved.length
      ? resolved.reduce((sum, i) => sum + durationMs(i.createdAt, i.closedAt!), 0) / resolved.length
      : null;
    const openIssues = issues.filter((i) => i.status !== "completed");
    const oldestOpen = openIssues.length
      ? openIssues.reduce((oldest, i) => (i.createdAt < oldest.createdAt ? i : oldest))
      : null;
    return { byPriority, byStatus, open: byStatus.pending + byStatus.in_progress, avgResolveMs, resolvedCount: resolved.length, oldestOpen };
  }, [issues]);

  const boundaryLatLngs = useMemo(() => (property?.boundary ? geoJsonToLatLngs(property.boundary) : null), [property]);
  const bounds = useMemo(() => {
    const points: L.LatLngExpression[] = [
      ...(boundaryLatLngs && boundaryLatLngs.length >= 3 ? boundaryLatLngs : []),
      ...issues.map((i) => [i.lat, i.lng] as L.LatLngExpression),
    ];
    return points.length > 0 ? boundsOf(points) : null;
  }, [boundaryLatLngs, issues]);

  if (loading) return <div className="page loading-state">Preparing report…</div>;
  if (error) return <div className="page"><div className="banner banner-error">{error}</div></div>;
  if (!property) return <div className="page">Property not found.</div>;

  const center: [number, number] = property.centerLat && property.centerLng ? [property.centerLat, property.centerLng] : [39.8283, -98.5795];
  const generated = new Date();

  return (
    <div className="report-page">
      <div className="no-print report-actions">
        <Link to={`/properties/${property.id}`} className="btn btn-secondary btn-small">
          ← Back to map
        </Link>
        <div className="report-actions-right">
          <span className="muted small hide-mobile">Prints on A4 — choose "Save as PDF" in the print dialog for a file.</span>
          <button type="button" className="btn btn-primary btn-small" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
        </div>
      </div>

      <article className="report-sheet">
        <header className="report-header">
          <div>
            <span className="report-kicker">Maintenance report</span>
            <h1>{property.name}</h1>
            {property.address && <p className="report-address">{property.address}</p>}
          </div>
          <div className="report-meta">
            <span>Generated {generated.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</span>
            <span>
              {issues.length} issue{issues.length === 1 ? "" : "s"} · {counts.open} open · {counts.byStatus.completed} completed
            </span>
            {counts.avgResolveMs !== null && (
              <span>
                Avg. time to resolve: {formatDurationMs(counts.avgResolveMs)} ({counts.resolvedCount} closed)
              </span>
            )}
            {counts.oldestOpen && <span>Oldest open issue: {formatDuration(counts.oldestOpen.createdAt)}</span>}
          </div>
        </header>

        <section className="report-stats" aria-label="Summary">
          <div className="stat stat-total">
            <span className="stat-value">{issues.length}</span>
            <span className="stat-label">Total issues</span>
          </div>
          {PRIORITIES.slice().reverse().map((p) => (
            <div className={`stat stat-${p}`} key={p}>
              <span className="stat-value">{counts.byPriority[p]}</span>
              <span className="stat-label">{PRIORITY_LABELS[p]}</span>
            </div>
          ))}
        </section>

        <section className="report-map-block">
          <div className="report-map">
            <MapContainer
              center={center}
              zoom={property.centerLat ? 18 : 4}
              className="map"
              scrollWheelZoom={false}
              zoomControl={false}
              attributionControl={true}
            >
              <TileLayer url={SATELLITE_URL} attribution={SATELLITE_ATTRIBUTION} maxZoom={21} maxNativeZoom={19} />
              {boundaryLatLngs && (
                <>
                  <Polygon
                    positions={[WORLD_RING, boundaryLatLngs]}
                    pathOptions={{ stroke: false, fillColor: "#0f172a", fillOpacity: 0.62, interactive: false }}
                  />
                  <Polygon positions={boundaryLatLngs} pathOptions={{ color: "#38bdf8", weight: 3, fill: false, interactive: false }} />
                </>
              )}
              <FitReportMap bounds={bounds} />
              {numbered.map((issue) => (
                <Marker
                  key={issue.id}
                  position={[issue.lat, issue.lng]}
                  icon={issueDivIcon({ priority: issue.priority, status: issue.status, label: issue.number, size: 44 })}
                  interactive={false}
                />
              ))}
            </MapContainer>
            {!boundaryLatLngs && <div className="report-map-note">No border has been drawn for this property yet.</div>}
          </div>

          <div className="report-legend" aria-label="Legend">
            {PRIORITIES.slice().reverse().map((p) => (
              <div className="legend-item" key={p}>
                <span className="legend-pin" dangerouslySetInnerHTML={{ __html: pinSvg({ priority: p, status: "pending", size: 22 }) }} />
                <div>
                  <strong>{PRIORITY_LABELS[p]}</strong>
                  <span>{PRIORITY_DESCRIPTIONS[p]}</span>
                </div>
              </div>
            ))}
            <div className="legend-item legend-status">
              <span className="legend-pin" dangerouslySetInnerHTML={{ __html: pinSvg({ priority: "medium", status: "in_progress", size: 22 }) }} />
              <div>
                <strong>In progress</strong>
                <span>Work underway</span>
              </div>
            </div>
            <div className="legend-item legend-status">
              <span className="legend-pin" dangerouslySetInnerHTML={{ __html: pinSvg({ priority: "medium", status: "completed", size: 22 }) }} />
              <div>
                <strong>Completed</strong>
                <span>Resolved and closed</span>
              </div>
            </div>
          </div>
        </section>

        <section className="report-issues">
          <h2>
            Issues <span className="muted">(most severe first)</span>
          </h2>

          {cards.length === 0 && <p className="empty-state">No issues have been logged for this property.</p>}

          {cards.map((issue) => (
            <article className={`issue-card priority-${issue.priority} status-${issue.status}`} key={issue.id}>
              <div className="issue-card-side">
                <span className="issue-card-pin" dangerouslySetInnerHTML={{ __html: pinSvg({ priority: issue.priority, status: issue.status, label: issue.number, size: 34 }) }} />
              </div>
              <div className="issue-card-main">
                <header className="issue-card-header">
                  <h3>
                    <span className="issue-number">#{issue.number}</span> {issue.title}
                  </h3>
                  <div className="issue-card-badges">
                    <span className={`pill pill-${issue.priority}`}>{PRIORITY_LABELS[issue.priority]}</span>
                    <span className={`pill pill-status-${issue.status}`}>{STATUS_LABELS[issue.status]}</span>
                  </div>
                </header>

                <dl className="issue-card-grid">
                  <div>
                    <dt>Description</dt>
                    <dd>{issue.description || "—"}</dd>
                  </div>
                  <div>
                    <dt>What needs to be done</dt>
                    <dd>{issue.actionNeeded || "—"}</dd>
                  </div>
                  <div>
                    <dt>Work order</dt>
                    <dd>
                      {!issue.workOrderCreated ? (
                        "Not raised"
                      ) : issue.workOrderUrl ? (
                        <a href={issue.workOrderUrl} target="_blank" rel="noopener noreferrer" className="eam-link">
                          {issue.workOrderNumber || "Open in EAM"} ↗
                        </a>
                      ) : (
                        issue.workOrderNumber || "Created (no number)"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Comments</dt>
                    <dd>{issue.comments || "—"}</dd>
                  </div>
                  <div>
                    <dt>Logged</dt>
                    <dd>{formatDate(issue.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>{issue.status === "completed" && issue.closedAt ? "Closed" : "Open for"}</dt>
                    <dd>
                      {issue.status === "completed" && issue.closedAt
                        ? `${formatDate(issue.closedAt)} · resolved in ${formatDuration(issue.createdAt, issue.closedAt)}`
                        : formatDuration(issue.createdAt)}
                    </dd>
                  </div>
                </dl>

                {issue.photos.length > 0 && (
                  <div className="issue-card-photos">
                    {issue.photos.map((p) => (
                      <img key={p.id} src={api.photoThumbUrl(p.id)} alt="" loading="lazy" />
                    ))}
                  </div>
                )}

                <footer className="issue-card-footer">
                  {issue.updatedAt !== issue.createdAt && <span>Last updated {formatDate(issue.updatedAt)}</span>}
                  <span>
                    {issue.lat.toFixed(5)}, {issue.lng.toFixed(5)}
                  </span>
                </footer>
              </div>
            </article>
          ))}
        </section>

        <footer className="report-footer">
          <span>{property.name}</span>
          <span>MaintenanceMap · {generated.toLocaleDateString()}</span>
        </footer>
      </article>
    </div>
  );
}
