import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import PhotoLightbox from "../components/PhotoLightbox";
import {
  categoryLabel,
  OUTCOME_LABELS,
  OUTCOMES,
  SEVERITIES,
  SEVERITY_LABELS,
  type Inspection,
  type InspectionCheck,
  type Outcome,
  type Severity,
} from "../types";

/** Lines grouped back into the sections they came from, in walk order. */
function bySection(checks: InspectionCheck[]): { name: string; checks: InspectionCheck[] }[] {
  const out: { name: string; checks: InspectionCheck[] }[] = [];
  for (const check of [...checks].sort((a, b) => a.position - b.position)) {
    const last = out[out.length - 1];
    if (last && last.name === check.section) last.checks.push(check);
    else out.push({ name: check.section, checks: [check] });
  }
  return out;
}

/**
 * One line of the walk. Three big targets — fine, flag it, not applicable — because
 * this is used one-handed, standing up, often with a phone in the other hand.
 */
function CheckRow({
  check,
  propertyId,
  editable,
  onChange,
  onPhoto,
  onRemove,
  onView,
}: {
  check: InspectionCheck;
  propertyId: string;
  editable: boolean;
  onChange: (patch: Parameters<typeof api.updateCheck>[1]) => void;
  onPhoto: (file: File) => void;
  onRemove?: () => void;
  onView: (src: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const flagged = check.outcome === "flagged";

  return (
    <li className={`insp-row outcome-${check.outcome} ${flagged ? `sev-${check.severity ?? "minor"}` : ""}`}>
      <div className="insp-row-main">
        <div className="insp-row-text">
          <p className="insp-label">
            {check.label}
            {!check.pointId && <span className="insp-extra-tag">added</span>}
          </p>
          {check.hint && <p className="insp-hint">{check.hint}</p>}
          {check.category && <span className="insp-cat">{categoryLabel(check.category)}</span>}
        </div>

        {editable ? (
          <div className="insp-outcomes" role="group" aria-label={`Outcome for ${check.label}`}>
            {OUTCOMES.map((o) => (
              <button
                key={o}
                type="button"
                className={`insp-outcome o-${o} ${check.outcome === o ? "selected" : ""}`}
                aria-pressed={check.outcome === o}
                onClick={() => onChange({ outcome: o })}
              >
                {OUTCOME_LABELS[o]}
              </button>
            ))}
          </div>
        ) : (
          <span className={`insp-verdict o-${check.outcome}`}>{OUTCOME_LABELS[check.outcome]}</span>
        )}
      </div>

      {flagged && (
        <div className="insp-detail">
          {editable && (
            <div className="insp-sev" role="group" aria-label="How bad is it">
              {SEVERITIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`insp-sev-btn s-${s} ${(check.severity ?? "minor") === s ? "selected" : ""}`}
                  aria-pressed={(check.severity ?? "minor") === s}
                  onClick={() => onChange({ severity: s })}
                >
                  {SEVERITY_LABELS[s]}
                </button>
              ))}
            </div>
          )}
          {!editable && check.severity && <span className={`insp-sev-tag s-${check.severity}`}>{SEVERITY_LABELS[check.severity]}</span>}

          {editable ? (
            <textarea
              className="insp-note"
              defaultValue={check.note ?? ""}
              rows={2}
              maxLength={1000}
              placeholder="What exactly? Where on it? How bad?"
              aria-label={`Note for ${check.label}`}
              onBlur={(e) => {
                if (e.target.value !== (check.note ?? "")) onChange({ note: e.target.value });
              }}
            />
          ) : (
            check.note && <p className="insp-note-read">{check.note}</p>
          )}

          <div className="insp-photos">
            {check.photos.map((photo) => (
              <button key={photo.id} type="button" className="insp-thumb" onClick={() => onView(api.photoUrl(photo.id))}>
                <img src={api.photoThumbUrl(photo.id)} alt="" loading="lazy" />
              </button>
            ))}
            {editable && (
              <>
                <button type="button" className="insp-add-photo" onClick={() => fileInput.current?.click()}>
                  📷
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const file = e.target.files?.[0];
                    if (file) onPhoto(file);
                    e.target.value = "";
                  }}
                />
              </>
            )}
          </div>

          {check.issue && (
            <p className="insp-raised">
              Raised as <Link to={`/properties/${propertyId}?issue=${check.issue.id}`}>{check.issue.title}</Link>
            </p>
          )}
          {editable && onRemove && !check.pointId && (
            <button type="button" className="btn btn-ghost btn-small danger insp-remove" onClick={onRemove}>
              Remove this finding
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Walking a room. Every line saves as it is touched — nobody should have to
 * remember to press save halfway round a floor with a phone in one hand.
 */
export default function InspectionRun() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newSeverity, setNewSeverity] = useState<Severity>("minor");
  const [onlyOpen, setOnlyOpen] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    api
      .getInspection(id)
      .then(setInspection)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  const editable = inspection?.status === "in_progress";

  /** Optimistic: the line changes under the thumb, then the save catches up. */
  async function patch(check: InspectionCheck, data: Parameters<typeof api.updateCheck>[1]) {
    setInspection((prev) =>
      prev ? { ...prev, checks: prev.checks.map((c) => (c.id === check.id ? { ...c, ...(data as Partial<InspectionCheck>) } : c)) } : prev
    );
    setSaving((n) => n + 1);
    try {
      const fresh = await api.updateCheck(check.id, data);
      setInspection((prev) => (prev ? { ...prev, checks: prev.checks.map((c) => (c.id === fresh.id ? fresh : c)) } : prev));
      setError(null);
    } catch (e: any) {
      setError(e.message);
      load();
    } finally {
      setSaving((n) => n - 1);
    }
  }

  async function addPhoto(check: InspectionCheck, file: File) {
    setSaving((n) => n + 1);
    try {
      const photo = await api.uploadCheckPhoto(check.id, file);
      setInspection((prev) =>
        prev ? { ...prev, checks: prev.checks.map((c) => (c.id === check.id ? { ...c, photos: [...c.photos, photo] } : c)) } : prev
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving((n) => n - 1);
    }
  }

  async function addFinding() {
    if (!id || !newLabel.trim()) return;
    setSaving((n) => n + 1);
    try {
      const check = await api.addFinding(id, { label: newLabel.trim(), severity: newSeverity });
      setInspection((prev) => (prev ? { ...prev, checks: [...prev.checks, check] } : prev));
      setNewLabel("");
      setShowAdd(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving((n) => n - 1);
    }
  }

  async function removeFinding(check: InspectionCheck) {
    if (!confirm("Remove this finding?")) return;
    try {
      await api.deleteCheck(check.id);
      setInspection((prev) => (prev ? { ...prev, checks: prev.checks.filter((c) => c.id !== check.id) } : prev));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function finish() {
    if (!inspection) return;
    const untouched = inspection.checks.filter((c) => c.pointId && c.outcome === "ok" && !c.note).length;
    if (
      untouched > 0 &&
      !confirm(`${untouched} point${untouched === 1 ? " is" : "s are"} still marked fine without being looked at. Finish anyway?`)
    ) {
      return;
    }
    try {
      const done = await api.updateInspection(inspection.id, { status: "completed" });
      setInspection(done);
      navigate(`/inspections/${inspection.id}/report`);
    } catch (e: any) {
      setError(e.message);
    }
  }

  const stats = useMemo(() => {
    const checks = inspection?.checks ?? [];
    return {
      total: checks.length,
      flagged: checks.filter((c) => c.outcome === "flagged").length,
      na: checks.filter((c) => c.outcome === "na").length,
      photos: checks.reduce((n, c) => n + c.photos.length, 0),
    };
  }, [inspection]);

  const sections = useMemo(() => {
    const checks = (inspection?.checks ?? []).filter((c) => !onlyOpen || c.outcome === "flagged");
    return bySection(checks);
  }, [inspection, onlyOpen]);

  if (loading) return <div className="page loading-state">Loading…</div>;
  if (!inspection) return <div className="page"><div className="banner banner-error">{error ?? "Not found"}</div></div>;

  return (
    <div className="page insp-page">
      <div className="insp-head">
        <div>
          <p className="insp-eyebrow">
            <Link to="/inspections">Inspections</Link> · {inspection.property.name}
          </p>
          <h1>{inspection.roomName}</h1>
          <p className="muted">
            {inspection.templateName} · started by {inspection.inspector}
            {inspection.status !== "in_progress" && ` · ${inspection.status === "completed" ? "finished" : "abandoned"}`}
          </p>
        </div>
        <div className="insp-head-actions">
          {saving > 0 && <span className="muted small">Saving…</span>}
          <Link to={`/inspections/${inspection.id}/report`} className="btn btn-secondary btn-small">
            Report
          </Link>
          {editable && (
            <button type="button" className="btn btn-primary btn-small" onClick={finish}>
              Finish
            </button>
          )}
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <div className="insp-stats">
        <span>
          <strong>{stats.total - stats.flagged - stats.na}</strong> fine
        </span>
        <span className={stats.flagged ? "is-flagged" : ""}>
          <strong>{stats.flagged}</strong> flagged
        </span>
        <span>
          <strong>{stats.na}</strong> n/a
        </span>
        <span>
          <strong>{stats.photos}</strong> photos
        </span>
        <label className="checkbox-row insp-filter">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          Only what I flagged
        </label>
      </div>

      {sections.map((section) => (
        <section key={section.name} className="insp-section">
          <h2>{section.name}</h2>
          <ul className="insp-rows">
            {section.checks.map((check) => (
              <CheckRow
                key={check.id}
                check={check}
                propertyId={inspection.propertyId}
                editable={!!editable}
                onChange={(data) => patch(check, data)}
                onPhoto={(file) => addPhoto(check, file)}
                onRemove={() => removeFinding(check)}
                onView={setLightbox}
              />
            ))}
          </ul>
        </section>
      ))}

      {editable && (
        <section className="insp-section insp-add">
          {showAdd ? (
            <div className="form">
              <label>
                Something not on the list
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  maxLength={200}
                  placeholder="Loose tile behind the door"
                  autoFocus
                />
              </label>
              <div className="insp-sev" role="group" aria-label="How bad is it">
                {SEVERITIES.map((s) => (
                  <button key={s} type="button" className={`insp-sev-btn s-${s} ${newSeverity === s ? "selected" : ""}`} onClick={() => setNewSeverity(s)}>
                    {SEVERITY_LABELS[s]}
                  </button>
                ))}
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-primary btn-small" disabled={!newLabel.trim()} onClick={addFinding}>
                  Add finding
                </button>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => setShowAdd(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-secondary btn-block" onClick={() => setShowAdd(true)}>
              + Found something else
            </button>
          )}
        </section>
      )}

      {lightbox && <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
