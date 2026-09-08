import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Property } from "../types";

export default function PropertiesList() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");

  function load() {
    setLoading(true);
    api
      .listProperties()
      .then(setProperties)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.createProperty({ name: name.trim(), address: address.trim() || undefined });
      setName("");
      setAddress("");
      setShowForm(false);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this property and all its issues/photos? This cannot be undone.")) return;
    await api.deleteProperty(id);
    load();
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Properties</h1>
        <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "+ Add Property"}
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {showForm && (
        <form className="card form" onSubmit={handleCreate}>
          <label>
            Property name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 123 Main St" autoFocus />
          </label>
          <label>
            Address (optional)
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city, state" />
          </label>
          <button type="submit" className="btn btn-primary">
            Create Property
          </button>
        </form>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : properties.length === 0 ? (
        <p className="empty-state">No properties yet. Add one to draw its border and start tracking issues.</p>
      ) : (
        <div className="card-grid">
          {properties.map((p) => (
            <div key={p.id} className="card property-card">
              <Link to={`/properties/${p.id}`} className="property-card-link">
                <h3>{p.name}</h3>
                {p.address && <p className="muted">{p.address}</p>}
                <p className="muted small">
                  {p.boundary ? "Border set" : "No border drawn yet"} · {p._count?.issues ?? 0} issue
                  {p._count?.issues === 1 ? "" : "s"}
                </p>
              </Link>
              <div className="card-actions">
                <Link to={`/properties/${p.id}/report`} className="btn btn-small">
                  Report
                </Link>
                <button className="btn btn-small btn-danger" onClick={() => handleDelete(p.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
