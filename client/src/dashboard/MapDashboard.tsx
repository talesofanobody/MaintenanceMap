import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polygon, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import type { DashboardIssue } from "../types";
import { PRIORITY_LABELS, STATUS_LABELS } from "../types";
import { boundsOf, geoJsonToLatLngs } from "../lib/geo";
import { formatDuration } from "../lib/dates";
import { formatHours, initials, relativeDay, todayStr } from "../lib/capacity";
import { issueDivIcon, pinSvg } from "../components/issueIcon";
import { SATELLITE_ATTRIBUTION, SATELLITE_URL } from "../pages/PropertyWorkspace";
import { issueNumbers, openIssues } from "./derive";
import { useDashboard } from "./useDashboardData";

const DWELL_MS = 12000;

function FocusIssue({ issue, fallback }: { issue: DashboardIssue | null; fallback: L.LatLngBounds | null }) {
  const map = useMap();
  useEffect(() => {
    if (issue) {
      map.flyTo([issue.lat, issue.lng], 19, { duration: 2, easeLinearity: 0.3 });
    } else if (fallback && fallback.isValid()) {
      map.fitBounds(fallback, { padding: [60, 60], maxZoom: 18 });
    }
  }, [map, issue, fallback]);
  return null;
}

export default function MapDashboard() {
  const { data } = useDashboard();
  const issues = useMemo(() => (data ? openIssues(data) : []), [data]);
  const numbers = useMemo(() => (data ? issueNumbers(data) : new Map<string, number>()), [data]);
  const [index, setIndex] = useState(0);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (issues.length === 0) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % issues.length);
      setCycle((c) => c + 1);
    }, DWELL_MS);
    return () => clearInterval(timer);
  }, [issues.length]);

  useEffect(() => {
    if (index >= issues.length) setIndex(0);
  }, [issues.length, index]);

  const current = issues[index] ?? null;
  const allBounds = useMemo(() => {
    if (!data) return null;
    const pts: L.LatLngExpression[] = [];
    for (const p of data.properties) if (p.boundary) pts.push(...geoJsonToLatLngs(p.boundary));
    for (const i of data.issues) pts.push([i.lat, i.lng]);
    return pts.length ? boundsOf(pts) : null;
  }, [data]);

  if (!data) return null;

  const center: [number, number] = current ? [current.lat, current.lng] : allBounds ? [allBounds.getCenter().lat, allBounds.getCenter().lng] : [39.8, -98.6];
  const upNext = issues.length > 1 ? Array.from({ length: Math.min(5, issues.length - 1) }, (_, k) => issues[(index + 1 + k) % issues.length]) : [];

  return (
    <div className="dash-map-view">
      <div className="dash-map">
        <MapContainer center={center} zoom={current ? 19 : 15} className="map" zoomControl={false} attributionControl={false} scrollWheelZoom={false} dragging={false} doubleClickZoom={false}>
          <TileLayer url={SATELLITE_URL} attribution={SATELLITE_ATTRIBUTION} maxZoom={21} maxNativeZoom={19} />
          {data.properties.map(
            (p) =>
              p.boundary && (
                <Polygon
                  key={p.id}
                  positions={geoJsonToLatLngs(p.boundary)}
                  pathOptions={{ color: "#38bdf8", weight: 3, fillColor: "#38bdf8", fillOpacity: current?.propertyId === p.id ? 0.12 : 0.04, interactive: false }}
                />
              )
          )}
          {issues.map((issue) => (
            <Marker
              key={issue.id}
              position={[issue.lat, issue.lng]}
              icon={issueDivIcon({
                priority: issue.priority,
                status: issue.status,
                label: numbers.get(issue.id),
                size: current?.id === issue.id ? 52 : 36,
                dimmed: !!current && current.id !== issue.id,
              })}
              interactive={false}
              zIndexOffset={current?.id === issue.id ? 1000 : 0}
            />
          ))}
          <FocusIssue issue={current} fallback={allBounds} />
        </MapContainer>
      </div>

      {current ? (
        <aside className="dash-card" key={current.id}>
          <div className="dash-card-progress" key={cycle} style={{ animationDuration: `${DWELL_MS}ms` }} />
          <div className="dash-card-kicker">
            <span>{current.property.name}</span>
            <span>
              {index + 1} / {issues.length}
            </span>
          </div>
          <div className="dash-card-title">
            <span className="dash-card-pin" dangerouslySetInnerHTML={{ __html: pinSvg({ priority: current.priority, status: current.status, label: numbers.get(current.id), size: 44 }) }} />
            <h2>{current.title}</h2>
          </div>
          <div className="dash-card-badges">
            <span className={`dash-tag dash-tag-${current.priority}`}>{PRIORITY_LABELS[current.priority]}</span>
            <span className={`dash-tag dash-tag-status-${current.status}`}>{STATUS_LABELS[current.status]}</span>
          </div>

          <div className={`dash-card-tech ${current.technician ? "" : "unassigned"}`}>
            {current.technician ? (
              <>
                <span className="avatar avatar-lg" style={{ background: current.technician.color }}>
                  {initials(current.technician.name)}
                </span>
                <div>
                  <strong>{current.technician.name}</strong>
                  <span>{current.technician.trade ?? "Technician"}</span>
                </div>
              </>
            ) : (
              <>
                <span className="avatar avatar-lg avatar-empty">?</span>
                <div>
                  <strong>Unassigned</strong>
                  <span>Needs a technician</span>
                </div>
              </>
            )}
          </div>

          <dl className="dash-card-facts">
            <div>
              <dt>Scheduled</dt>
              <dd className={current.scheduledFor && current.scheduledFor < todayStr() ? "dash-overdue" : ""}>
                {current.scheduledFor
                  ? current.scheduledFor < todayStr()
                    ? `Overdue · ${relativeDay(current.scheduledFor)}`
                    : relativeDay(current.scheduledFor)
                  : "Not yet"}
              </dd>
            </div>
            <div>
              <dt>Estimate</dt>
              <dd>{current.estimatedHours != null ? formatHours(current.estimatedHours) : "—"}</dd>
            </div>
            <div>
              <dt>Open for</dt>
              <dd>{formatDuration(current.createdAt)}</dd>
            </div>
            <div>
              <dt>Work order</dt>
              <dd>{current.workOrderCreated ? current.workOrderNumber || "Raised" : "None"}</dd>
            </div>
          </dl>

          {current.description && <p className="dash-card-desc">{current.description}</p>}
          {current.actionNeeded && (
            <p className="dash-card-desc dash-card-action">
              <span>To do:</span> {current.actionNeeded}
            </p>
          )}
          {current.photos[0] && <img className="dash-card-photo" src={api.photoThumbUrl(current.photos[0].id)} alt="" />}
        </aside>
      ) : (
        <aside className="dash-card dash-card-clear">
          <h2>All clear</h2>
          <p>No open issues across {data.properties.length} propert{data.properties.length === 1 ? "y" : "ies"}.</p>
        </aside>
      )}

      {upNext.length > 0 && (
        <div className="dash-queue">
          <span className="dash-queue-label">Up next</span>
          {upNext.map((i) => (
            <span className="dash-queue-item" key={i.id}>
              <span className="dash-queue-pin" dangerouslySetInnerHTML={{ __html: pinSvg({ priority: i.priority, status: i.status, size: 20 }) }} />
              <span className="dash-queue-title">{i.title}</span>
              <span className="dash-queue-meta">
                {i.property.name} · {i.technician ? i.technician.name : "Unassigned"}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
