import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { categoryLabel, type GuestReport, type GuestReportStatus, type Property } from "../types";
import { formatDateTime, formatDuration } from "../lib/dates";
import PhotoLightbox from "../components/PhotoLightbox";
import IntakeLinks from "../components/IntakeLinks";

const TABS: { key: GuestReportStatus; label: string }[] = [
  { key: "pending", label: "Needs review" },
  { key: "accepted", label: "Accepted" },
  { key: "declined", label: "Turned down" },
];

/**
 * Everything that came in through a property's public link. Reports are not issues yet:
 * accepting one opens the normal issue form on that property with the guest's words,
 * room and photos already filled in, so nothing is retyped and nothing is auto-created.
 */
export default function Requests() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<GuestReportStatus>("pending");
  const [reports, setReports] = useState<GuestReport[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .listGuestReports({ status: tab })
      .then((data) => {
        setReports(data.reports);
        setPendingCount(data.pendingCount);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(load, [load]);
  useEffect(() => {
    api.listProperties().then(setProperties).catch(() => setProperties([]));
  }, []);

  // Reports arrive while the page is open, so the queue refreshes itself.
  useEffect(() => {
    const timer = setInterval(load, 60000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const enabledCount = useMemo(() => properties.filter((p) => p.intakeEnabled).length, [properties]);

  function accept(report: GuestReport) {
    // The issue form is the review screen: it already knows how to place a pin, pick a
    // technician and set a priority, and it is where an admin expects to do that.
    navigate(`/properties/${report.propertyId}?intake=${report.id}`);
  }

  async function decline(report: GuestReport) {
    setBusyId(report.id);
    try {
      await api.declineGuestReport(report.id, declineNote.trim());
      setDecliningId(null);
      setDeclineNote("");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function reopen(report: GuestReport) {
    setBusyId(report.id);
    try {
      await api.reopenGuestReport(report.id);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(report: GuestReport) {
    if (!confirm(`Delete the report from ${report.roomName}? Its photos go with it.`)) return;
    setBusyId(report.id);
    try {
      await api.deleteGuestReport(report.id);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Requests</h1>
          <p className="muted">
            Reported through a property's public link by someone without a login. Nothing here is an issue until you accept it.
          </p>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <div className="tab-row" role="tablist" aria-label="Report status">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`tab ${tab === t.key ? "selected" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === "pending" && pendingCount > 0 && <span className="tab-count">{pendingCount}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-state">Loading…</div>
      ) : reports.length === 0 ? (
        <div className="empty-state">
          {tab === "pending" ? (
            enabledCount === 0 ? (
              <>
                <p>No property is taking guest reports yet.</p>
                <p className="muted">Turn one on below and put its link — or its QR code — where people will find it.</p>
              </>
            ) : (
              <p>Nothing waiting. Anything sent through a guest link will land here.</p>
            )
          ) : (
            <p>Nothing {tab === "accepted" ? "accepted" : "turned down"} yet.</p>
          )}
        </div>
      ) : (
        <ul className="request-list">
          {reports.map((report) => (
            <li key={report.id} className={`request-card request-${report.status}`}>
              <div className="request-head">
                <div>
                  <span className="request-room">{report.roomName}</span>
                  {report.category && <span className="request-tag">{categoryLabel(report.category)}</span>}
                </div>
                <span className="muted small" title={formatDateTime(report.createdAt)}>
                  {formatDuration(report.createdAt)} ago
                </span>
              </div>

              <p className="request-body">{report.description}</p>

              <p className="muted small request-meta">
                <Link to={`/properties/${report.propertyId}`}>{report.property.name}</Link>
                {report.lat != null && <> · photo located on site</>}
                {report.photos.length > 0 && (
                  <>
                    {" "}
                    · {report.photos.length} photo{report.photos.length === 1 ? "" : "s"}
                  </>
                )}
                <> · ref {report.id.slice(-6).toUpperCase()}</>
              </p>

              {report.photos.length > 0 && (
                <ul className="request-thumbs">
                  {report.photos.map((photo) => (
                    <li key={photo.id}>
                      <button type="button" onClick={() => setLightbox(api.photoUrl(photo.id))}>
                        <img src={api.photoThumbUrl(photo.id)} alt="" loading="lazy" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {report.status === "accepted" && report.issue && (
                <p className="request-outcome">
                  Accepted by {report.reviewedBy ?? "an admin"} ·{" "}
                  <Link to={`/properties/${report.propertyId}?issue=${report.issue.id}`}>{report.issue.title}</Link>
                </p>
              )}
              {report.status === "declined" && (
                <p className="request-outcome">
                  Turned down by {report.reviewedBy ?? "an admin"}
                  {report.reviewNote ? ` — ${report.reviewNote}` : ""}
                </p>
              )}

              {report.status === "pending" &&
                (decliningId === report.id ? (
                  <div className="request-decline">
                    <label>
                      <span className="field-label">Why? (kept on the record, not sent to the guest)</span>
                      <input
                        value={declineNote}
                        onChange={(e) => setDeclineNote(e.target.value)}
                        maxLength={500}
                        placeholder="Duplicate of the report from Room 214"
                        autoFocus
                      />
                    </label>
                    <div className="request-actions">
                      <button type="button" className="btn btn-danger btn-small" disabled={busyId === report.id} onClick={() => decline(report)}>
                        Turn it down
                      </button>
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => setDecliningId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="request-actions">
                    <button type="button" className="btn btn-primary btn-small" onClick={() => accept(report)}>
                      Accept and log it
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => {
                        setDecliningId(report.id);
                        setDeclineNote("");
                      }}
                    >
                      Turn down
                    </button>
                  </div>
                ))}

              {report.status === "declined" && (
                <div className="request-actions">
                  <button type="button" className="btn btn-secondary btn-small" disabled={busyId === report.id} onClick={() => reopen(report)}>
                    Put back in the queue
                  </button>
                  <button type="button" className="btn btn-ghost btn-small danger" disabled={busyId === report.id} onClick={() => remove(report)}>
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <IntakeLinks properties={properties} onChange={setProperties} />

      {lightbox && <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
