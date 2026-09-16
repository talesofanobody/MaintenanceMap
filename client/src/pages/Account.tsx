import { FormEvent, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { BrandMark } from "../App";
import { ROLE_LABELS } from "../types";

export default function Account({ forced = false }: { forced?: boolean }) {
  const { state, refresh, logout } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError("New passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      await api.changePassword(current, next);
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const form = (
    <form className="form" onSubmit={handleSubmit}>
      {error && <div className="banner banner-error">{error}</div>}
      {done && !forced && <div className="banner banner-info">Password updated.</div>}
      <label>
        {forced ? "Temporary password" : "Current password"}
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
      </label>
      <label>
        New password
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </label>
      <label>
        Confirm new password
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </label>
      <div className="form-actions">
        <button type="submit" className={`btn btn-primary ${forced ? "btn-large" : ""}`} disabled={saving}>
          {saving ? "Saving…" : forced ? "Set password and continue" : "Change password"}
        </button>
        {forced && (
          <button type="button" className="btn btn-ghost" onClick={() => logout()}>
            Sign out
          </button>
        )}
      </div>
    </form>
  );

  if (forced) {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <div className="auth-brand">
            <BrandMark />
            <h1>MaintenanceMap</h1>
          </div>
          <h2>Choose your own password</h2>
          <p className="muted small">
            You signed in with a temporary password{user ? ` as ${user.username}` : ""}. Pick a new one (8+ characters) before continuing.
          </p>
          {form}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Your account</h1>
          {user && (
            <p className="muted">
              Signed in as <strong>{user.username}</strong> · {ROLE_LABELS[user.role]}
              {user.technician ? ` · linked to ${user.technician.name}` : ""}
            </p>
          )}
        </div>
      </div>
      <div className="card property-form">
        <h3>Change password</h3>
        {form}
      </div>
    </div>
  );
}
