import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MapContainer, Marker, Polygon, Popup, TileLayer } from "react-leaflet";
import { api } from "../api";
import type { Issue, Property } from "../types";
import { PRIORITIES, PRIORITY_LABELS, STATUS_LABELS, STATUSES } from "../types";
import { geoJsonToLatLngs } from "../lib/geo";
import { issueDivIcon } from "../components/issueIcon";

export default function Report() {
  const { id } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([api.getProperty(id), api.listIssues(id)]).then(([p, i]) => {
      setProperty(p);
      setIssues(i);
      setLoading(false);
    });
  }, [id]);

  const counts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    for (const i of issues) {
      byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
      byPriority[i.priority] = (byPriority[i.priority] ?? 0) + 1;
    }
    return { byStatus, byPriority };
  }, [issues]);

  if (loading) return <div className="page">Loading…</div>;
  if (!property) return <div className="page">Property not found.</div>;

  const center: [number, number] = property.centerLat && property.centerLng ? [property.centerLat, property.centerLng] : [39.8283, -98.5795];

  return (
    <div className="page report">
      <div className="no-print report-actions">
        <Link to={`/properties/${property.id}`} className="btn btn-small">
          ← Back to Map
        </Link>
        <button className="btn btn-primary btn-small" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <h1>{property.name} — Maintenance Report</h1>
      {property.address && <p className="muted">{property.address}</p>}
      <p className="muted small">Generated {new Date().toLocaleString()}</p>

      <div className="report-summary">
        <div>
          <h3>By Status</h3>
          <ul>
            {STATUSES.map((s) => (
              <li key={s}>
                {STATUS_LABELS[s]}: <strong>{counts.byStatus[s] ?? 0}</strong>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>By Priority</h3>
          <ul>
            {PRIORITIES.map((p) => (
              <li key={p}>
                {PRIORITY_LABELS[p]}: <strong>{counts.byPriority[p] ?? 0}</strong>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Total</h3>
          <p className="report-total">{issues.length}</p>
        </div>
      </div>

      <div className="report-map">
        <MapContainer center={center} zoom={property.centerLat ? 18 : 4} className="map" scrollWheelZoom={false}>
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri"
            maxZoom={20}
          />
          {property.boundary && <Polygon positions={geoJsonToLatLngs(property.boundary)} pathOptions={{ color: "#2563eb" }} />}
          {issues.map((issue) => (
            <Marker key={issue.id} position={[issue.lat, issue.lng]} icon={issueDivIcon(issue.priority, issue.status)}>
              <Popup>
                <strong>{issue.title}</strong>
                <br />
                {PRIORITY_LABELS[issue.priority]} · {STATUS_LABELS[issue.status]}
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      <h2>Issue Details</h2>
      <table className="report-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Description</th>
            <th>Action Needed</th>
            <th>Work Order</th>
            <th>Comments</th>
            <th>Photos</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => (
            <tr key={issue.id}>
              <td>{issue.title}</td>
              <td>
                <span className={`pill pill-${issue.priority}`}>{PRIORITY_LABELS[issue.priority]}</span>
              </td>
              <td>{STATUS_LABELS[issue.status]}</td>
              <td>{issue.description || "—"}</td>
              <td>{issue.actionNeeded || "—"}</td>
              <td>{issue.workOrderCreated ? issue.workOrderNumber || "Created" : "None"}</td>
              <td>{issue.comments || "—"}</td>
              <td>
                <div className="report-photos">
                  {issue.photos.map((p) => (
                    <img key={p.id} src={api.photoUrl(p.id)} alt="" />
                  ))}
                </div>
              </td>
            </tr>
          ))}
          {issues.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">
                No issues recorded.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
