import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { Property } from "../types";

interface Props {
  properties: Property[];
  onChange: (properties: Property[]) => void;
}

/** The address a guest's phone opens. Built from wherever the app is being served. */
export function intakeUrl(token: string, room?: string): string {
  const base = `${window.location.origin}${window.location.pathname}#/r/${token}`;
  return room?.trim() ? `${base}?room=${encodeURIComponent(room.trim())}` : base;
}

/**
 * Where an admin turns guest reporting on for a property and gets the link to hand out.
 * One link covers the whole property; adding a room to it prefills that field, which is
 * what makes a code per door worth printing.
 */
export default function IntakeLinks({ properties, onChange }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [printing, setPrinting] = useState<Property | null>(null);

  async function update(property: Property, data: { enabled?: boolean; rotate?: boolean }) {
    setBusyId(property.id);
    setError(null);
    try {
      const result = await api.setPropertyIntake(property.id, data);
      onChange(properties.map((p) => (p.id === property.id ? { ...p, intakeEnabled: result.intakeEnabled, intakeToken: result.intakeToken } : p)));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function copy(property: Property) {
    if (!property.intakeToken) return;
    try {
      await navigator.clipboard.writeText(intakeUrl(property.intakeToken));
      setCopiedId(property.id);
      setTimeout(() => setCopiedId((id) => (id === property.id ? null : id)), 2000);
    } catch {
      setError("Couldn't copy — select the link and copy it by hand.");
    }
  }

  return (
    <section className="intake-links">
      <h2>Reporting links</h2>
      <p className="muted">
        Anyone with a property's link can send a report without signing in. They can't see anything else — not your issues, not
        your other properties, not even this one's address.
      </p>

      {error && <div className="banner banner-error">{error}</div>}

      <ul className="intake-list">
        {properties.map((property) => (
          <li key={property.id} className="intake-row">
            <div className="intake-row-main">
              <div>
                <strong>{property.name}</strong>
                <span className={`intake-state ${property.intakeEnabled ? "is-open" : "is-closed"}`}>{property.intakeEnabled ? "Open" : "Closed"}</span>
              </div>
              <div className="intake-row-actions">
                <button
                  type="button"
                  className={`btn btn-small ${property.intakeEnabled ? "btn-secondary" : "btn-primary"}`}
                  disabled={busyId === property.id}
                  onClick={() => update(property, { enabled: !property.intakeEnabled })}
                >
                  {property.intakeEnabled ? "Turn off" : "Turn on"}
                </button>
              </div>
            </div>

            {property.intakeEnabled && property.intakeToken && (
              <div className="intake-row-link">
                <input readOnly value={intakeUrl(property.intakeToken)} onFocus={(e) => e.currentTarget.select()} aria-label={`Guest link for ${property.name}`} />
                <button type="button" className="btn btn-secondary btn-small" onClick={() => copy(property)}>
                  {copiedId === property.id ? "Copied" : "Copy"}
                </button>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => setPrinting(property)}>
                  Print codes
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-small danger"
                  disabled={busyId === property.id}
                  onClick={() => {
                    if (confirm("Make a new link? Every code already printed and put up stops working.")) update(property, { rotate: true });
                  }}
                >
                  New link
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {printing && <PrintCodes property={printing} onClose={() => setPrinting(null)} />}
    </section>
  );
}

/**
 * Builds the cards that go on the wall. A blank room list gives one card for the whole
 * property; typing rooms gives one per room, each with the room already filled in.
 */
function PrintCodes({ property, onClose }: { property: Property; onClose: () => void }) {
  const [roomsText, setRoomsText] = useState("");
  const [codes, setCodes] = useState<{ room: string; dataUrl: string }[]>([]);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rooms = roomsText
    .split(/[\n,]/)
    .map((r) => r.trim())
    .filter(Boolean);

  useEffect(() => {
    if (!property.intakeToken) return;
    let cancelled = false;
    setBuilding(true);
    const targets = rooms.length ? rooms.slice(0, 200) : [""];
    // The QR encoder is a few tens of kilobytes, so it only loads when someone prints.
    import("qrcode")
      .then(async ({ default: QRCode }) => {
        const made = await Promise.all(
          targets.map(async (room) => ({
            room,
            dataUrl: await QRCode.toDataURL(intakeUrl(property.intakeToken!, room), { width: 512, margin: 1, errorCorrectionLevel: "M" }),
          }))
        );
        if (!cancelled) setCodes(made);
      })
      .catch(() => !cancelled && setError("Couldn't draw the codes. The link above still works on its own."))
      .finally(() => !cancelled && setBuilding(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property.intakeToken, roomsText]);

  // Printed through a portal on <body>, so the print stylesheet can hide the whole app
  // and leave nothing on the page but the cards.
  useEffect(() => {
    document.body.classList.add("printing-codes");
    return () => document.body.classList.remove("printing-codes");
  }, []);

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal intake-print" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Print reporting codes">
        <div className="modal-head no-print">
          <h3>Codes for {property.name}</h3>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="form no-print">
          <label>
            <span className="field-label">Rooms (optional, one per line)</span>
            <textarea
              value={roomsText}
              onChange={(e) => setRoomsText(e.target.value)}
              rows={3}
              placeholder={"101\n102\nPool deck"}
            />
          </label>
          <p className="muted small">
            {rooms.length === 0
              ? "One card for the whole property — the guest types where they are."
              : `${rooms.length} card${rooms.length === 1 ? "" : "s"}, each with the room already filled in.`}
          </p>
          {error && <div className="banner banner-error">{error}</div>}
          <div className="request-actions">
            <button type="button" className="btn btn-primary btn-small" disabled={building || codes.length === 0} onClick={() => window.print()}>
              {building ? "Drawing…" : "Print"}
            </button>
          </div>
        </div>

        <div className="intake-cards">
          {codes.map((code) => (
            <div className="intake-card" key={code.room || "property"}>
              <p className="intake-card-title">Something not right?</p>
              <img src={code.dataUrl} alt="" />
              <p className="intake-card-room">{code.room ? code.room : property.name}</p>
              <p className="intake-card-hint">Scan to tell maintenance. No app, no account.</p>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
