import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { readPhotoGps } from "../lib/photoGps";
import { dateInputToIso, formatDateTime, formatDuration, toDateInputValue } from "../lib/dates";
import type { Issue, Photo, Priority, Status } from "../types";
import { PRIORITIES, PRIORITY_SHORT_LABELS, STATUSES, STATUS_LABELS } from "../types";
import PhotoLightbox from "./PhotoLightbox";

interface StagedPhoto {
  id: string;
  file: File;
  previewUrl: string | null;
  converting: boolean;
}

interface Props {
  propertyId: string;
  issue: Issue | null;
  draftLatLng: { lat: number; lng: number } | null;
  onRequestReposition: () => void;
  onLocationDetected: (lat: number, lng: number) => void;
  onClose: () => void;
  onSaved: () => void;
}

function isHeicFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type === "image/heic" || file.type === "image/heif" || name.endsWith(".heic") || name.endsWith(".heif");
}

// Browsers other than Safari can't display HEIC, so staged iPhone photos get a
// lazily-loaded client-side conversion just for the preview thumbnail.
async function makePreview(file: File): Promise<string | null> {
  if (!isHeicFile(file)) return URL.createObjectURL(file);
  try {
    const { default: heic2any } = await import("heic2any");
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.5 });
    const blob = Array.isArray(out) ? out[0] : out;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function looksLikeUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

export default function IssuePanel({ propertyId, issue, draftLatLng, onRequestReposition, onLocationDetected, onClose, onSaved }: Props) {
  const isEdit = !!issue;
  const [title, setTitle] = useState(issue?.title ?? "");
  const [description, setDescription] = useState(issue?.description ?? "");
  const [actionNeeded, setActionNeeded] = useState(issue?.actionNeeded ?? "");
  const [priority, setPriority] = useState<Priority>(issue?.priority ?? "medium");
  const [status, setStatus] = useState<Status>(issue?.status ?? "pending");
  const [workOrderCreated, setWorkOrderCreated] = useState(issue?.workOrderCreated ?? false);
  const [workOrderNumber, setWorkOrderNumber] = useState(issue?.workOrderNumber ?? "");
  const [workOrderUrl, setWorkOrderUrl] = useState(issue?.workOrderUrl ?? "");
  const [comments, setComments] = useState(issue?.comments ?? "");
  const [closedDate, setClosedDate] = useState(toDateInputValue(issue?.closedAt));
  const [closedDateTouched, setClosedDateTouched] = useState(false);
  const [lat, setLat] = useState<number | null>(issue?.lat ?? draftLatLng?.lat ?? null);
  const [lng, setLng] = useState<number | null>(issue?.lng ?? draftLatLng?.lng ?? null);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<Photo[]>(issue?.photos ?? []);
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const stagedRef = useRef<StagedPhoto[]>([]);
  stagedRef.current = staged;

  useEffect(() => {
    return () => {
      for (const s of stagedRef.current) {
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
      }
    };
  }, []);

  const effectiveLat = draftLatLng?.lat ?? lat;
  const effectiveLng = draftLatLng?.lng ?? lng;
  const hasLocation = effectiveLat !== null && effectiveLng !== null;
  const photoCount = staged.length + existingPhotos.length;
  const urlValid = looksLikeUrl(workOrderUrl);
  const closedIso = status === "completed" ? (closedDateTouched || !issue?.closedAt ? dateInputToIso(closedDate) : issue.closedAt) : null;

  async function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setError(null);

    if (!isEdit && lat === null && !draftLatLng) {
      const gps = await readPhotoGps(files[0]);
      if (gps) {
        setLat(gps.latitude);
        setLng(gps.longitude);
        setLocationNote("Pin placed from this photo's GPS data — you can still move it on the map.");
        onLocationDetected(gps.latitude, gps.longitude);
      }
    }

    if (isEdit && issue) {
      setUploading((n) => n + files.length);
      for (const file of files) {
        try {
          const photo = await api.uploadPhoto(issue.id, file);
          setExistingPhotos((prev) => [photo, ...prev]);
        } catch (err: any) {
          setError(err.message);
        } finally {
          setUploading((n) => n - 1);
        }
      }
      return;
    }

    const entries: StagedPhoto[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: null,
      converting: true,
    }));
    setStaged((prev) => [...prev, ...entries]);
    for (const entry of entries) {
      const previewUrl = await makePreview(entry.file);
      setStaged((prev) => prev.map((s) => (s.id === entry.id ? { ...s, previewUrl, converting: false } : s)));
    }
  }

  function removeStaged(id: string) {
    setStaged((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((s) => s.id !== id);
    });
  }

  async function removeExistingPhoto(id: string) {
    if (!confirm("Remove this photo?")) return;
    await api.deletePhoto(id);
    setExistingPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  function changeStatus(next: Status) {
    setStatus(next);
    if (next === "completed" && !issue?.closedAt && !closedDateTouched) {
      setClosedDate(toDateInputValue(null));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const finalLat = draftLatLng?.lat ?? lat;
    const finalLng = draftLatLng?.lng ?? lng;

    if (!title.trim()) {
      setError("Give the issue a short title.");
      return;
    }
    if (finalLat === null || finalLng === null) {
      setError("Set a location: tap the map to place the pin, or add a photo taken on-site.");
      return;
    }
    if (workOrderCreated && !urlValid) {
      setError("The EAM link doesn't look like a web address.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        actionNeeded: actionNeeded.trim() || undefined,
        priority,
        status,
        workOrderCreated,
        workOrderNumber: workOrderCreated ? workOrderNumber.trim() || undefined : undefined,
        workOrderUrl: workOrderCreated ? workOrderUrl.trim() || null : null,
        comments: comments.trim() || undefined,
        lat: finalLat,
        lng: finalLng,
        closedAt: closedIso,
      };

      if (isEdit && issue) {
        await api.updateIssue(issue.id, payload);
      } else {
        const created = await api.createIssue({ propertyId, ...payload });
        for (const s of staged) {
          await api.uploadPhoto(created.id, s.file);
        }
      }
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!issue) return;
    if (!confirm("Delete this issue and its photos?")) return;
    await api.deleteIssue(issue.id);
    onSaved();
    onClose();
  }

  return (
    <div className="side-panel">
      <div className="side-panel-grip" aria-hidden="true" />
      <div className="side-panel-header">
        <h2>{isEdit ? "Edit issue" : "New issue"}</h2>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <form className="form" onSubmit={handleSubmit}>
        <div className={`location-box ${hasLocation ? "is-set" : "is-unset"}`}>
          <div className="location-box-text">
            <strong>{hasLocation ? "Pin placed" : "No location yet"}</strong>
            <span className="muted small">
              {hasLocation ? `${effectiveLat!.toFixed(5)}, ${effectiveLng!.toFixed(5)}` : "Tap the map, or add a photo taken on-site"}
            </span>
            {locationNote && <span className="hint">{locationNote}</span>}
          </div>
          <button type="button" className="btn btn-small" onClick={onRequestReposition}>
            {hasLocation ? "Move pin" : "Place pin"}
          </button>
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Roof leak, north corner" autoFocus />
        </label>

        <div className="field">
          <span className="field-label">
            Photos{photoCount > 0 && <span className="field-count">{photoCount}</span>}
          </span>
          {photoCount > 0 && (
            <div className="photo-grid">
              {staged.map((s) => (
                <div className="photo-thumb" key={s.id}>
                  {s.previewUrl ? (
                    <img src={s.previewUrl} alt="" onClick={() => setLightbox(s.previewUrl)} />
                  ) : (
                    <div className="photo-placeholder">{s.converting ? "Preparing…" : "HEIC"}</div>
                  )}
                  <button type="button" className="photo-remove" onClick={() => removeStaged(s.id)} aria-label="Remove photo">
                    ✕
                  </button>
                </div>
              ))}
              {existingPhotos.map((p) => (
                <div className="photo-thumb" key={p.id}>
                  <img src={api.photoThumbUrl(p.id)} alt="" onClick={() => setLightbox(api.photoUrl(p.id))} />
                  <button type="button" className="photo-remove" onClick={() => removeExistingPhoto(p.id)} aria-label="Remove photo">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <label className="btn btn-secondary file-btn">
            <input type="file" accept="image/*,.heic,.heif" multiple onChange={handleFiles} />
            📷 {photoCount > 0 ? "Add more photos" : "Add photos"}
          </label>
          {uploading > 0 ? (
            <span className="hint">Uploading {uploading} photo{uploading === 1 ? "" : "s"}…</span>
          ) : (
            <span className="muted small">JPEG, PNG and iPhone HEIC photos are all fine. Tap a photo to view it full-size.</span>
          )}
        </div>

        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What's wrong?" />
        </label>

        <label>
          What needs to be done
          <textarea value={actionNeeded} onChange={(e) => setActionNeeded(e.target.value)} rows={2} placeholder="Repair steps / scope of work" />
        </label>

        <div className="field">
          <span className="field-label">Priority</span>
          <div className="chip-group" role="radiogroup" aria-label="Priority">
            {PRIORITIES.map((p) => (
              <button
                type="button"
                key={p}
                role="radio"
                aria-checked={priority === p}
                className={`chip chip-priority-${p} ${priority === p ? "selected" : ""}`}
                onClick={() => setPriority(p)}
              >
                {PRIORITY_SHORT_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Status</span>
          <div className="chip-group" role="radiogroup" aria-label="Status">
            {STATUSES.map((s) => (
              <button
                type="button"
                key={s}
                role="radio"
                aria-checked={status === s}
                className={`chip chip-status-${s} ${status === s ? "selected" : ""}`}
                onClick={() => changeStatus(s)}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="timeline-box">
          <div className="timeline-row">
            <span className="timeline-label">Logged</span>
            <span>{issue ? formatDateTime(issue.createdAt) : "When you save this issue"}</span>
          </div>
          {status === "completed" ? (
            <>
              <label className="timeline-row timeline-input">
                <span className="timeline-label">Closed on</span>
                <input
                  type="date"
                  value={closedDate}
                  max={toDateInputValue(null)}
                  onChange={(e) => {
                    setClosedDate(e.target.value);
                    setClosedDateTouched(true);
                  }}
                />
              </label>
              {issue && closedIso && (
                <div className="timeline-row">
                  <span className="timeline-label">Resolved in</span>
                  <span className="timeline-strong">{formatDuration(issue.createdAt, closedIso)}</span>
                </div>
              )}
            </>
          ) : (
            issue && (
              <div className="timeline-row">
                <span className="timeline-label">Open for</span>
                <span className="timeline-strong">{formatDuration(issue.createdAt)}</span>
              </div>
            )
          )}
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={workOrderCreated} onChange={(e) => setWorkOrderCreated(e.target.checked)} />
          Work order created
        </label>
        {workOrderCreated && (
          <div className="work-order-fields">
            <label>
              Work order number
              <input value={workOrderNumber} onChange={(e) => setWorkOrderNumber(e.target.value)} placeholder="e.g. WO-2024-118" />
            </label>
            <label>
              EAM link <span className="muted">(optional)</span>
              <input
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={workOrderUrl}
                onChange={(e) => setWorkOrderUrl(e.target.value)}
                placeholder="Paste the work order's page from your EAM"
                className={workOrderUrl && !urlValid ? "is-invalid" : ""}
              />
            </label>
            {workOrderUrl && urlValid && (
              <a className="eam-link" href={/^[a-z]+:\/\//i.test(workOrderUrl.trim()) ? workOrderUrl.trim() : `https://${workOrderUrl.trim()}`} target="_blank" rel="noopener noreferrer">
                Open {workOrderNumber.trim() || "work order"} in EAM ↗
              </a>
            )}
          </div>
        )}

        <label>
          Comments
          <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2} placeholder="Additional notes" />
        </label>

        <div className="side-panel-actions">
          <button type="submit" className="btn btn-primary" disabled={saving || uploading > 0}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create issue"}
          </button>
          {isEdit && (
            <button type="button" className="btn btn-danger" onClick={handleDelete}>
              Delete
            </button>
          )}
        </div>
      </form>

      {lightbox && <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
