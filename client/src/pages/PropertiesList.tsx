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
  const [creating, setCreating] = useState(false);

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
    setCreating(true);
    try {
      await api.createProperty({ name: name.trim(), address: address.trim() || undefined });
      setName("");
      setAddress("");
      setShowForm(false);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(p: Property) {
    if (!confirm(`Delete "${p.name}" and all of its issues and photos? This cannot be undone.`)) return;
    await api.deleteProperty(p.id);
    load();
  }

  const form = (
    <form className="card form property-form" onSubmit={handleCreate}>
      <h3>New property</h3>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 12 Maple Street" autoFocus required />
      </label>
      <label>
        Address <span className="muted">(optional)</span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, town, postcode" />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={creating}>
          {creating ? "Creating…" : "Create property"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Properties</h1>
          {!loading && properties.length > 0 && (
            <p className="muted">
              {properties.length} propert{properties.length === 1 ? "y" : "ies"} · tap one to open its map
            </p>
          )}
        </div>
        {!showForm && (
          <button type="button" className="btn btn-primary" onClick={() => setShowForm(true)}>
            + Add property
          </button>
        )}
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {showForm && form}

      {loading ? (
        <p className="loading-state">Loading…</p>
      ) : properties.length === 0 ? (
        !showForm && (
          <section className="welcome card">
            <h2>Welcome to MaintenanceMap</h2>
            <p>Track maintenance issues exactly where they are on each property, then hand over a clean report.</p>
            <ol className="welcome-steps">
              <li>
                <span className="welcome-step-num">1</span>
                <div>
                  <strong>Add a property</strong>
                  <span>Just a name to start — the address helps you find it on the map.</span>
                </div>
              </li>
              <li>
                <span className="welcome-step-num">2</span>
                <div>
                  <strong>Draw its border</strong>
                  <span>Trace the property outline over satellite imagery. A guide walks you through it.</span>
                </div>
              </li>
              <li>
                <span className="welcome-step-num">3</span>
                <div>
                  <strong>Log issues as you walk it</strong>
                  <span>Tap the map or snap a photo — pins carry priority, status, work orders and notes.</span>
                </div>
              </li>
            </ol>
            <button type="button" className="btn btn-primary btn-large" onClick={() => setShowForm(true)}>
              Add your first property
            </button>
          </section>
        )
      ) : (
        <div className="card-grid">
          {properties.map((p) => (
            <div key={p.id} className="card property-card">
              <Link to={`/properties/${p.id}`} className="property-card-link">
                <div className="property-card-top">
                  <h3>{p.name}</h3>
                  <span className={`badge ${p.boundary ? "badge-ok" : "badge-warn"}`}>{p.boundary ? "Border set" : "No border yet"}</span>
                </div>
                {p.address && <p className="muted">{p.address}</p>}
                <p className="property-card-count">
                  <strong>{p._count?.issues ?? 0}</strong> issue{p._count?.issues === 1 ? "" : "s"}
                </p>
              </Link>
              <div className="card-actions">
                <Link to={`/properties/${p.id}`} className="btn btn-secondary btn-small">
                  Open map
                </Link>
                <Link to={`/properties/${p.id}/report`} className="btn btn-ghost btn-small">
                  Report
                </Link>
                <button type="button" className="btn btn-ghost btn-small btn-danger-text" onClick={() => handleDelete(p)}>
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
