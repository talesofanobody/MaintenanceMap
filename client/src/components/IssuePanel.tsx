import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import TimeLog from "../time/TimeLog";
import Checklist from "./Checklist";
import CostPanel from "./CostPanel";
import MessageThread from "./MessageThread";
import { offlineSupported, queueIssue } from "../offline/queue";
import { CATEGORIES, categoryLabel, MAX_ASSIGNEES, type Tag } from "../types";
import { readPhotoGps } from "../lib/photoGps";
import { dateInputToIso, formatDateTime, formatDuration, toDateInputValue } from "../lib/dates";
import { capacityOn, committedOn, defaultDueDate, describeWindow, formatHours, relativeDay, slaProgress, timeLeftPhrase, todayStr } from "../lib/capacity";
import { useSettings } from "../settings/SettingsContext";
import type { ActivityEntry, GuestReport, Issue, Photo, Priority, Status, Technician } from "../types";
import { PRIORITIES, PRIORITY_LABELS, PRIORITY_SHORT_LABELS, STATUSES, STATUS_LABELS } from "../types";
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
  /** Set when this new issue is being created by accepting a guest report. */
  intakeReport?: GuestReport | null;
  draftLatLng: { lat: number; lng: number } | null;
  // Admins edit everything; technicians only status, hours, notes and photos on their own issues.
  canManage: boolean;
  currentTechnicianId?: string | null;
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

function parseHours(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** "Today"/"Tomorrow" read better lowercased mid-sentence; formatted dates keep their case. */
/** "today" / "tomorrow" stand alone; a date needs "on". */
function whenPhrase(day: string): string {
  const label = relativeDay(day || todayStr()).toLowerCase();
  return /^(today|tomorrow|yesterday)$/.test(label) ? label : `on ${label}`;
}

function softDay(day: string): string {
  const r = relativeDay(day);
  return /^(Today|Tomorrow|Yesterday)$/.test(r) ? r.toLowerCase() : r;
}

/**
 * A guest writes prose, not a title. The first sentence is nearly always the thing that
 * is wrong, so it becomes the title and the reviewer edits it if it isn't.
 */
function titleFromDescription(description: string): string {
  const firstSentence = description.split(/(?<=[.!?])\s/)[0]?.trim() ?? description.trim();
  const text = firstSentence.replace(/\s+/g, " ");
  if (text.length <= 70) return text.replace(/[.]$/, "");
  return `${text.slice(0, 67).trimEnd()}…`;
}

export default function IssuePanel({
  propertyId,
  issue,
  intakeReport,
  draftLatLng,
  canManage,
  currentTechnicianId,
  onRequestReposition,
  onLocationDetected,
  onClose,
  onSaved,
}: Props) {
  const isEdit = !!issue;
  // A technician can edit their own issues (limited fields) and log new ones.
  const ownIssue =
    !!issue &&
    !!currentTechnicianId &&
    (issue.technicianId === currentTechnicianId || !!issue.assignees?.some((a) => a.technicianId === currentTechnicianId));
  const canEdit = canManage || !isEdit || ownIssue;
  const limited = !canManage;
  const [title, setTitle] = useState(issue?.title ?? (intakeReport ? titleFromDescription(intakeReport.description) : ""));
  const [description, setDescription] = useState(issue?.description ?? intakeReport?.description ?? "");
  const [actionNeeded, setActionNeeded] = useState(issue?.actionNeeded ?? "");
  const [priority, setPriority] = useState<Priority>(issue?.priority ?? "medium");
  const [status, setStatus] = useState<Status>(issue?.status ?? "pending");
  const [workOrderCreated, setWorkOrderCreated] = useState(issue?.workOrderCreated ?? false);
  const [workOrderNumber, setWorkOrderNumber] = useState(issue?.workOrderNumber ?? "");
  const [workOrderUrl, setWorkOrderUrl] = useState(issue?.workOrderUrl ?? "");
  // On a new issue this becomes the opening message; on an existing one the thread owns it.
  const [firstMessage, setFirstMessage] = useState("");
  const { responseHours, warnAtPercent } = useSettings();
  const [closedDate, setClosedDate] = useState(toDateInputValue(issue?.closedAt));
  const [closedDateTouched, setClosedDateTouched] = useState(false);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  // The whole crew, lead first. A crew of one behaves exactly as the old single field did.
  const [crew, setCrew] = useState<string[]>(() => {
    if (issue?.assignees?.length) return issue.assignees.map((a) => a.technicianId);
    if (issue?.technicianId) return [issue.technicianId];
    return limited && currentTechnicianId ? [currentTechnicianId] : [];
  });
  const technicianId = crew[0] ?? "";
  const setTechnicianId = (id: string) => setCrew(id ? [id, ...crew.slice(1).filter((x) => x !== id)] : crew.slice(1));
  const [isEmergency, setIsEmergency] = useState(issue?.isEmergency ?? false);
  const [estimatedHours, setEstimatedHours] = useState(issue?.estimatedHours != null ? String(issue.estimatedHours) : "");
  const [actualHours, setActualHours] = useState(issue?.actualHours != null ? String(issue.actualHours) : "");
  const [category, setCategory] = useState(issue?.category ?? intakeReport?.category ?? "");
  const [roomName, setRoomName] = useState(issue?.roomName ?? intakeReport?.roomName ?? "");
  const [rooms, setRooms] = useState<string[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagIds, setTagIds] = useState<string[]>(issue?.tags?.map((t) => t.tagId) ?? []);
  const [scheduledFor, setScheduledFor] = useState(issue?.scheduledFor ?? "");
  const [dueDate, setDueDate] = useState(issue?.dueDate ?? (issue ? "" : defaultDueDate("medium", null, responseHours)));
  const [dueTouched, setDueTouched] = useState(!!issue);
  const [lat, setLat] = useState<number | null>(issue?.lat ?? draftLatLng?.lat ?? null);
  const [lng, setLng] = useState<number | null>(issue?.lng ?? draftLatLng?.lng ?? null);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<Photo[]>(issue?.photos ?? intakeReport?.photos ?? []);
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<ActivityEntry[]>([]);
  const stagedRef = useRef<StagedPhoto[]>([]);
  stagedRef.current = staged;

  useEffect(() => {
    return () => {
      for (const s of stagedRef.current) {
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    api
      .listTechnicians()
      .then(setTechnicians)
      .catch(() => setTechnicians([]));
    api
      .listTags()
      .then((r) => setTags(r.tags.filter((t) => t.active)))
      .catch(() => setTags([]));
  }, []);

  // Rooms already used at this property, offered as suggestions rather than a fixed list.
  useEffect(() => {
    api
      .listRooms(propertyId)
      .then(setRooms)
      .catch(() => setRooms([]));
  }, [propertyId]);

  useEffect(() => {
    if (!issue) return;
    api
      .listActivity({ issueId: issue.id, limit: 30 })
      .then(setTimeline)
      .catch(() => setTimeline([]));
  }, [issue]);

  // Until the user picks a due date themselves, keep it in step with the priority's
  // response window, counted from the start date (or today).
  useEffect(() => {
    if (!dueTouched) setDueDate(defaultDueDate(priority, scheduledFor || null, responseHours));
  }, [priority, scheduledFor, dueTouched, responseHours]);

  const effectiveLat = draftLatLng?.lat ?? lat;
  const effectiveLng = draftLatLng?.lng ?? lng;
  const hasLocation = effectiveLat !== null && effectiveLng !== null;
  const photoCount = staged.length + existingPhotos.length;
  const urlValid = looksLikeUrl(workOrderUrl);
  const closedIso = status === "completed" ? (closedDateTouched || !issue?.closedAt ? dateInputToIso(closedDate) : issue.closedAt) : null;

  const selectableTechs = technicians.filter((t) => t.active || t.id === technicianId);
  const selectedTech = technicians.find((t) => t.id === technicianId) ?? null;

  // Who should pick this up: someone who covers the category, with the most room left on
  // the start day. Only a suggestion — the dropdown still offers everyone.
  const suggestions = useMemo(() => {
    if (!category) return [];
    const day = scheduledFor || todayStr();
    return technicians
      .filter((t) => t.active && t.categories?.includes(category))
      .map((t) => {
        const capacity = capacityOn(t.weeklyHours, day);
        const committed = committedOn(t.assignments, day, issue?.id);
        return { tech: t, free: Math.max(0, capacity - committed), capacity, open: t.assignments.length };
      })
      .sort((a, b) => b.free - a.free || a.open - b.open || a.tech.name.localeCompare(b.tech.name));
  }, [category, technicians, scheduledFor, issue?.id]);

  const topSuggestion = suggestions.find((entry) => entry.tech.id !== technicianId) ?? null;
  const estimate = parseHours(estimatedHours);
  let capacityHint: { text: string; tone: "ok" | "warn" } | null = null;
  if (selectedTech && scheduledFor && canManage) {
    const capacity = capacityOn(selectedTech.weeklyHours, scheduledFor);
    const committed = committedOn(selectedTech.assignments, scheduledFor, issue?.id);
    const free = capacity - committed;
    const after = free - (estimate ?? 0);
    const day = relativeDay(scheduledFor, todayStr());
    if (capacity === 0) {
      capacityHint = { text: `${selectedTech.name} isn't scheduled to work on ${day}.`, tone: "warn" };
    } else if (after < 0) {
      capacityHint = {
        text: `${selectedTech.name} only has ${formatHours(Math.max(0, free))} free on ${day} (${formatHours(committed)} of ${formatHours(capacity)} already scheduled) — this would overbook by ${formatHours(-after)}.`,
        tone: "warn",
      };
    } else {
      capacityHint = {
        text: `${selectedTech.name} has ${formatHours(free)} free on ${day} (${formatHours(committed)} of ${formatHours(capacity)} scheduled)${estimate ? ` — ${formatHours(after)} left after this` : ""}.`,
        tone: "ok",
      };
    }
  }

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
    if (next === "completed" && issue?.checklist?.some((c) => !c.done)) {
      const left = issue.checklist.filter((c) => !c.done).length;
      if (!confirm(`${left} checklist step${left === 1 ? " isn't" : "s aren't"} ticked yet. Mark the issue completed anyway?`)) return;
    }
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
    if (estimatedHours.trim() !== "" && estimate === null) {
      setError("Estimated hours must be a number.");
      return;
    }
    if (dueDate && scheduledFor && dueDate < scheduledFor) {
      setError("The due date can't be before the start date.");
      return;
    }

    setSaving(true);
    try {
      const full = {
        title: title.trim(),
        description: description.trim() || undefined,
        actionNeeded: actionNeeded.trim() || undefined,
        priority,
        status,
        workOrderCreated,
        workOrderNumber: workOrderCreated ? workOrderNumber.trim() || undefined : undefined,
        workOrderUrl: workOrderCreated ? workOrderUrl.trim() || null : null,
        category: category || null,
        roomName: roomName.trim() || null,
        tagIds,
        lat: finalLat,
        lng: finalLng,
        closedAt: closedIso,
        technicianIds: crew,
        isEmergency,
        estimatedHours: estimate,
        ...(status === "completed" ? { actualHours: parseHours(actualHours) } : {}),
        scheduledFor: scheduledFor || null,
        dueDate: dueDate || null,
      };

      if (isEdit && issue) {
        const payload = limited
          ? {
              status,
              closedAt: closedIso,
              ...(status === "completed" ? { actualHours: parseHours(actualHours) } : {}),
              description: description.trim() || null,
              actionNeeded: actionNeeded.trim() || null,
              category: category || null,
              roomName: roomName.trim() || null,
              tagIds,
            }
          : full;
        await api.updateIssue(issue.id, payload as Partial<Issue>);
      } else if (!navigator.onLine && offlineSupported()) {
        // No connection: keep the issue (and its photos) on the device and send it later.
        await queueIssue({
          propertyId,
          payload: {
            title: full.title,
            description: full.description ?? null,
            actionNeeded: full.actionNeeded ?? null,
            priority,
            status,
            category: category || null,
            roomName: roomName.trim() || null,
            lat: finalLat,
            lng: finalLng,
            technicianId: technicianId || null,
            estimatedHours: estimate,
            scheduledFor: scheduledFor || null,
            dueDate: dueDate || null,
          },
          photos: staged.map((s) => ({ name: s.file.name, type: s.file.type, blob: s.file })),
        });
      } else {
        const created = await api.createIssue({
          propertyId,
          ...full,
          firstMessage: firstMessage.trim() || undefined,
          // The server moves the guest's photos onto the issue and marks the report accepted.
          ...(intakeReport ? { guestReportId: intakeReport.id } : {}),
        });
        for (const s of staged) {
          await api.uploadPhoto(created.id, s.file);
        }
      }
      onSaved();
      onClose();
    } catch (err: any) {
      // A create that failed because the network dropped mid-save is still worth keeping.
      const networkDown = !isEdit && offlineSupported() && (!navigator.onLine || /fetch|network|load failed/i.test(err?.message ?? ""));
      if (networkDown) {
        try {
          await queueIssue({
            propertyId,
            payload: {
              title: title.trim(),
              description: description.trim() || null,
              actionNeeded: actionNeeded.trim() || null,
              priority,
              status,
              category: category || null,
              roomName: roomName.trim() || null,
              lat: finalLat,
              lng: finalLng,
              technicianId: technicianId || null,
              estimatedHours: estimate,
              scheduledFor: scheduledFor || null,
              dueDate: dueDate || null,
            },
            photos: staged.map((s) => ({ name: s.file.name, type: s.file.type, blob: s.file })),
          });
          onSaved();
          onClose();
          return;
        } catch {
          setError("Couldn't reach the server and couldn't save this on the device either.");
        }
      } else {
        setError(err.message);
      }
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

  const lock = limited && isEdit;
  const risk = issue ? slaProgress(issue, new Date(), warnAtPercent) : null;
  const riskState = risk?.state ?? "none";

  return (
    <div className="side-panel">
      <div className="side-panel-grip" aria-hidden="true" />
      <div className="side-panel-header">
        <h2>{isEdit ? (canEdit ? "Edit issue" : "Issue") : intakeReport ? "Accept guest report" : "New issue"}</h2>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {isEdit && issue && risk && riskState === "warning" && (
        <div className="banner banner-warn">
          {Math.round(risk.fraction * 100)}% of the {describeWindow(responseHours[issue.priority])} allowed has gone —{" "}
          {timeLeftPhrase(risk.hoursLeft)}.
        </div>
      )}
      {isEdit && issue && riskState === "overdue" && (
        <div className="banner banner-error">
          Overdue — {timeLeftPhrase(risk!.hoursLeft)}, due {relativeDay(issue.dueDate!).toLowerCase()}.
        </div>
      )}
      {isEdit && !canEdit && (
        <div className="banner banner-info">This issue is assigned to {issue.technician?.name ?? "someone else"} — you can view it but not change it.</div>
      )}
      {isEdit && issue?.guestReport && (
        <div className="banner banner-info intake-banner">
          <strong>Reported by a guest</strong>
          <span>
            {issue.guestReport.roomName} · {formatDateTime(issue.guestReport.createdAt)}
            {issue.guestReport.reviewedBy && ` · accepted by ${issue.guestReport.reviewedBy}`}
          </span>
        </div>
      )}
      {intakeReport && (
        <div className="banner banner-info intake-banner">
          <strong>From a guest report</strong>
          <span>
            {intakeReport.roomName} · {formatDateTime(intakeReport.createdAt)}
            {intakeReport.photos.length > 0 && ` · ${intakeReport.photos.length} photo${intakeReport.photos.length === 1 ? "" : "s"}`}
          </span>
          <span className="muted small">
            Their words and photos are below — change anything that needs changing. Saving creates the issue and marks the report
            accepted; closing without saving leaves it in the queue.
          </span>
        </div>
      )}

      <form className="form" onSubmit={handleSubmit}>
        <div className={`location-box ${hasLocation ? "is-set" : "is-unset"}`}>
          <div className="location-box-text">
            <strong>{hasLocation ? "Pin placed" : "No location yet"}</strong>
            <span className="muted small">
              {hasLocation ? `${effectiveLat!.toFixed(5)}, ${effectiveLng!.toFixed(5)}` : "Tap the map, or add a photo taken on-site"}
            </span>
            {locationNote && <span className="hint">{locationNote}</span>}
          </div>
          {!lock && (
            <button type="button" className="btn btn-small" onClick={onRequestReposition}>
              {hasLocation ? "Move pin" : "Place pin"}
            </button>
          )}
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Roof leak, north corner" autoFocus={!lock} readOnly={lock} />
        </label>

        {canEdit && (
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
                    {/* A guest's photos still belong to their report until it is accepted,
                        so there is nothing to remove here yet. */}
                    {!intakeReport && (
                      <button type="button" className="photo-remove" onClick={() => removeExistingPhoto(p.id)} aria-label="Remove photo">
                        ✕
                      </button>
                    )}
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
        )}
        {!canEdit && existingPhotos.length > 0 && (
          <div className="photo-grid">
            {existingPhotos.map((p) => (
              <div className="photo-thumb" key={p.id}>
                <img src={api.photoThumbUrl(p.id)} alt="" onClick={() => setLightbox(api.photoUrl(p.id))} />
              </div>
            ))}
          </div>
        )}

        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What's wrong?" readOnly={!canEdit} />
        </label>

        <label>
          What needs to be done
          <textarea value={actionNeeded} onChange={(e) => setActionNeeded(e.target.value)} rows={2} placeholder="Repair steps / scope of work" readOnly={!canEdit} />
        </label>

        {isEdit && issue && <Checklist issue={issue} editable={canEdit} onChanged={onSaved} />}

        <div className="form-row">
          <label>
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={!canEdit}>
              <option value="">Not set</option>
              {CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Room / location <span className="muted">(optional)</span>
            <input
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              list={`rooms-${propertyId}`}
              placeholder="e.g. Room 214, Pool plant room"
              maxLength={120}
              readOnly={!canEdit}
            />
            <datalist id={`rooms-${propertyId}`}>
              {rooms.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </label>
        </div>

        {(tags.length > 0 || tagIds.length > 0) && (
          <div className="field">
            <span className="field-label">Tags</span>
            <div className="tag-picker">
              {tags.map((tag) => {
                const on = tagIds.includes(tag.id);
                return (
                  <button
                    type="button"
                    key={tag.id}
                    className={`tag-chip ${on ? "on" : ""}`}
                    style={on ? { background: tag.color, borderColor: tag.color } : { borderColor: tag.color, color: tag.color }}
                    aria-pressed={on}
                    disabled={!canEdit}
                    onClick={() => setTagIds((ids) => (on ? ids.filter((id) => id !== tag.id) : [...ids, tag.id]))}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="field">
          <span className="field-label">Priority</span>
          {lock ? (
            <span className={`pill pill-${priority}`}>{PRIORITY_LABELS[priority]}</span>
          ) : (
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
          )}
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
                onClick={() => canEdit && changeStatus(s)}
                disabled={!canEdit}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {lock ? (
          <div className="assignment-box readonly">
            <span className="field-label">Schedule &amp; assignment</span>
            <span>
              {scheduledFor ? `Start ${softDay(scheduledFor)}` : "No start date"} · {dueDate ? `due ${softDay(dueDate)}` : "no due date"}
            </span>
            <span className="muted small">
              {selectedTech ? `Assigned to ${selectedTech.name}` : issue?.technician ? `Assigned to ${issue.technician.name}` : "Unassigned"}
              {estimate != null ? ` · estimate ${formatHours(estimate)}` : ""}
            </span>
          </div>
        ) : (
          <div className="assignment-box">
            <span className="field-label">Schedule</span>
            <div className="form-row">
              <label>
                Start date
                <input type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
              </label>
              <label>
                Due date
                <input
                  type="date"
                  value={dueDate}
                  min={scheduledFor || undefined}
                  onChange={(e) => {
                    setDueDate(e.target.value);
                    setDueTouched(true);
                  }}
                  className={dueDate && scheduledFor && dueDate < scheduledFor ? "is-invalid" : ""}
                />
              </label>
            </div>
            <span className="muted small">
              {dueTouched
                ? `${PRIORITY_SHORT_LABELS[priority]} work has ${describeWindow(responseHours[priority])} to be resolved.`
                : `Deadline set from the priority (${describeWindow(responseHours[priority])}) — change it if you need to.`}
            </span>
            <span className="field-label">Assignment</span>
            {topSuggestion && !limited && (
              <div className="suggestion">
                <span>
                  <strong>{topSuggestion.tech.name}</strong> covers {categoryLabel(category).toLowerCase()}
                  {topSuggestion.capacity > 0
                    ? ` and has ${formatHours(topSuggestion.free)} free ${whenPhrase(scheduledFor)}`
                    : ` but isn't working ${whenPhrase(scheduledFor)}`}
                  .
                </span>
                <button type="button" className="btn btn-small btn-secondary" onClick={() => setTechnicianId(topSuggestion.tech.id)}>
                  Assign
                </button>
              </div>
            )}
            {category && suggestions.length === 0 && canManage && (
              <span className="muted small">Nobody is set up to cover {categoryLabel(category).toLowerCase()} — set who covers what on the Technicians page.</span>
            )}
            <div className="field">
              <span className="field-label">
                Technicians <span className="muted small">— up to {MAX_ASSIGNEES}, the first one leads</span>
              </span>
              {crew.length > 0 && (
                <ul className="crew-list">
                  {crew.map((id, index) => {
                    const t = technicians.find((x) => x.id === id);
                    return (
                      <li key={id} className="crew-member">
                        <span className="crew-dot" style={{ background: t?.color ?? "var(--text-3)" }} aria-hidden="true" />
                        <span className="crew-name">
                          {t?.name ?? "Unknown"}
                          {t?.trade ? <span className="muted"> · {t.trade}</span> : null}
                        </span>
                        {index === 0 ? (
                          <span className="crew-lead">Lead</span>
                        ) : (
                          canManage && (
                            <button type="button" className="crew-action" onClick={() => setCrew([id, ...crew.filter((x) => x !== id)])}>
                              Make lead
                            </button>
                          )
                        )}
                        {canManage && (
                          <button type="button" className="crew-action danger" onClick={() => setCrew(crew.filter((x) => x !== id))} aria-label={`Remove ${t?.name ?? "technician"}`}>
                            ✕
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {canManage && crew.length < MAX_ASSIGNEES && (
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setCrew([...crew, e.target.value]);
                  }}
                  aria-label="Add a technician"
                >
                  <option value="">{crew.length === 0 ? "Unassigned — pick someone" : "Add another…"}</option>
                  {selectableTechs
                    .filter((t) => !crew.includes(t.id))
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.trade ? ` — ${t.trade}` : ""}
                        {category && t.categories?.includes(category) ? " ✓" : ""}
                        {!t.active ? " (inactive)" : ""}
                      </option>
                    ))}
                </select>
              )}
              {canManage && crew.length >= MAX_ASSIGNEES && (
                <span className="muted small">That's {MAX_ASSIGNEES} — any more and it's really two jobs.</span>
              )}
              {limited && crew.length === 0 && <span className="muted small">Log it unassigned, or put yourself on it from Today.</span>}
            </div>
            {canManage && (
              <label className="checkbox-row">
                <input type="checkbox" checked={isEmergency} onChange={(e) => setIsEmergency(e.target.checked)} />
                Emergency — goes to the front of the day and pushes other work back
              </label>
            )}
            {technicians.length === 0 && canManage && (
              <span className="muted small">No technicians yet — add them under Technicians in the top menu.</span>
            )}
            <label>
              Estimated hours
              <input type="number" min={0} step={0.5} inputMode="decimal" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} placeholder="e.g. 2" />
            </label>
            {capacityHint && <span className={`hint ${capacityHint.tone === "warn" ? "hint-warn" : ""}`}>{capacityHint.text}</span>}
          </div>
        )}

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
                  disabled={!canEdit}
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
              <label className="timeline-row timeline-input">
                <span className="timeline-label">Actual hours</span>
                <input
                  type="number"
                  min={0}
                  step={0.25}
                  inputMode="decimal"
                  value={actualHours}
                  disabled={!canEdit}
                  onChange={(e) => setActualHours(e.target.value)}
                  placeholder={estimate ? `est. ${estimate}` : "e.g. 1.5"}
                />
              </label>
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

        {isEdit && issue && <CostPanel issue={issue} editable={canEdit} onChanged={onSaved} />}

        {isEdit && issue && (
          <TimeLog
            issue={issue}
            currentTechnicianId={currentTechnicianId}
            canManage={canManage}
            onChanged={(what) => {
              // Clocking in moves a pending issue to in progress on the server; mirror it so a
              // later Save doesn't push the stale status back.
              if (what === "in" && status === "pending") changeStatus("in_progress");
              onSaved();
            }}
          />
        )}

        {lock ? (
          workOrderCreated && (
            <div className="work-order-fields">
              <span className="field-label">Work order</span>
              <span>
                {workOrderNumber || "Raised"}
                {workOrderUrl && (
                  <>
                    {" · "}
                    <a className="eam-link" href={workOrderUrl} target="_blank" rel="noopener noreferrer">
                      Open in EAM ↗
                    </a>
                  </>
                )}
              </span>
            </div>
          )
        ) : (
          <>
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
          </>
        )}

        {isEdit && issue ? (
          <MessageThread issue={issue} canPost={canEdit} />
        ) : (
          <label>
            First message <span className="muted">(optional)</span>
            <textarea
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
              rows={2}
              placeholder="Anything the person picking this up should know"
            />
          </label>
        )}

        {canEdit && (
          <div className="side-panel-actions">
            <button type="submit" className="btn btn-primary" disabled={saving || uploading > 0}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create issue"}
            </button>
            {isEdit && canManage && (
              <button type="button" className="btn btn-danger" onClick={handleDelete}>
                Delete
              </button>
            )}
          </div>
        )}
      </form>

      {isEdit && timeline.length > 0 && (
        <div className="issue-timeline">
          <span className="field-label">History</span>
          <ul>
            {timeline.map((e) => (
              <li key={e.id}>
                <span className="issue-timeline-when">{formatDateTime(e.at)}</span>
                <span className="issue-timeline-who">{e.username}</span>
                <span className="issue-timeline-what">{e.summary.replace(/^"[^"]*":\s*/, "")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lightbox && <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
