import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import { TIME_OFF_LABELS, type TechnicianLocation } from "../types";
import { boundsOf } from "../lib/geo";
import { initials } from "../lib/capacity";
import { SATELLITE_ATTRIBUTION, SATELLITE_URL } from "./PropertyWorkspace";

const DEFAULT_CENTER: [number, number] = [20, 0];

/**
 * A pin per technician, dimmed as the reading gets older, so a stale position never
 * looks like a live one.
 */
function personIcon(person: TechnicianLocation): L.DivIcon {
  const stale = (person.ageMinutes ?? 0) > 120;
  const ring = person.state === "working" ? person.color : "#94a3b8";
  return L.divIcon({
    className: "crew-pin-wrap",
    html: `<div class="crew-pin ${person.state} ${stale ? "is-stale" : ""}" style="--pin:${ring}">
        <span>${initials(person.name)}</span>
        ${person.state === "working" ? '<i class="crew-pulse"></i>' : ""}
      </div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -18],
  });
}

function FitToCrew({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 18);
    else if (points.length > 1) map.fitBounds(boundsOf(points), { padding: [48, 48] });
    // Only on the first load with data; after that the view is the viewer's to control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length > 0]);
  return null;
}

function ageText(person: TechnicianLocation): string {
  if (person.ageMinutes === null) return "no clock-ins today";
  if (person.ageMinutes < 1) return "just now";
  if (person.ageMinutes < 60) return `${person.ageMinutes}m ago`;
  const hours = Math.round(person.ageMinutes / 60);
  return `${hours}h ago`;
}

/**
 * Where the crew probably are. This is worked out from clock-ins — the job someone is
 * on, or the last one they finished — not from anybody's phone. It is an informed guess
 * and the page says so, because a confident wrong pin is worse than an honest vague one.
 */
export default function CrewMap() {
  const [people, setPeople] = useState<TechnicianLocation[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .technicianLocations()
      .then((r) => {
        setPeople(r.technicians);
        setGeneratedAt(r.generatedAt);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  const located = useMemo(() => people.filter((p) => p.lat !== null && p.lng !== null), [people]);
  const points = useMemo(() => located.map((p) => [p.lat!, p.lng!] as [number, number]), [located]);
  const working = people.filter((p) => p.state === "working");
  const away = people.filter((p) => p.state === "away");
  const unknown = people.filter((p) => p.state === "unknown");

  return (
    <div className="page crewmap-page">
      <div className="page-header">
        <div>
          <h1>Where the crew are</h1>
          <p className="muted">
            Worked out from clock-ins — the job someone is on, or the last one they finished today. Nobody's phone is tracked, so
            treat an older pin as "was here", not "is here".
          </p>
        </div>
        <div className="crewmap-stats">
          <span className="crewmap-stat">
            <strong>{working.length}</strong> on a job
          </span>
          <span className="crewmap-stat">
            <strong>{people.length - working.length - away.length - unknown.length}</strong> last seen
          </span>
          <span className="crewmap-stat">
            <strong>{away.length}</strong> away
          </span>
          <span className="crewmap-stat muted">
            <strong>{unknown.length}</strong> not clocked in
          </span>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {loading && !people.length ? (
        <div className="loading-state">Loading…</div>
      ) : (
        <div className="crewmap-body">
          <div className="crewmap-map">
            {located.length === 0 ? (
              <div className="empty-state">
                <p>Nobody has clocked into a job today.</p>
                <p className="muted">Positions come from clock-ins, so the map fills up as the crew start work.</p>
              </div>
            ) : (
              <MapContainer center={points[0] ?? DEFAULT_CENTER} zoom={points.length ? 17 : 3} className="map" scrollWheelZoom>
                <TileLayer url={SATELLITE_URL} attribution={SATELLITE_ATTRIBUTION} maxZoom={22} maxNativeZoom={19} />
                <FitToCrew points={points} />
                {located.map((person) => (
                  <Marker key={person.id} position={[person.lat!, person.lng!]} icon={personIcon(person)}>
                    <Popup>
                      <strong>{person.name}</strong>
                      {person.trade ? <div className="muted small">{person.trade}</div> : null}
                      <div className="small">
                        {person.state === "working" ? "On this job now" : "Last worked here"} · {ageText(person)}
                      </div>
                      {person.issue && (
                        <div className="small">
                          <Link to={`/properties/${person.issue.propertyId}?issue=${person.issue.id}`}>{person.issue.title}</Link>
                          <div className="muted">
                            {person.issue.property}
                            {person.issue.roomName ? ` · ${person.issue.roomName}` : ""}
                          </div>
                        </div>
                      )}
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            )}
          </div>

          <aside className="crewmap-list">
            <h2>Everyone</h2>
            <ul>
              {people.map((person) => (
                <li key={person.id} className={`crewmap-row state-${person.state}`}>
                  <span className="crew-dot" style={{ background: person.color }} aria-hidden="true" />
                  <span className="crewmap-who">
                    <strong>{person.name}</strong>
                    <span className="muted small">{person.trade}</span>
                  </span>
                  <span className="crewmap-state">
                    {person.state === "away" && person.timeOff ? (
                      TIME_OFF_LABELS[person.timeOff.kind]
                    ) : person.state === "working" ? (
                      <>
                        On a job · <span className="muted">{ageText(person)}</span>
                      </>
                    ) : person.state === "last_seen" ? (
                      <>
                        Last seen · <span className="muted">{ageText(person)}</span>
                      </>
                    ) : (
                      <span className="muted">Not clocked in</span>
                    )}
                    {person.issue && <span className="muted small crewmap-job">{person.issue.title}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {generatedAt && <p className="muted small">Refreshes every 30 seconds. Last checked {new Date(generatedAt).toLocaleTimeString()}.</p>}
          </aside>
        </div>
      )}
    </div>
  );
}
