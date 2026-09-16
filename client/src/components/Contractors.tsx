import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import type { Contractor } from "../types";
import { money } from "./CostPanel";

interface FormState {
  name: string;
  trade: string;
  phone: string;
  email: string;
  notes: string;
}

const EMPTY: FormState = { name: "", trade: "", phone: "", email: "", notes: "" };

/** Outside firms used on issues, with what has been spent with each. Admin only. */
export default function Contractors() {
  const [list, setList] = useState<Contractor[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .listContractors()
      .then(setList)
      .catch((e) => setError(e.message));
  }

  useEffect(load, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form?.name.trim()) return;
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      trade: form.trade.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (editingId) await api.updateContractor(editingId, payload);
      else await api.createContractor(payload);
      setForm(null);
      setEditingId(null);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c: Contractor) {
    try {
      await api.updateContractor(c.id, { active: !c.active });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function remove(c: Contractor) {
    if (!confirm(`Remove ${c.name}?`)) return;
    try {
      await api.deleteContractor(c.id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <section className="contractors">
      <div className="section-header">
        <div>
          <h2>Contractors</h2>
          <p className="muted">Outside firms you bring in. Attach their invoices to an issue's costs so spend per property is in the export.</p>
        </div>
        {!form && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setEditingId(null);
              setForm({ ...EMPTY });
            }}
          >
            + Add contractor
          </button>
        )}
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {form && (
        <form className="card form contractor-form" onSubmit={submit}>
          <h3>{editingId ? "Edit contractor" : "New contractor"}</h3>
          <div className="form-row">
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Riverside Roofing" aria-label="Contractor name" autoFocus required />
            </label>
            <label>
              Trade <span className="muted">(optional)</span>
              <input value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} placeholder="Roofing, electrical, tree surgery…" aria-label="Contractor trade" />
            </label>
          </div>
          <div className="form-row">
            <label>
              Phone <span className="muted">(optional)</span>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
            </label>
            <label>
              Email <span className="muted">(optional)</span>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} inputMode="email" autoCapitalize="none" />
            </label>
          </div>
          <label>
            Notes <span className="muted">(optional)</span>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Rates, call-out terms, who to ask for…" />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving || !form.name.trim()}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Add contractor"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setForm(null);
                setEditingId(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {list.length === 0 ? (
        !form && <p className="empty-state">No contractors yet.</p>
      ) : (
        <div className="user-list">
          {list.map((c) => (
            <div key={c.id} className={`user-row ${c.active ? "" : "inactive"}`}>
              <div>
                <strong>{c.name}</strong>
                {!c.active && <span className="badge badge-warn">Inactive</span>}
                <span className="muted small">
                  {[c.trade, c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"}
                  {c.totalSpend ? ` · ${money(c.totalSpend)} spent` : ""}
                  {c._count?.costs ? ` on ${c._count.costs} line${c._count.costs === 1 ? "" : "s"}` : ""}
                </span>
              </div>
              <div className="user-row-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => {
                    setEditingId(c.id);
                    setForm({ name: c.name, trade: c.trade ?? "", phone: c.phone ?? "", email: c.email ?? "", notes: c.notes ?? "" });
                  }}
                >
                  Edit
                </button>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => toggleActive(c)}>
                  {c.active ? "Deactivate" : "Reactivate"}
                </button>
                <button type="button" className="btn btn-ghost btn-small btn-danger-text" onClick={() => remove(c)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
