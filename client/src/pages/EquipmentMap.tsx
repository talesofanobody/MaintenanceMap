import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polygon, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import { useCan } from "../auth/AuthContext";
import { assetDivIcon } from "../components/assetIcon";
import PhotoLightbox from "../components/PhotoLightbox";
import { boundsOf, geoJsonToLatLngs } from "../lib/geo";
import { SATELLITE_ATTRIBUTION, SATELLITE_URL } from "./PropertyWorkspace";
import {
  ASSET_KIND_LABELS, RELATION_LABELS, SERVICE_STATE_LABELS,
  type AssetDetail, type AssetMap, type AssetMapMarker, type MapAssetSummary,
  type Property,
} from "../types";

type Tab = "detail" | "feeds" | "fedby" | "photos";

/** Follows whatever is in focus, without fighting the user's own panning. */
function FocusPoint({ at, fallback }: { at: [number, number] | null; fallback: L.LatLngBounds | null }) {
  const map = useMap();
  const last = useRef<string>("");
  useEffect(() => {
    if (at) {
      const key = at.join(",");
      if (key === last.current) return;
      last.current = key;
      map.flyTo(at, Math.max(map.getZoom(), 20), { duration: 0.8 });
    } else if (fallback && fallback.isValid() && !last.current) {
      last.current = "fitted";
      map.fitBounds(fallback, { padding: [60, 60], maxZoom: 19 });
    }
  }, [map, at, fallback]);
  return null;
}

function PlacementClicks({ active, onPick }: { active: boolean; onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => { if (active) onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

function label(a: { name: string; ref?: string | null }): string {
  return a.ref && a.ref !== a.name ? `${a.ref} — ${a.name}` : a.name;
}

/**
 * The property manual as a map.
 *
 * The register answers "what have we got". This answers the question people
 * actually arrive with: standing at a point on the site, what is here, what does
 * it control, what does it look like, and what feeds it.
 *
 * Two deliberate choices shape it. A marker is an anchor rather than a piece of
 * equipment, because a riser with eight breakers would otherwise draw eight pins
 * on one pixel. And a marker anchored to a space is drawn dashed and centred on
 * the area rather than solid and pointed, because "somewhere in this building" and
 * "here" are different claims — drawing them alike would send somebody to the
 * wrong wall on the strength of a guess. The floor-plan overlay replaces the
 * dashed ones; until then they are honest about what is known.
 */
export default function EquipmentMap() {
  const can = useCan();
  const mayEdit = can("property.write");

  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [property, setProperty] = useState<Property | null>(null);
  const [map, setMap] = useState<AssetMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [activeMarker, setActiveMarker] = useState<AssetMapMarker | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [tab, setTab] = useState<Tab>("detail");
  const [lightbox, setLightbox] = useState<string | null>(null);

  const [placing, setPlacing] = useState(false);
  const mapRef = useRef<AssetMap | null>(null);
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listProperties()
      .then((p) => { setProperties(p); setPropertyId((cur) => cur || p[0]?.id || ""); })
      .catch((e: Error) => setError(e.message));
  }, []);

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      const [m, props] = await Promise.all([api.assetMap(propertyId), api.listProperties()]);
      setMap(m);
      mapRef.current = m;
      setProperty(props.find((p) => p.id === propertyId) ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [propertyId]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Open a piece of equipment, and take the map with it.
   *
   * Finding its marker when none was passed is the point: following a chain from
   * the Fed by tab, or opening something off the unplaced list, otherwise selects
   * a marker that may be well outside the current view — the panel changes, the
   * map does not, and the highlight somebody is looking for is off screen.
   */
  const open = useCallback(async (assetId: string, marker?: AssetMapMarker) => {
    setSelectedId(assetId);
    setDetail(null);
    const found = marker ?? mapRef.current?.markers.find((m) => m.assets.some((a) => a.id === assetId)) ?? null;
    if (found) {
      setActiveMarker(found);
      setFocus([found.lat, found.lng]);
    } else {
      // Nothing to fly to: it is not on the map at all.
      setActiveMarker(null);
    }
    try {
      setDetail(await api.getAsset(assetId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const refresh = async (fn: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (message) setNote(message);
      await load();
      if (selectedId) setDetail(await api.getAsset(selectedId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const boundary = useMemo(() => (property?.boundary ? geoJsonToLatLngs(property.boundary) : null), [property]);

  const fallbackBounds = useMemo(() => {
    const pts: L.LatLngExpression[] = [];
    if (boundary) pts.push(...boundary);
    for (const m of map?.markers ?? []) pts.push([m.lat, m.lng]);
    return pts.length ? boundsOf(pts) : null;
  }, [boundary, map]);

  const center: [number, number] = property?.centerLat != null && property?.centerLng != null
    ? [property.centerLat, property.centerLng]
    : [13.99, -61.0];

  /** The worst service state in a marker decides its colour. */
  const markerState = (m: AssetMapMarker) => {
    const order = ["overdue", "never", "due", "unknown", "ok"] as const;
    for (const s of order) if (m.assets.some((a) => a.service.state === s)) return s;
    return "unknown" as const;
  };

  const selected: MapAssetSummary | null = useMemo(() => {
    if (!selectedId) return null;
    for (const m of map?.markers ?? []) {
      const hit = m.assets.find((a) => a.id === selectedId);
      if (hit) return hit;
    }
    return map?.unplaced.find((a) => a.id === selectedId) ?? null;
  }, [map, selectedId]);

  return (
    <div className="page equipment-map-page">
      <div className="page-header">
        <div>
          <h1>Equipment map</h1>
          <p className="muted">
            What is where, what it controls, and what it looks like. A dashed marker means
            “somewhere in this building” — a solid one is a surveyed point.
          </p>
        </div>
        <div className="page-header-actions">
          <select
            value={propertyId}
            aria-label="Property"
            onChange={(e) => { setPropertyId(e.target.value); setSelectedId(null); setDetail(null); setActiveMarker(null); setFocus(null); }}
          >
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {note && <div className="banner banner-ok small" onClick={() => setNote(null)}>{note}</div>}

      {placing && (
        <div className="banner banner-warn eqmap-placing">
          Tap the map where <strong>{selected ? label(selected) : "it"}</strong> actually is.
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setPlacing(false)}>Cancel</button>
        </div>
      )}

      <div className="eqmap">
        <div className={placing ? "eqmap-canvas eqmap-placing-mode" : "eqmap-canvas"}>
          <MapContainer center={center} zoom={17} className="map" zoomControl>
            <TileLayer url={SATELLITE_URL} attribution={SATELLITE_ATTRIBUTION} maxZoom={21} maxNativeZoom={19} />
            {boundary && (
              <Polygon positions={boundary} pathOptions={{ color: "#2563eb", weight: 2, fill: false, interactive: false }} />
            )}
            <FocusPoint at={focus} fallback={fallbackBounds} />
            <PlacementClicks
              active={placing && !!selectedId}
              onPick={(lat, lng) =>
                refresh(async () => {
                  await api.updateAsset(selectedId!, { lat, lng });
                  setPlacing(false);
                  setFocus([lat, lng]);
                }, "Placed.")
              }
            />
            {(map?.markers ?? []).map((m) => {
              const holdsSelected = m.assets.some((a) => a.id === selectedId);
              return (
                <Marker
                  key={m.key}
                  position={[m.lat, m.lng]}
                  icon={assetDivIcon({
                    kind: m.assets[0]?.kind ?? "other",
                    state: markerState(m),
                    count: m.assets.length,
                    approximate: m.anchorKind === "space",
                    selected: holdsSelected,
                  })}
                  zIndexOffset={holdsSelected ? 1000 : 0}
                  eventHandlers={{
                    click: () => {
                      setActiveMarker(m);
                      setTab("detail");
                      // A marker holding one thing opens it; a cluster lists them.
                      if (m.assets.length === 1) void open(m.assets[0].id, m);
                      else { setSelectedId(null); setDetail(null); setFocus([m.lat, m.lng]); }
                    },
                  }}
                />
              );
            })}
          </MapContainer>
        </div>

        {/* ---- the side tab ------------------------------------------- */}
        <aside className="eqmap-side">
          {!activeMarker && !selectedId ? (
            <div className="eqmap-empty">
              <h2>Nothing selected</h2>
              <p className="muted small">
                Tap a marker. A number on one means it holds more than one piece of equipment —
                a riser, a plant room, a board with its breakers.
              </p>
              {map && map.markers.length === 0 && (
                <p className="muted small">
                  Nothing is on the map yet. Equipment appears here once it has either its own
                  position or a space that has one.
                </p>
              )}
            </div>
          ) : !selectedId && activeMarker ? (
            <div className="eqmap-cluster">
              <h2>{activeMarker.spacePath ? activeMarker.spacePath.join(" · ") : "Here"}</h2>
              <p className="muted small">{activeMarker.assets.length} items</p>
              <ul className="eqmap-cluster-list">
                {activeMarker.assets.map((a) => (
                  <li key={a.id}>
                    <button type="button" className="eqmap-cluster-btn" onClick={() => void open(a.id, activeMarker)}>
                      <span>{label(a)}</span>
                      <span className="muted small">{ASSET_KIND_LABELS[a.kind] ?? a.kind}</span>
                    </button>
                    {a.photoCount > 0 && <span className="muted small">{a.photoCount}&nbsp;photo{a.photoCount === 1 ? "" : "s"}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : !detail ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <div className="eqmap-side-head">
                <h2>{label(detail.asset)}</h2>
                <span className="muted small">{ASSET_KIND_LABELS[detail.asset.kind] ?? detail.asset.kind}</span>
                {activeMarker && activeMarker.assets.length > 1 && (
                  <button type="button" className="link-button small" onClick={() => { setSelectedId(null); setDetail(null); }}>
                    ← the other {activeMarker.assets.length - 1} here
                  </button>
                )}
              </div>

              <nav className="eqmap-tabs" role="tablist">
                {([
                  ["detail", "Details"],
                  ["feeds", `Controls${detail.affects.spaces.length ? ` (${detail.affects.spaces.length})` : ""}`],
                  ["fedby", `Fed by${detail.fedBy.length ? ` (${detail.fedBy.length})` : ""}`],
                  ["photos", `Photos${detail.asset.photos.length ? ` (${detail.asset.photos.length})` : ""}`],
                ] as [Tab, string][]).map(([key, text]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    className={tab === key ? "eqmap-tab eqmap-tab-on" : "eqmap-tab"}
                    onClick={() => setTab(key)}
                  >
                    {text}
                  </button>
                ))}
              </nav>

              {tab === "detail" && (
                <div className="eqmap-pane">
                  <span className={`eq-chip eq-chip-${
                    detail.asset.service.state === "ok" ? "green"
                      : detail.asset.service.state === "due" ? "amber"
                      : detail.asset.service.state === "unknown" ? "grey" : "red"}`}>
                    {SERVICE_STATE_LABELS[detail.asset.service.state]}
                    {detail.asset.service.dueOn ? ` · due ${detail.asset.service.dueOn}` : ""}
                  </span>

                  <dl className="eq-facts">
                    {detail.asset.space && <div><dt>Where</dt><dd>{detail.asset.space.name}</dd></div>}
                    {detail.asset.parent && <div><dt>Inside</dt><dd>
                      <button type="button" className="link-button" onClick={() => void open(detail.asset.parent!.id)}>{detail.asset.parent.name}</button>
                    </dd></div>}
                    {detail.asset.rating && <div><dt>Rating</dt><dd>{detail.asset.rating}</dd></div>}
                    {detail.asset.manufacturer && <div><dt>Make</dt><dd>{detail.asset.manufacturer} {detail.asset.model ?? ""}</dd></div>}
                    {detail.asset.serialNumber && <div><dt>Serial</dt><dd>{detail.asset.serialNumber}</dd></div>}
                    {detail.asset.lastServicedAt && <div><dt>Last serviced</dt><dd>{detail.asset.lastServicedAt.slice(0, 10)}</dd></div>}
                  </dl>
                  {detail.asset.notes && <p className="eq-notes">{detail.asset.notes}</p>}

                  <p className="muted small eqmap-source">
                    {selected?.source === "own"
                      ? "Surveyed: this marker is where somebody put it."
                      : selected?.source === "space"
                        ? "Anchored to the space it is in — the building is placed, this is not."
                        : selected?.source === "parent"
                          ? "Shown where the equipment containing it sits."
                          : "Not placed."}
                  </p>

                  {mayEdit && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      disabled={busy}
                      onClick={() => setPlacing(true)}
                    >
                      {selected?.source === "own" ? "Move the pin" : "Place it on the map"}
                    </button>
                  )}

                  {detail.asset.children.length > 0 && (
                    <>
                      <h3>Inside it</h3>
                      <ul className="eq-chain">
                        {detail.asset.children.map((c) => (
                          <li key={c.id}>
                            <button type="button" className="link-button" onClick={() => void open(c.id)}>{label(c)}</button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}

              {tab === "feeds" && (
                <div className="eqmap-pane">
                  {detail.affects.spaces.length === 0 && detail.asset.relationsOut.length === 0 ? (
                    <p className="muted small">
                      Nothing recorded downstream, so nothing can be said. That is an empty record
                      rather than a safe isolation.
                    </p>
                  ) : (
                    <>
                      <p className="eq-blast-headline">
                        <strong>{detail.affects.spaces.length}</strong> space{detail.affects.spaces.length === 1 ? "" : "s"} affected
                        {detail.affects.sellableCount > 0 && <>, <strong>{detail.affects.sellableCount}</strong> sellable</>}
                      </p>
                      {detail.affects.truncated && (
                        <p className="muted small">The walk hit its depth limit; this list may be incomplete.</p>
                      )}
                      <ul className="eq-affected-rail">
                        {detail.affects.spaces.map((s) => (
                          <li key={s.id}>
                            {s.space ? s.space.path.join(" · ") : s.id}
                            <span className="muted small"> {s.depth === 1 ? "direct" : `${s.depth} hops`}</span>
                          </li>
                        ))}
                      </ul>
                      {detail.affects.assets.length > 0 && (
                        <>
                          <h3>Through</h3>
                          <ul className="eq-chain">
                            {detail.affects.assets.map((a) => (
                              <li key={a.id}>
                                <button type="button" className="link-button" onClick={() => void open(a.id)}>
                                  {a.asset ? label(a.asset) : a.id}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {tab === "fedby" && (
                <div className="eqmap-pane">
                  {detail.fedBy.length === 0 ? (
                    <p className="muted small">Nothing upstream recorded.</p>
                  ) : (
                    <ol className="eq-chain">
                      {detail.fedBy.map((f) => (
                        <li key={f.id}>
                          <button type="button" className="link-button" onClick={() => void open(f.id)}>
                            {f.asset ? label(f.asset) : f.id}
                          </button>
                          <span className="muted small"> · {RELATION_LABELS[f.via] ?? f.via}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {detail.asset.relationsIn.length > 0 && (
                    <>
                      <h3>Everything pointing at it</h3>
                      <ul className="eq-rel-list">
                        {detail.asset.relationsIn.map((r) => (
                          <li key={r.id}>
                            <span className="eq-rel-kind">{RELATION_LABELS[r.kind] ?? r.kind}</span>
                            {r.from && (
                              <button type="button" className="link-button" onClick={() => void open(r.from!.id)}>{label(r.from)}</button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}

              {tab === "photos" && (
                <div className="eqmap-pane">
                  {detail.asset.photos.length === 0 ? (
                    <p className="muted small">
                      No photographs yet. A nameplate and a shot of where it actually is are worth
                      more than most of the fields above.
                    </p>
                  ) : (
                    <div className="eqmap-photos">
                      {detail.asset.photos.map((p) => (
                        <button key={p.id} type="button" className="eqmap-photo" onClick={() => setLightbox(api.photoUrl(p.id))}>
                          <img src={api.photoThumbUrl(p.id)} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}

                  {mayEdit && (
                    <>
                      <input
                        ref={fileInput}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          void refresh(() => api.uploadAssetPhoto(detail.asset.id, file), "Photo added.");
                          e.target.value = "";
                        }}
                      />
                      <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => fileInput.current?.click()}>
                        Add a photo
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* Equipment the map cannot show is said out loud, not hidden. */}
          {map && map.unplaced.length > 0 && (
            <div className="eqmap-unplaced">
              <h3>Not on the map ({map.unplaced.length})</h3>
              <p className="muted small">
                No position of its own, and no placed space to hang off. Give the space
                coordinates, or place these directly.
              </p>
              <ul>
                {map.unplaced.slice(0, 12).map((a) => (
                  <li key={a.id}>
                    <button type="button" className="link-button" onClick={() => void open(a.id)}>{label(a)}</button>
                  </li>
                ))}
              </ul>
              {map.unplaced.length > 12 && <p className="muted small">and {map.unplaced.length - 12} more</p>}
            </div>
          )}
        </aside>
      </div>

      {lightbox && <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
