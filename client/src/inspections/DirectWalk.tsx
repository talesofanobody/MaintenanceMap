import { useRef, useState } from "react";
import { api } from "../api";
import { preparePhoto } from "./preparePhoto";
import { getFix, locationAllowedHere, locationAlreadyGranted } from "../lib/deviceLocation";
import type { Space, Walkthrough as Walk } from "../types";

/** How many blank boxes appear at a time. */
export const BATCH = 10;

interface Box {
  key: number;
  title: string;
  /** Photographs already uploaded against the walk, waiting to be attached. */
  photoIds: string[];
  thumbs: { id: string; thumbFilename: string | null; filename: string }[];
  /** Set once logged: the issue it became. */
  loggedAs: { id: string; title: string; photos: number } | null;
  busy: boolean;
  error: string | null;
}

let nextKey = 1;
const blanks = (n: number): Box[] =>
  Array.from({ length: n }, () => ({
    key: nextKey++, title: "", photoIds: [], thumbs: [], loggedAs: null, busy: false, error: null,
  }));

/**
 * A walk worked one issue at a time.
 *
 * The other screen is built for covering ground: photograph everything, sort it
 * out in a chair. This one is for the opposite job — standing in a room working
 * through what is wrong with it, where the findings are already obvious and
 * typing a name is quicker than photographing three things and remembering later
 * which shot was which.
 *
 * So the box asks for a name and treats photographs as optional. A light out in a
 * corridor is worth logging whether or not anybody photographed it, and demanding
 * a photo would only teach people to take a pointless one to get past the form.
 *
 * Ten boxes at a time, because a screen of forty empty fields reads as a chore
 * and a screen of one means pressing Add after every finding.
 */
export default function DirectWalk({
  walk, spaces, onChanged,
}: {
  walk: Walk;
  spaces: (Space & { path: string[] })[];
  onChanged: () => void;
}) {
  const [boxes, setBoxes] = useState<Box[]>(() => blanks(BATCH));
  const [spaceId, setSpaceId] = useState(walk.spaceId ?? "");
  const [roomName, setRoomName] = useState(walk.roomName ?? "");
  const [savingPlace, setSavingPlace] = useState(false);
  const [placeNote, setPlaceNote] = useState<string | null>(null);

  // One hidden input per box would be forty inputs; one pair, aimed, is enough.
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const aimedAt = useRef<number | null>(null);

  const patch = (key: number, change: Partial<Box>) =>
    setBoxes((all) => all.map((b) => (b.key === key ? { ...b, ...change } : b)));

  /**
   * The location the next issues belong to. Saved on the walk so it survives a
   * reload, and read back from the answer rather than assumed.
   *
   * `nextRoom` of null means "take the name from the space". That is what moving
   * rooms sends: the text box holds whatever the last room was called, and if it
   * were sent along it would override the room just chosen — the select would say
   * 102 and everything logged would still be filed against 101.
   */
  async function savePlace(nextSpaceId: string, nextRoom: string | null) {
    setSavingPlace(true);
    try {
      const updated = await api.updateWalkthrough(walk.id, {
        spaceId: nextSpaceId || null,
        roomName: nextRoom === null ? null : nextRoom.trim() || null,
      });
      setSpaceId(updated.spaceId ?? "");
      setRoomName(updated.roomName ?? "");
      const where = spaces.find((sp) => sp.id === updated.spaceId)?.path.join(" · ") || updated.roomName || "";
      setPlaceNote(where ? `Logging against ${where}.` : "Location cleared.");
      onChanged();
    } catch (e) {
      setPlaceNote((e as Error).message);
    } finally {
      setSavingPlace(false);
    }
  }

  async function addPhotos(files: FileList | null) {
    const key = aimedAt.current;
    if (!files?.length || key === null) return;
    patch(key, { busy: true, error: null });
    try {
      const prepared = await Promise.all(Array.from(files).map((f) => preparePhoto(f)));

      /**
       * Shrinking costs the photo its EXIF, so its position travels beside it.
       * Where it had none, the phone's does — but only if permission is already
       * given, because a permission prompt between somebody and the shot they
       * just took is how people stop taking them.
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
      const added = await api.addWalkthroughPhotos(walk.id, prepared.map((p) => p.file), places);
      setBoxes((all) =>
        all.map((b) =>
          b.key === key
            ? {
                ...b,
                busy: false,
                photoIds: [...b.photoIds, ...added.map((a) => a.id)],
                thumbs: [...b.thumbs, ...added.map((a) => ({ id: a.id, thumbFilename: a.thumbFilename, filename: a.filename }))],
              }
            : b
        )
      );
    } catch (e) {
      patch(key, { busy: false, error: (e as Error).message });
    } finally {
      aimedAt.current = null;
      if (cameraRef.current) cameraRef.current.value = "";
      if (libraryRef.current) libraryRef.current.value = "";
    }
  }

  function shoot(key: number, which: "camera" | "library") {
    aimedAt.current = key;
    (which === "camera" ? cameraRef : libraryRef).current?.click();
  }

  async function log(box: Box) {
    if (!box.title.trim() || box.loggedAs) return;
    patch(box.key, { busy: true, error: null });
    try {
      const issue = await api.logWalkthroughIssue(walk.id, {
        title: box.title.trim(),
        photoIds: box.photoIds,
      });
      patch(box.key, {
        busy: false,
        loggedAs: { id: issue.id, title: issue.title, photos: box.photoIds.length },
      });
      onChanged();
    } catch (e) {
      patch(box.key, { busy: false, error: (e as Error).message });
    }
  }

  async function removePhoto(key: number, photoId: string) {
    try {
      await api.deletePhoto(photoId);
      setBoxes((all) =>
        all.map((b) =>
          b.key === key
            ? { ...b, photoIds: b.photoIds.filter((p) => p !== photoId), thumbs: b.thumbs.filter((t) => t.id !== photoId) }
            : b
        )
      );
      onChanged();
    } catch (e) {
      patch(key, { error: (e as Error).message });
    }
  }

  const logged = boxes.filter((b) => b.loggedAs).length;
  const open = boxes.filter((b) => !b.loggedAs);
  const place = spaces.find((s) => s.id === spaceId)?.path.join(" · ") || roomName.trim();

  return (
    <div className="direct-walk">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
      <input ref={libraryRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => addPhotos(e.target.files)} />

      {/* ---- where you are ------------------------------------------- */}
      <section className="card direct-place">
        <div className="direct-place-head">
          <h2>Where you are</h2>
          {place && <span className="muted small">{place}</span>}
        </div>
        <div className="form direct-place-form">
          <label>
            Location
            <select
              value={spaceId}
              onChange={(e) => { setSpaceId(e.target.value); void savePlace(e.target.value, null); }}
              disabled={savingPlace}
            >
              <option value="">Not from the list</option>
              {spaces.map((s) => <option key={s.id} value={s.id}>{s.path.join(" · ")}</option>)}
            </select>
          </label>
          <label>
            Or type it
            <input
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              onBlur={() => void savePlace(spaceId, roomName)}
              placeholder="Pool plant room"
              maxLength={120}
            />
          </label>
        </div>
        <p className="muted small">
          {placeNote ?? "Everything logged below is filed here. Change it when you move on and the next ones follow."}
        </p>
      </section>

      {/* ---- the boxes ------------------------------------------------ */}
      <section className="direct-boxes">
        <div className="direct-boxes-head">
          <h2>What is wrong here</h2>
          <span className="muted small">
            {logged > 0 ? `${logged} logged` : "A name is enough. Photos help but are not required."}
          </span>
        </div>

        <ul className="direct-list">
          {boxes.map((box, i) => (
            <li key={box.key} className={box.loggedAs ? "direct-box direct-box-done" : "direct-box"}>
              {box.loggedAs ? (
                <div className="direct-done">
                  <span className="direct-tick" aria-hidden="true">✓</span>
                  <span className="direct-done-title">{box.loggedAs.title}</span>
                  <span className="muted small">
                    logged{box.loggedAs.photos > 0 ? ` · ${box.loggedAs.photos} photo${box.loggedAs.photos === 1 ? "" : "s"}` : ""}
                  </span>
                </div>
              ) : (
                <>
                  <span className="direct-num" aria-hidden="true">{i + 1}</span>
                  <div className="direct-fields">
                    <input
                      className="direct-title"
                      value={box.title}
                      onChange={(e) => patch(box.key, { title: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") void log(box); }}
                      placeholder="What is wrong?"
                      maxLength={200}
                      disabled={box.busy}
                    />

                    {box.thumbs.length > 0 && (
                      <div className="direct-thumbs">
                        {box.thumbs.map((t) => (
                          <span key={t.id} className="direct-thumb">
                            <img src={api.photoThumbUrl(t.id)} alt="" loading="lazy" />
                            <button
                              type="button"
                              className="direct-thumb-x"
                              aria-label="Remove photo"
                              onClick={() => void removePhoto(box.key, t.id)}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="direct-actions">
                      <button type="button" className="btn btn-secondary btn-small" disabled={box.busy} onClick={() => shoot(box.key, "camera")}>
                        {box.thumbs.length ? "Another photo" : "Photo"}
                      </button>
                      <button type="button" className="btn btn-ghost btn-small" disabled={box.busy} onClick={() => shoot(box.key, "library")}>
                        Library
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-small"
                        disabled={box.busy || !box.title.trim()}
                        onClick={() => void log(box)}
                      >
                        {box.busy ? "…" : "Log it"}
                      </button>
                      {box.error && <span className="direct-error small">{box.error}</span>}
                    </div>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>

        <div className="direct-more">
          <button type="button" className="btn btn-secondary" onClick={() => setBoxes((all) => [...all, ...blanks(BATCH)])}>
            Add {BATCH} more
          </button>
          <span className="muted small">
            {open.length} blank{open.length === 1 ? "" : "s"} left
          </span>
        </div>
      </section>
    </div>
  );
}
