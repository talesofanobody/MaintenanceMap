import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MapContainer, Marker, Polygon, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import type { Issue, Priority, Property, Status } from "../types";
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from "../types";
import { boundsOf, centroidOf, geoJsonToLatLngs, latLngsToGeoJson, WORLD_RING } from "../lib/geo";
import { MOBILE_QUERY, useMediaQuery } from "../lib/useMediaQuery";
import BoundaryDrawControl from "../components/BoundaryDrawControl";
import MapClickHandler from "../components/MapClickHandler";
import IssuePanel from "../components/IssuePanel";
import AddressSearch from "../components/AddressSearch";
import GettingStarted from "../components/GettingStarted";
import { draftDivIcon, issueDivIcon } from "../components/issueIcon";

const DEFAULT_CENTER: [number, number] = [39.8283, -98.5795];
export const SATELLITE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const SATELLITE_ATTRIBUTION = "Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, and the GIS User Community";

interface ViewTarget {
  lat: number;
  lng: number;
  zoom: number;
  nonce: number;
}

function FlyTo({ target }: { target: ViewTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], target.zoom, { duration: 1.2 });
  }, [map, target]);
  return null;
}

function FitToBounds({ bounds }: { bounds: L.LatLngBounds | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 20 });
    // Only on first load: later navigation is user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
}

// Zooming in close enough counts as having found the property for the guide.
function ZoomWatcher({ onCloseZoom }: { onCloseZoom: () => void }) {
  const map = useMapEvents({
    zoomend() {
      if (map.getZoom() >= 16) onCloseZoom();
    },
  });
  return null;
}

function guideKey(propertyId: string) {
  return `mm.guide.dismissed.${propertyId}`;
}

export default function PropertyWorkspace() {
  const { id } = useParams<{ id: string }>();
  const isMobile = useMediaQuery(MOBILE_QUERY);
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
  const [viewTarget, setViewTarget] = useState<ViewTarget | null>(null);
  const [hasLocated, setHasLocated] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState(true);

  const load = useCallback(() => {
    if (!id) return;
    Promise.all([api.getProperty(id), api.listIssues(id)])
      .then(([p, i]) => {
        setProperty(p);
        setIssues(i);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Show the guide until it is dismissed, or until the property is fully set up and
  // the "you're set up" state has been seen once.
  useEffect(() => {
    if (!id || loading || !property) return;
    try {
      if (localStorage.getItem(guideKey(id)) === "1") {
        setGuideDismissed(true);
        return;
      }
      const complete = !!property.boundary && issues.length > 0;
      const completedKey = `${guideKey(id)}.complete`;
      if (complete && localStorage.getItem(completedKey) === "1") {
        setGuideDismissed(true);
        return;
      }
      if (complete) localStorage.setItem(completedKey, "1");
      setGuideDismissed(false);
    } catch {
      setGuideDismissed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loading]);

  const numberedIssues = useMemo(() => {
    const sorted = [...issues].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return sorted.map((issue, idx) => ({ ...issue, number: idx + 1 }));
  }, [issues]);

  const visibleIssues = useMemo(
    () =>
      numberedIssues.filter(
        (i) => (statusFilter === "all" || i.status === statusFilter) && (priorityFilter === "all" || i.priority === priorityFilter)
      ),
    [numberedIssues, statusFilter, priorityFilter]
  );

  const boundaryLatLngs = useMemo(() => (property?.boundary ? geoJsonToLatLngs(property.boundary) : null), [property]);
  const initialBounds = useMemo(() => {
    const points: L.LatLngExpression[] = [
      ...(boundaryLatLngs && boundaryLatLngs.length >= 3 ? boundaryLatLngs : []),
      ...issues.map((i) => [i.lat, i.lng] as L.LatLngExpression),
    ];
    return points.length > 0 ? boundsOf(points) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property?.id]);

  const initialCenter: [number, number] =
    property?.centerLat && property?.centerLng ? [property.centerLat, property.centerLng] : DEFAULT_CENTER;
  const initialZoom = property?.centerLat ? 18 : 4;

  function handleMapClick(lat: number, lng: number) {
    if (!placingPin) return;
    setDraftLatLng({ lat, lng });
    setPlacingPin(false);
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

  function startDrawing() {
    const button = document.querySelector<HTMLAnchorElement>(".leaflet-draw-draw-polygon");
    button?.click();
  }

  function dismissGuide() {
    if (id) {
      try {
        localStorage.setItem(guideKey(id), "1");
      } catch {
        // storage unavailable; the guide simply reappears next visit
      }
    }
    setGuideDismissed(true);
  }

  function showGuide() {
    if (id) {
      try {
        localStorage.removeItem(guideKey(id));
      } catch {
        // ignore
      }
    }
    setGuideDismissed(false);
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

  if (loading) return <div className="page loading-state">Loading property…</div>;
  if (error) return <div className="page"><div className="banner banner-error">{error}</div></div>;
  if (!property) return <div className="page">Property not found.</div>;

  const showGuideCard = !guideDismissed && !placingPin && !(isMobile && panelOpen);
  const guideDrawActive = showGuideCard && (hasLocated || !!property.boundary) && !property.boundary && pendingBoundary === undefined;
  const hiddenByFilter = numberedIssues.length - visibleIssues.length;

  return (
    <div className={`workspace ${guideDrawActive ? "guide-draw-active" : ""} ${panelOpen ? "panel-open" : ""}`}>
      <div className="workspace-toolbar">
        <div className="workspace-toolbar-left">
          <Link to="/" className="btn btn-ghost btn-small" aria-label="Back to properties">
            ← <span className="hide-mobile">Properties</span>
          </Link>
          <h2 title={property.name}>{property.name}</h2>
          {guideDismissed && (
            <button type="button" className="btn btn-ghost btn-small hide-mobile" onClick={showGuide} title="Show the getting-started guide">
              ? Guide
            </button>
          )}
        </div>
        <div className="workspace-toolbar-search">
          <AddressSearch
            onSelect={(lat, lng, zoom) => {
              setHasLocated(true);
              setViewTarget({ lat, lng, zoom: zoom ?? 18, nonce: Date.now() });
            }}
          />
        </div>
        <div className="workspace-toolbar-right">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as Status | "all")} aria-label="Filter by status">
            <option value="all">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as Priority | "all")} aria-label="Filter by priority">
            <option value="all">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
          <Link to={`/properties/${property.id}/report`} className="btn btn-secondary btn-small">
            Report
          </Link>
          <button type="button" className="btn btn-primary btn-small" onClick={openCreatePanel} disabled={panelOpen}>
            + Add issue
          </button>
        </div>
      </div>

      <div className="workspace-body">
        <MapContainer center={initialCenter} zoom={initialZoom} className="map" zoomControl={!isMobile}>
          <TileLayer url={SATELLITE_URL} attribution={SATELLITE_ATTRIBUTION} maxZoom={21} maxNativeZoom={19} />
          {boundaryLatLngs && (
            <Polygon
              positions={[WORLD_RING, boundaryLatLngs]}
              pathOptions={{ stroke: false, fillColor: "#0f172a", fillOpacity: 0.35, interactive: false }}
            />
          )}
          <BoundaryDrawControl initialLatLngs={boundaryLatLngs ?? undefined} onChange={setPendingBoundary} />
          <MapClickHandler onClick={handleMapClick} />
          <FitToBounds bounds={initialBounds} />
          <FlyTo target={viewTarget} />
          <ZoomWatcher onCloseZoom={() => setHasLocated(true)} />

          {visibleIssues
            .filter((i) => !activeIssue || i.id !== activeIssue.id || !draftLatLng)
            .map((issue) => (
              <Marker
                key={issue.id}
                position={[issue.lat, issue.lng]}
                icon={issueDivIcon({ priority: issue.priority, status: issue.status, label: issue.number, size: isMobile ? 44 : 40 })}
                title={`#${issue.number} ${issue.title}`}
                eventHandlers={{ click: () => openEditPanel(issue) }}
                zIndexOffset={activeIssue?.id === issue.id ? 1000 : 0}
              />
            ))}

          {draftLatLng && <Marker position={[draftLatLng.lat, draftLatLng.lng]} icon={draftDivIcon()} zIndexOffset={2000} />}
        </MapContainer>

        <div className="map-overlays" aria-live="polite">
          {pendingBoundary !== undefined && (
            <div className="map-banner">
              <span>{pendingBoundary === null ? "Border removed — not saved yet." : "Border changed — not saved yet."}</span>
              <button type="button" className="btn btn-small btn-primary" onClick={saveBoundary} disabled={savingBoundary}>
                {savingBoundary ? "Saving…" : "Save border"}
              </button>
            </div>
          )}
          {placingPin && (
            <div className="map-banner map-banner-accent">
              <span>Tap the map where the issue is.</span>
              <button type="button" className="btn btn-small btn-ghost-light" onClick={() => setPlacingPin(false)}>
                Cancel
              </button>
            </div>
          )}
          {hiddenByFilter > 0 && (
            <div className="map-banner map-banner-muted">
              {hiddenByFilter} issue{hiddenByFilter === 1 ? "" : "s"} hidden by filters
            </div>
          )}
        </div>

        {showGuideCard && (
          <GettingStarted
            propertyId={property.id}
            hasLocated={hasLocated}
            hasBoundary={!!property.boundary}
            hasPendingBoundary={pendingBoundary !== undefined && pendingBoundary !== null}
            issueCount={issues.length}
            onLocated={() => setHasLocated(true)}
            onStartDrawing={startDrawing}
            onSaveBorder={saveBoundary}
            onAddIssue={openCreatePanel}
            onDismiss={dismissGuide}
          />
        )}

        {panelOpen && (
          <IssuePanel
            key={activeIssue?.id ?? "new"}
            propertyId={property.id}
            issue={activeIssue}
            draftLatLng={draftLatLng}
            onRequestReposition={() => setPlacingPin(true)}
            onLocationDetected={(lat, lng) => {
              setDraftLatLng({ lat, lng });
              setPlacingPin(false);
              setViewTarget({ lat, lng, zoom: 19, nonce: Date.now() });
            }}
            onClose={closePanel}
            onSaved={load}
          />
        )}
      </div>
    </div>
  );
}
