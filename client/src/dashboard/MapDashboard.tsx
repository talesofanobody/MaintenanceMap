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
import { applyFilters, isOverdue, issueNumbers, openIssues } from "./derive";
import { useBoardFilters } from "./DepartureBoard";
import { formatDate } from "../lib/dates";
import { useDashboard } from "./useDashboardData";
import { useRailFocus } from "./DashRail";

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
  const [filters] = useBoardFilters();
  const issues = useMemo(() => (data ? applyFilters(openIssues(data), filters) : []), [data, filters]);
  const numbers = useMemo(() => (data ? issueNumbers(data) : new Map<string, number>()), [data]);
  // The card rail decides which issue is in focus; the map just follows it.
  const { current } = useRailFocus();
  const allBounds = useMemo(() => {
    if (!data) return null;
    const pts: L.LatLngExpression[] = [];
    for (const p of data.properties) if (p.boundary) pts.push(...geoJsonToLatLngs(p.boundary));
    for (const i of data.issues) pts.push([i.lat, i.lng]);
    return pts.length ? boundsOf(pts) : null;
  }, [data]);

  if (!data) return null;

  const center: [number, number] = current ? [current.lat, current.lng] : allBounds ? [allBounds.getCenter().lat, allBounds.getCenter().lng] : [39.8, -98.6];

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
    </div>
  );
}
