import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useCurrentUser } from "../auth/AuthContext";
import { formatDateTime } from "../lib/dates";
import { getFix, locationAllowedHere, locationAlreadyGranted } from "../lib/deviceLocation";
import { preparePhoto } from "./preparePhoto";
import type { Property, Technician, Walkthrough as Walk } from "../types";

/**
 * Walk the building, photograph what you find, sort it out afterwards.
 *
 * The whole design rests on one observation: nobody writes up a finding while
 * standing in front of it. They photograph it and move on, because the round has
 * to be finished. So this page asks for nothing at the moment of capture — point,
 * shoot, keep walking — and puts the whole cost of describing things at the end,
 * where there is a chair.
 *
 * Grouping is what turns a pile of photographs back into work: pick the shots
 * that are the same problem, and they become one issue with the evidence already
 * attached, waiting for a description.
 */

function elapsed(from: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(from).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

/** Shown while a walk is under way. Four steps, in the order they happen. */
function HowItWorks() {
  return (
    <ol className="walk-steps">
      <li>
        <b>Walk and shoot.</b> Take as many photos as you need — they all land here, and nothing
        asks you to type anything while you are on your feet.
      </li>
      <li>
        <b>Pick the ones that are the same problem.</b> Three shots of one cracked tile are one
        finding, not three.
      </li>
      <li>
        <b>Press Group.</b> Those photos become a single issue, positioned from the photo's own
        location, with the pictures already attached.
      </li>
      <li>
        <b>Describe it afterwards.</b> Open the issue and add what is wrong, how urgent it is and
        who should look at it — exactly like any other issue.
      </li>
    </ol>
  );
}

export default function Walkthrough() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useCurrentUser();

  const [properties, setProperties] = useState<Property[]>([]);
  const [team, setTeam] = useState<Technician[]>([]);
  const [open, setOpen] = useState<Walk[] | null>(null);
  const [walk, setWalk] = useState<Walk | null>(null);
  const [propertyId, setPropertyId] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [areas, setAreas] = useState("");
  const [notes, setNotes] = useState("");
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listProperties().then((rows) => {
      setProperties(rows);
      setPropertyId((current) => current || rows[0]?.id || "");
    }).catch(() => setProperties([]));
    if (!user?.technicianId) {
      api.listTechnicians().then((rows) => setTeam(rows.filter((t) => t.active))).catch(() => setTeam([]));
    }
  }, [user?.technicianId]);

  const load = useCallback(() => {
    if (!id) {
      api.listWalkthroughs({ state: "open" })
        .then((rows) => setOpen(rows as unknown as Walk[]))
        .catch(() => setOpen([]));
      return;
    }
    api.getWalkthrough(id)
      .then((w) => {
        setWalk(w);
        setAreas(w.areas ?? "");
        setNotes(w.notes ?? "");
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(load, [load]);

  async function start() {
    setError(null);
    setBusy("starting");
    try {
      /**
       * The phone's position, but only if it has already been allowed. Asking at
       * the moment somebody presses Start means a permission dialogue between
       * them and the round they came here to walk — and the photographs carry
       * their own coordinates anyway. This is the fallback, not the source.
       */
      let fix: { lat: number; lng: number } | undefined;
      if (locationAllowedHere() && (await locationAlreadyGranted())) {
        fix = await getFix(6000).then((f) => ({ lat: f.lat, lng: f.lng })).catch(() => undefined);
      }
      const created = await api.startWalkthrough({
        propertyId,
        ...(technicianId ? { technicianId } : {}),
        ...(fix ?? {}),
      });
      navigate(`/walkthrough/${created.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length || !walk) return;
    setError(null);
    setBusy(`Sending ${files.length} photo${files.length === 1 ? "" : "s"}…`);
    try {
      const prepared = await Promise.all(Array.from(files).map((f) => preparePhoto(f)));

      /**
       * Shrinking costs the photo its EXIF, so its position has to travel beside
       * it. Where the photo had none of its own, the phone's does instead — one
       * fix for the batch, taken only if permission is already given, because a
       * permission prompt between someone and the shot they just took is how
       * people stop taking them.
       */
      let fix: { lat: number; lng: number } | null = null;
      if (prepared.some((p) => p.gpsLat == null) && locationAllowedHere() && (await locationAlreadyGranted())) {
        fix = await getFix(4000).then((f) => ({ lat: f.lat, lng: f.lng })).catch(() => null);
      }
      const places = prepared.map((p) =>
        p.gpsLat != null && p.gpsLng != null
          ? { lat: p.gpsLat, lng: p.gpsLng, source: "exif" as const, takenAt: p.takenAt }
          : fix
            ? { lat: fix.lat, lng: fix.lng, source: "device" as const, takenAt: p.takenAt }
            : null
      );
      await api.addWalkthroughPhotos(walk.id, prepared.map((p) => p.file), places);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      if (cameraRef.current) cameraRef.current.value = "";
      if (libraryRef.current) libraryRef.current.value = "";
    }
  }

  function toggle(photoId: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }

  async function group() {
    if (!walk || picked.size === 0) return;
    setError(null);
    setBusy("Making the issue…");
    try {
      await api.groupWalkthroughPhotos(walk.id, [...picked]);
      setPicked(new Set());
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save(state?: "completed") {
    if (!walk) return;
    setError(null);
    setBusy(state ? "Finishing…" : "Saving…");
    try {
      const updated = await api.updateWalkthrough(walk.id, { areas, notes, ...(state ? { state } : {}) });
      setWalk(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function removePhoto(photoId: string) {
    if (!confirm("Delete this photo?")) return;
    try {
      await api.deletePhoto(photoId);
      setPicked((c) => {
        const next = new Set(c);
        next.delete(photoId);
        return next;
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // ---- Starting one ------------------------------------------------------
  if (!id) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <h1>Walk-through</h1>
            <p className="muted">
              Cover the ground with a phone, photograph what you find, then turn the photos into
              issues when you sit down.
            </p>
          </div>
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        <section className="card walk-start">
          <h2>Start a walk-through</h2>
          <div className="form walk-start-form">
            <label>
              Property
              <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            {!user?.technicianId && team.length > 0 && (
              <label>
                Walked by
                <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
                  <option value="">Me ({user?.username})</option>
                  {team.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <button type="button" className="btn btn-primary" onClick={start} disabled={!propertyId || busy !== null}>
            {busy === "starting" ? "Starting…" : "Start walking"}
          </button>
          <p className="muted small">The date, the time and who walked it are recorded from this moment.</p>
        </section>

        <section className="card">
          <h2>How it works</h2>
          <HowItWorks />
        </section>

        {open && open.length > 0 && (
          <section className="walk-open">
            <h2>Still under way</h2>
            <ul className="insp-cards">
              {open.map((w) => (
                <li key={w.id} className="insp-card status-in_progress">
                  <div className="insp-card-main">
                    <Link to={`/walkthrough/${w.id}`} className="insp-card-title">{w.property.name}</Link>
                    <p className="muted small">
                      {w.walkedBy} · started {formatDateTime(w.startedAt)} · {elapsed(w.startedAt)} ago
                    </p>
                  </div>
                  <div className="insp-card-counts">
                    <span><strong>{w._count?.photos ?? 0}</strong> photos</span>
                    <span><strong>{w._count?.issues ?? 0}</strong> issues</span>
                  </div>
                  <div className="insp-card-actions">
                    <Link to={`/walkthrough/${w.id}`} className="btn btn-primary btn-small">Carry on</Link>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  if (!walk) {
    return (
      <div className="page">
        {error ? <div className="banner banner-error">{error}</div> : <p className="loading-state">Loading…</p>}
      </div>
    );
  }

  const finished = !!walk.completedAt;

  // ---- Walking it --------------------------------------------------------
  return (
    <div className="page walk-page">
      <div className="page-header">
        <div>
          <h1>{walk.property.name}</h1>
          <p className="muted">
            Walked by <b>{walk.walkedBy}</b> · started {formatDateTime(walk.startedAt)}
            {finished ? ` · finished ${formatDateTime(walk.completedAt!)}` : ` · ${elapsed(walk.startedAt)} so far`}
          </p>
        </div>
        <div className="page-header-actions">
          <Link to="/walkthrough" className="btn btn-ghost btn-small">All walk-throughs</Link>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {finished && <div className="banner">This walk-through is finished. It is kept as the record of what was covered.</div>}

      {!finished && (
        <section className="walk-capture">
          <div className="walk-capture-actions">
            <button type="button" className="btn btn-primary btn-large" onClick={() => cameraRef.current?.click()} disabled={busy !== null}>
              Take a photo
            </button>
            <button type="button" className="btn btn-secondary btn-large" onClick={() => libraryRef.current?.click()} disabled={busy !== null}>
              Add from library
            </button>
            {busy && <span className="muted small">{busy}</span>}
          </div>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={(e) => addPhotos(e.target.files)}
          />
          <input
            ref={libraryRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            hidden
            onChange={(e) => addPhotos(e.target.files)}
          />
          <details className="walk-help">
            <summary>How this works</summary>
            <HowItWorks />
          </details>
        </section>
      )}

      <section className="walk-shots">
        <div className="walk-shots-head">
          <h2>Photos not yet grouped {walk.photos.length > 0 && <span className="muted">({walk.photos.length})</span>}</h2>
          {picked.size > 0 && (
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setPicked(new Set())}>
              Clear selection
            </button>
          )}
        </div>

        {walk.photos.length === 0 ? (
          <p className="empty-state">
            {finished ? "Everything was grouped into issues." : "No photos yet. Take one and it appears here."}
          </p>
        ) : (
          <ul className="walk-grid">
            {walk.photos.map((photo) => {
              const on = picked.has(photo.id);
              return (
                <li key={photo.id} className={`walk-shot${on ? " is-picked" : ""}`}>
                  <button
                    type="button"
                    className="walk-shot-hit"
                    onClick={() => toggle(photo.id)}
                    aria-pressed={on}
                    aria-label={on ? "Deselect this photo" : "Select this photo"}
                  >
                    <img src={api.photoThumbUrl(photo.id)} alt="" loading="lazy" />
                    <span className="walk-tick" aria-hidden="true">{on ? "✓" : ""}</span>
                  </button>
                  {photo.hasGps && <span className="walk-geo" title="This photo carries its own location">◎</span>}
                  {!finished && (
                    <button type="button" className="walk-shot-x" onClick={() => removePhoto(photo.id)} aria-label="Delete this photo">
                      ×
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {walk.issues.length > 0 && (
        <section className="walk-made">
          <h2>Issues from this walk <span className="muted">({walk.issues.length})</span></h2>
          <ul className="insp-cards">
            {walk.issues.map((issue) => (
              <li key={issue.id} className="insp-card">
                <div className="insp-card-main">
                  <Link to={`/properties/${walk.propertyId}?issue=${issue.id}`} className="insp-card-title">
                    {issue.title}
                  </Link>
                  <p className="muted small">
                    {issue.description
                      ? issue.description.slice(0, 90)
                      : "No description yet — open it and say what is wrong."}
                  </p>
                </div>
                <div className="insp-card-counts">
                  <span><strong>{issue.photos.length}</strong> photos</span>
                </div>
                <div className="insp-card-actions">
                  <Link to={`/properties/${walk.propertyId}?issue=${issue.id}`} className="btn btn-secondary btn-small">
                    {issue.description ? "Open" : "Add details"}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card walk-finish">
        <h2>{finished ? "What was covered" : "Finish the walk-through"}</h2>
        <div className="form">
          <label>
            Areas covered
            <input
              value={areas}
              onChange={(e) => setAreas(e.target.value)}
              placeholder="Floors 12–14, pool deck, back of house"
              disabled={finished}
            />
          </label>
          <label>
            Notes <span className="muted">(optional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} disabled={finished} />
          </label>
        </div>
        {!finished && (
          <div className="walk-finish-actions">
            <button type="button" className="btn btn-secondary" onClick={() => save()} disabled={busy !== null}>
              Save progress
            </button>
            <button type="button" className="btn btn-primary" onClick={() => save("completed")} disabled={busy !== null}>
              Finish walk-through
            </button>
            {walk.photos.length > 0 && (
              <span className="muted small">
                {walk.photos.length} photo{walk.photos.length === 1 ? "" : "s"} still ungrouped — they stay on the record either way.
              </span>
            )}
          </div>
        )}
      </section>

      {/* The one action that needs to follow you down the page. */}
      {picked.size > 0 && !finished && (
        <div className="walk-groupbar" role="region" aria-label="Group the selected photos">
          <span>
            <strong>{picked.size}</strong> photo{picked.size === 1 ? "" : "s"} selected
          </span>
          <button type="button" className="btn btn-primary" onClick={group} disabled={busy !== null}>
            Group into an issue
          </button>
        </div>
      )}
    </div>
  );
}
