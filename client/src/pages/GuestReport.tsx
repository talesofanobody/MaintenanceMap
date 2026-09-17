import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { intakeApi } from "../api";
import { BrandMark } from "../App";
import type { Category } from "../types";

const MAX_PHOTOS = 4;

interface Staged {
  id: string;
  file: File;
  previewUrl: string;
}

/** `#/r/<token>` and `#/r/<token>?room=214` — the room lets one QR code per door prefill itself. */
export function parseIntakeHash(hash: string): { token: string; room: string } | null {
  const match = /^#\/r\/([a-zA-Z0-9]+)(\?.*)?$/.exec(hash);
  if (!match) return null;
  const room = match[2] ? new URLSearchParams(match[2].slice(1)).get("room") ?? "" : "";
  return { token: match[1], room };
}

/**
 * The form a guest sees after scanning the code in their room. It has no session, no
 * navigation and no way into the rest of the app: everything it can do is send one
 * report to one property.
 */
export default function GuestReport({ token, room }: { token: string; room: string }) {
  const [state, setState] = useState<"loading" | "ready" | "closed">("loading");
  const [propertyName, setPropertyName] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [closedMessage, setClosedMessage] = useState("");

  const [roomName, setRoomName] = useState(room);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [staged, setStaged] = useState<Staged[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    intakeApi
      .open(token)
      .then((data) => {
        setPropertyName(data.property.name);
        setCategories(data.categories);
        setState("ready");
      })
      .catch((err: Error) => {
        setClosedMessage(err.message);
        setState("closed");
      });
  }, [token]);

  // Object URLs are only valid while the page is open, so let them go on the way out.
  const stagedRef = useRef<Staged[]>([]);
  stagedRef.current = staged;
  useEffect(() => () => stagedRef.current.forEach((s) => URL.revokeObjectURL(s.previewUrl)), []);

  const roomLocked = useMemo(() => room.trim().length > 0, [room]);

  function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const space = MAX_PHOTOS - staged.length;
    if (space <= 0) {
      setError(`You can send up to ${MAX_PHOTOS} photos.`);
      return;
    }
    const next = Array.from(files)
      .slice(0, space)
      .map((file) => ({ id: `${file.name}-${file.lastModified}-${Math.random()}`, file, previewUrl: URL.createObjectURL(file) }));
    setStaged((list) => [...list, ...next]);
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function removePhoto(id: string) {
    setStaged((list) => {
      const going = list.find((s) => s.id === id);
      if (going) URL.revokeObjectURL(going.previewUrl);
      return list.filter((s) => s.id !== id);
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!roomName.trim()) return setError("Which room or area is it in?");
    if (!description.trim()) return setError("Tell us briefly what's wrong.");
    setSending(true);
    setError(null);
    try {
      const result = await intakeApi.submit(token, {
        roomName: roomName.trim(),
        category,
        description: description.trim(),
        photos: staged.map((s) => s.file),
      });
      staged.forEach((s) => URL.revokeObjectURL(s.previewUrl));
      setStaged([]);
      setReference(result.reference);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  function reportAnother() {
    setReference(null);
    setDescription("");
    setCategory("");
    if (!roomLocked) setRoomName("");
  }

  if (state === "loading") {
    return <div className="guest-page guest-page-centred">Loading…</div>;
  }

  if (state === "closed") {
    return (
      <div className="guest-page guest-page-centred">
        <div className="guest-card guest-card-quiet">
          <BrandMark />
          <h1>This link isn't active</h1>
          <p className="muted">{closedMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="guest-page">
      <div className="guest-card">
        <header className="guest-head">
          <BrandMark />
          <div>
            <p className="guest-eyebrow">{propertyName}</p>
            <h1>Report a problem</h1>
          </div>
        </header>

        {reference ? (
          <div className="guest-done">
            <div className="guest-tick" aria-hidden="true">
              ✓
            </div>
            <h2>Thank you — that's with the maintenance team.</h2>
            <p className="muted">
              Your reference is <strong>{reference}</strong>. Someone will review it shortly; you don't need to do anything else.
            </p>
            <button type="button" className="btn btn-secondary" onClick={reportAnother}>
              Report something else
            </button>
          </div>
        ) : (
          <form className="form guest-form" onSubmit={submit}>
            <p className="guest-intro">
              Tell us what needs fixing and we'll take it from here. No account needed — and there's no need to be in the room to
              report it.
            </p>

            <label>
              <span className="field-label">Room or area</span>
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="e.g. Room 214, pool deck, lobby toilets"
                maxLength={120}
                autoComplete="off"
                required
              />
            </label>

            <label>
              <span className="field-label">What sort of problem is it?</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">I'm not sure</option>
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="field-label">What's wrong?</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="The shower runs cold after a minute or two."
                required
              />
            </label>

            <div className="guest-photos">
              <span className="field-label">Photos (optional)</span>
              <p className="muted small">A photo helps us bring the right parts. Up to {MAX_PHOTOS}.</p>
              {staged.length > 0 && (
                <ul className="guest-thumbs">
                  {staged.map((s) => (
                    <li key={s.id}>
                      <img src={s.previewUrl} alt="" />
                      <button type="button" onClick={() => removePhoto(s.id)} aria-label="Remove photo">
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {staged.length < MAX_PHOTOS && (
                <>
                  <button type="button" className="btn btn-secondary btn-block" onClick={() => fileInput.current?.click()}>
                    📷 Add a photo
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    hidden
                    onChange={(e) => addPhotos(e.target.files)}
                  />
                </>
              )}
            </div>

            {error && <div className="banner banner-error">{error}</div>}

            <button type="submit" className="btn btn-primary btn-block" disabled={sending}>
              {sending ? "Sending…" : "Send report"}
            </button>
            <p className="muted small guest-footnote">
              We only keep what you type here and the photos you attach. If it's urgent — water, smoke, anything unsafe — please
              call the front desk instead.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
