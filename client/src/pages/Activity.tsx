import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { ActivityEntry, Property } from "../types";
import { formatDateTime } from "../lib/dates";

const TYPES = [
  { value: "", label: "Everything" },
  { value: "issue", label: "Issues" },
  { value: "photo", label: "Photos" },
  { value: "property", label: "Properties" },
  { value: "technician", label: "Technicians" },
  { value: "user", label: "Logins" },
];

export default function Activity() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [entityType, setEntityType] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listProperties().then(setProperties).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api
      .listActivity({ propertyId: propertyId || undefined, entityType: entityType || undefined, limit: 300 })
      .then(setEntries)
      .finally(() => setLoading(false));
  }, [propertyId, entityType]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? entries.filter((e) => `${e.summary} ${e.username}`.toLowerCase().includes(q)) : entries;
  }, [entries, search]);

  const propertyName = (id: string | null) => properties.find((p) => p.id === id)?.name;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Activity</h1>
          <p className="muted">Who changed what, and when — every issue, photo, property, technician and login change.</p>
        </div>
      </div>

      <div className="filters">
        <select value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label="Type">
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} aria-label="Property">
          <option value="">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" aria-label="Search" />
      </div>

      {loading ? (
        <p className="loading-state">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="empty-state">No activity yet.</p>
      ) : (
        <ul className="activity-list card">
          {filtered.map((e) => (
            <li key={e.id} className={`activity-row type-${e.entityType}`}>
              <span className="activity-time">{formatDateTime(e.at)}</span>
              <span className="activity-user">{e.username}</span>
              <span className="activity-summary">
                {e.summary}
                {e.propertyId && propertyName(e.propertyId) && (
                  <>
                    {" "}
                    <Link to={`/properties/${e.propertyId}`} className="activity-link">
                      {propertyName(e.propertyId)}
                    </Link>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
