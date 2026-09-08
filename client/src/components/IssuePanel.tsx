import { ChangeEvent, FormEvent, useState } from "react";
import exifr from "exifr";
import { api } from "../api";
import type { Issue, Priority, Status } from "../types";
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from "../types";

interface StagedPhoto {
  file: File;
  previewUrl: string;
}

interface Props {
  propertyId: string;
  issue: Issue | null;
  draftLatLng: { lat: number; lng: number } | null;
  onRequestReposition: () => void;
  onClose: () => void;
  onSaved: () => void;
}

export default function IssuePanel({ propertyId, issue, draftLatLng, onRequestReposition, onClose, onSaved }: Props) {
  const isEdit = !!issue;
  const [title, setTitle] = useState(issue?.title ?? "");
  const [description, setDescription] = useState(issue?.description ?? "");
  const [actionNeeded, setActionNeeded] = useState(issue?.actionNeeded ?? "");
  const [priority, setPriority] = useState<Priority>(issue?.priority ?? "medium");
  const [status, setStatus] = useState<Status>(issue?.status ?? "pending");
  const [workOrderCreated, setWorkOrderCreated] = useState(issue?.workOrderCreated ?? false);
  const [workOrderNumber, setWorkOrderNumber] = useState(issue?.workOrderNumber ?? "");
  const [comments, setComments] = useState(issue?.comments ?? "");
  const [lat, setLat] = useState<number | null>(issue?.lat ?? draftLatLng?.lat ?? null);
  const [lng, setLng] = useState<number | null>(issue?.lng ?? draftLatLng?.lng ?? null);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [existingPhotos, setExistingPhotos] = useState(issue?.photos ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveLat = draftLatLng?.lat ?? lat;
  const effectiveLng = draftLatLng?.lng ?? lng;

  async function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    if (!isEdit && lat === null && !draftLatLng) {
      const first = files[0];
      try {
        const gps = await exifr.gps(first);
        if (gps) {
          setLat(gps.latitude);
          setLng(gps.longitude);
          setLocationNote("Location set from this photo's GPS data. You can still reposition it on the map.");
        }
      } catch {
        // no GPS data in file; user can place a pin manually
      }
    }

    if (isEdit && issue) {
      for (const file of files) {
        try {
          const photo = await api.uploadPhoto(issue.id, file);
          setExistingPhotos((prev) => [photo, ...prev]);
        } catch (err: any) {
          setError(err.message);
        }
      }
    } else {
      setStaged((prev) => [...prev, ...files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))]);
    }
    e.target.value = "";
  }

  function removeStaged(idx: number) {
    setStaged((prev) => prev.filter((_, i) => i !== idx));
  }

  async function removeExistingPhoto(id: string) {
    await api.deletePhoto(id);
    setExistingPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const finalLat = draftLatLng?.lat ?? lat;
    const finalLng = draftLatLng?.lng ?? lng;

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (finalLat === null || finalLng === null) {
      setError("Set a location by clicking the map or uploading a geotagged photo.");
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
        comments: comments.trim() || undefined,
        lat: finalLat,
        lng: finalLng,
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
      <div className="side-panel-header">
        <h2>{isEdit ? "Edit Issue" : "New Issue"}</h2>
        <button className="btn-icon" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <form className="form" onSubmit={handleSubmit}>
        <div className="location-box">
          <strong>Location</strong>
          {effectiveLat !== null && effectiveLng !== null ? (
            <span className="muted small">
              {effectiveLat.toFixed(6)}, {effectiveLng.toFixed(6)}
            </span>
          ) : (
            <span className="muted small">Not set</span>
          )}
          <button type="button" className="btn btn-small" onClick={onRequestReposition}>
            {effectiveLat !== null ? "Reposition on map" : "Click map to place pin"}
          </button>
          {locationNote && <p className="hint">{locationNote}</p>}
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Roof leak, north corner" autoFocus />
        </label>

        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What's the issue?" />
        </label>

        <label>
          What needs to be done
          <textarea value={actionNeeded} onChange={(e) => setActionNeeded(e.target.value)} rows={2} placeholder="Repair steps / scope of work" />
        </label>

        <div className="form-row">
          <label>
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={workOrderCreated} onChange={(e) => setWorkOrderCreated(e.target.checked)} />
          Work order created
        </label>
        {workOrderCreated && (
          <label>
            Work order number
            <input value={workOrderNumber} onChange={(e) => setWorkOrderNumber(e.target.value)} placeholder="e.g. WO-2024-118" />
          </label>
        )}

        <label>
          Comments
          <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2} placeholder="Additional notes" />
        </label>

        <label>
          Photos
          <input type="file" accept="image/*" multiple onChange={handleFiles} />
        </label>

        {staged.length > 0 && (
          <div className="photo-grid">
            {staged.map((s, i) => (
              <div className="photo-thumb" key={i}>
                <img src={s.previewUrl} alt="" />
                <button type="button" className="photo-remove" onClick={() => removeStaged(i)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {existingPhotos.length > 0 && (
          <div className="photo-grid">
            {existingPhotos.map((p) => (
              <div className="photo-thumb" key={p.id}>
                <img src={api.photoUrl(p.id)} alt="" />
                <button type="button" className="photo-remove" onClick={() => removeExistingPhoto(p.id)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="side-panel-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Issue"}
          </button>
          {isEdit && (
            <button type="button" className="btn btn-danger" onClick={handleDelete}>
              Delete Issue
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
