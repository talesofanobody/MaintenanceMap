import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import type { Issue, Priority, Property, Status } from "../types";
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from "../types";
import { geoJsonToLatLngs, latLngsToGeoJson, centroidOf } from "../lib/geo";
import BoundaryDrawControl from "../components/BoundaryDrawControl";
import MapClickHandler from "../components/MapClickHandler";
import IssuePanel from "../components/IssuePanel";
import AddressSearch from "../components/AddressSearch";
import { issueDivIcon, draftDivIcon } from "../components/issueIcon";

const DEFAULT_CENTER: [number, number] = [39.8283, -98.5795];
const SATELLITE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_ATTRIBUTION = "Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, and the GIS User Community";

function FlyTo({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lng], 18);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);
  return null;
}

export default function PropertyWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingBoundary, setPendingBoundary] = useState<L.LatLng[] | null | undefined>(undefined);
  const [savingBoundary, setSavingBoundary] = useState(false);

  const [placingPin, setPlacingPin] = useState(false);
  const [draftLatLng, setDraftLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number } | null>(null);

  function load() {
    if (!id) return;
    setLoading(true);
    Promise.all([api.getProperty(id), api.listIssues(id)])
      .then(([p, i]) => {
        setProperty(p);
        setIssues(i);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);

  const filteredIssues = useMemo(
    () =>
      issues.filter(
        (i) => (statusFilter === "all" || i.status === statusFilter) && (priorityFilter === "all" || i.priority === priorityFilter)
      ),
    [issues, statusFilter, priorityFilter]
  );

  const initialCenter: [number, number] = property?.centerLat && property?.centerLng ? [property.centerLat, property.centerLng] : DEFAULT_CENTER;
  const initialZoom = property?.centerLat ? 18 : 4;

  function handleMapClick(lat: number, lng: number) {
    if (placingPin) {
      setDraftLatLng({ lat, lng });
    }
  }

  function openCreatePanel() {
    setActiveIssue(null);
    setDraftLatLng(null);
    setPanelOpen(true);
    setPlacingPin(true);
  }

  function openEditPanel(issue: Issue) {
    setActiveIssue(issue);
    setDraftLatLng(null);
    setPanelOpen(true);
    setPlacingPin(false);
  }

  function closePanel() {
    setPanelOpen(false);
    setPlacingPin(false);
    setDraftLatLng(null);
    setActiveIssue(null);
  }

  async function saveBoundary() {
    if (!id || pendingBoundary === undefined) return;
    setSavingBoundary(true);
    try {
      if (pendingBoundary === null) {
        await api.updateProperty(id, { boundary: null });
      } else {
        const geojson = latLngsToGeoJson(pendingBoundary);
        const center = centroidOf(pendingBoundary);
        await api.updateProperty(id, { boundary: geojson, centerLat: center.lat, centerLng: center.lng });
      }
      load();
      setPendingBoundary(undefined);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingBoundary(false);
    }
  }

  if (loading) return <div className="page">Loading…</div>;
  if (error) return <div className="page banner banner-error">{error}</div>;
  if (!property) return <div className="page">Property not found.</div>;

  return (
    <div className="workspace">
      <div className="workspace-toolbar">
        <div className="workspace-toolbar-left">
          <Link to="/" className="btn btn-small">
            ← Properties
          </Link>
          <h2>{property.name}</h2>
        </div>
        <div className="workspace-toolbar-right">
          <AddressSearch onSelect={(lat, lng) => setFlyTarget({ lat, lng })} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as Status | "all")}>
            <option value="all">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as Priority | "all")}>
            <option value="all">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
          <Link to={`/properties/${property.id}/report`} className="btn btn-small">
            View Report
          </Link>
          <button className="btn btn-primary btn-small" onClick={openCreatePanel} disabled={panelOpen}>
            + Add Issue
          </button>
        </div>
      </div>

      {pendingBoundary !== undefined && (
        <div className="banner banner-info">
          Border changed and not yet saved.
          <button className="btn btn-small btn-primary" onClick={saveBoundary} disabled={savingBoundary}>
            {savingBoundary ? "Saving…" : "Save Border"}
          </button>
        </div>
      )}

      {placingPin && (
        <div className="banner banner-info">
          Click anywhere on the map to {draftLatLng ? "move" : "place"} the pin for this issue.
        </div>
      )}

      <div className="workspace-body">
        <MapContainer center={initialCenter} zoom={initialZoom} className="map">
          <TileLayer url={SATELLITE_URL} attribution={SATELLITE_ATTRIBUTION} maxZoom={20} />
          <BoundaryDrawControl
            initialLatLngs={property.boundary ? geoJsonToLatLngs(property.boundary) : undefined}
            onChange={setPendingBoundary}
          />
          <MapClickHandler onClick={handleMapClick} />
          {flyTarget && <FlyTo lat={flyTarget.lat} lng={flyTarget.lng} />}

          {filteredIssues
            .filter((i) => !activeIssue || i.id !== activeIssue.id || !draftLatLng)
            .map((issue) => (
              <Marker
                key={issue.id}
                position={[issue.lat, issue.lng]}
                icon={issueDivIcon(issue.priority, issue.status)}
                eventHandlers={{ click: () => openEditPanel(issue) }}
              >
                <Popup>
                  <strong>{issue.title}</strong>
                  <br />
                  {PRIORITY_LABELS[issue.priority]} · {STATUS_LABELS[issue.status]}
                </Popup>
              </Marker>
            ))}

          {draftLatLng && (
            <Marker position={[draftLatLng.lat, draftLatLng.lng]} icon={draftDivIcon()} />
          )}
        </MapContainer>

        {panelOpen && (
          <IssuePanel
            propertyId={property.id}
            issue={activeIssue}
            draftLatLng={draftLatLng}
            onRequestReposition={() => setPlacingPin(true)}
            onClose={closePanel}
            onSaved={load}
          />
        )}
      </div>
    </div>
  );
}
