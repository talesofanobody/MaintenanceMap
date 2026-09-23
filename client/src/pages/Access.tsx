import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { useCurrentUser } from "../auth/AuthContext";
import type { AppUser, Role, Technician } from "../types";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from "../types";
import { formatDateTime } from "../lib/dates";
import { initials } from "../lib/capacity";

function tempPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function suggestUsername(name: string): string {
  const parts = name.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]}.${parts[parts.length - 1]}` : parts[0] || "user";
}

interface Reveal {
  username: string;
  password: string;
  label: string;
}

export default function Access() {
  const me = useCurrentUser();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [techForm, setTechForm] = useState<{ technicianId: string; username: string } | null>(null);
  const [otherForm, setOtherForm] = useState<{ role: Role; username: string } | null>(null);

  // The same seniority rule the server enforces: admins may grant anything,
  // anybody else only strictly below themselves. Shown here so a manager is
  // never offered a choice that would come back as a 403.
  const RANK: Record<Role, number> = { admin: 4, manager: 3, dispatcher: 2, technician: 1, display: 0 };
  const myRole = (me?.role ?? "display") as Role;
  const grantable = ROLES.filter((r) => (myRole === "admin" ? true : RANK[r] < RANK[myRole]));
  const canGrant = (r: Role) => grantable.includes(r);
  const [busy, setBusy] = useState(false);

  function load() {
    Promise.all([api.listUsers(), api.listTechnicians()])
      .then(([u, t]) => {
        setUsers(u);
        setTechnicians(t);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const techsWithoutLogin = technicians.filter((t) => t.active && !users.some((u) => u.technicianId === t.id));

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (err: any) {
      setError(`${label}: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function createTechLogin(e: FormEvent) {
    e.preventDefault();
    if (!techForm) return;
    const password = tempPassword();
    const tech = technicians.find((t) => t.id === techForm.technicianId);
    await run("Create login", async () => {
      await api.createUser({ username: techForm.username.trim(), password, role: "technician", technicianId: techForm.technicianId });
      setReveal({ username: techForm.username.trim(), password, label: tech?.name ?? "the technician" });
      setTechForm(null);
    });
  }

  async function createOtherLogin(e: FormEvent) {
    e.preventDefault();
    if (!otherForm) return;
    const password = tempPassword();
    await run("Create login", async () => {
      await api.createUser({ username: otherForm.username.trim(), password, role: otherForm.role });
      setReveal({ username: otherForm.username.trim(), password, label: otherForm.role === "display" ? "the TV / display" : `the new ${ROLE_LABELS[otherForm.role].toLowerCase()}` });
      setOtherForm(null);
    });
  }

  async function resetPassword(u: AppUser) {
    if (!confirm(`Reset ${u.username}'s password? They'll get a new temporary one to change on next sign-in.`)) return;
    const password = tempPassword();
    await run("Reset password", async () => {
      await api.updateUser(u.id, { password });
      setReveal({ username: u.username, password, label: u.technician?.name ?? u.username });
    });
  }

  async function toggleActive(u: AppUser) {
    await run(u.active ? "Deactivate" : "Reactivate", () => api.updateUser(u.id, { active: !u.active }));
  }

  async function remove(u: AppUser) {
    if (!confirm(`Delete the login ${u.username}? This can't be undone.`)) return;
    await run("Delete login", () => api.deleteUser(u.id));
  }

  const techUsers = users.filter((u) => u.role === "technician");
  const otherUsers = users.filter((u) => u.role !== "technician");

  function UserRow({ u }: { u: AppUser }) {
    const isMe = me?.id === u.id;
    return (
      <li className={`user-row ${u.active ? "" : "inactive"}`}>
        <span className="avatar" style={{ background: u.technician?.color ?? (u.role === "admin" ? "#0f172a" : "#475569") }}>
          {u.technician ? initials(u.technician.name) : u.role === "display" ? "TV" : initials(u.username)}
        </span>
        <div className="user-main">
          <strong>
            {u.technician?.name ?? u.username}
            {isMe && <span className="badge badge-ok">you</span>}
            {!u.active && <span className="badge badge-warn">Inactive</span>}
            {u.mustChangePassword && u.active && <span className="badge badge-warn">Temporary password</span>}
          </strong>
          <span className="muted small">
            {u.username} · {ROLE_LABELS[u.role]}
            {u.lastLoginAt ? ` · last sign-in ${formatDateTime(u.lastLoginAt)}` : " · never signed in"}
          </span>
        </div>
        <div className="card-actions">
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => resetPassword(u)}>
            Reset password
          </button>
          {!isMe && (
            <>
              <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => toggleActive(u)}>
                {u.active ? "Deactivate" : "Reactivate"}
              </button>
              <button type="button" className="btn btn-ghost btn-small btn-danger-text" disabled={busy} onClick={() => remove(u)}>
                Delete
              </button>
            </>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Access</h1>
          <p className="muted">
            Who can sign in and what they can do. <strong>Admins</strong> manage everything; <strong>technicians</strong> see all properties but only update
            issues assigned to them; <strong>display</strong> logins can only show the dashboards — use one on the office TV.
          </p>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {reveal && (
        <div className="card reveal-card">
          <h3>Temporary password for {reveal.label}</h3>
          <p className="muted">Give these details to them now — the password is shown only once, and they'll be asked to choose their own on first sign-in.</p>
          <dl className="reveal-grid">
            <div>
              <dt>Username</dt>
              <dd>
                <code>{reveal.username}</code>
              </dd>
            </div>
            <div>
              <dt>Temporary password</dt>
              <dd>
                <code>{reveal.password}</code>
              </dd>
            </div>
          </dl>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setReveal(null)}>
            Done, I've passed it on
          </button>
        </div>
      )}

      {loading ? (
        <p className="loading-state">Loading…</p>
      ) : (
        <>
          <section className="access-section">
            <div className="access-section-head">
              <h2>Technician logins</h2>
              {techsWithoutLogin.length > 0 && !techForm && (
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={() => setTechForm({ technicianId: techsWithoutLogin[0].id, username: suggestUsername(techsWithoutLogin[0].name) })}
                >
                  + Create technician login
                </button>
              )}
            </div>
            {techForm && (
              <form className="card form property-form" onSubmit={createTechLogin}>
                <h3>New technician login</h3>
                <label>
                  Technician
                  <select
                    value={techForm.technicianId}
                    onChange={(e) => {
                      const t = technicians.find((x) => x.id === e.target.value);
                      setTechForm({ technicianId: e.target.value, username: t ? suggestUsername(t.name) : techForm.username });
                    }}
                  >
                    {techsWithoutLogin.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.trade ? ` — ${t.trade}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Username
                  <input value={techForm.username} onChange={(e) => setTechForm({ ...techForm, username: e.target.value })} autoCapitalize="none" required />
                </label>
                <p className="muted small">A temporary password is generated for you to pass on; they'll set their own when they first sign in.</p>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    Create login
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setTechForm(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
            {techUsers.length === 0 && !techForm ? (
              <p className="empty-state">
                {technicians.length === 0
                  ? "Add technicians first, then create logins for them here."
                  : techsWithoutLogin.length === 0
                    ? "Every technician has a login."
                    : "No technician logins yet. Technicians with a login can update their own issues from their phone."}
              </p>
            ) : (
              <ul className="user-list">
                {techUsers.map((u) => (
                  <UserRow key={u.id} u={u} />
                ))}
              </ul>
            )}
          </section>

          <section className="access-section">
            <div className="access-section-head">
              <h2>Other logins</h2>
              {!otherForm && (
                <div className="card-actions">
                  {canGrant("display") && (
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => setOtherForm({ role: "display", username: "office-tv" })}>
                      + Display login
                    </button>
                  )}
                  {canGrant("dispatcher") && (
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => setOtherForm({ role: "dispatcher", username: "" })}>
                      + Dispatcher
                    </button>
                  )}
                  {canGrant("manager") && (
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => setOtherForm({ role: "manager", username: "" })}>
                      + Manager
                    </button>
                  )}
                  {canGrant("admin") && (
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => setOtherForm({ role: "admin", username: "" })}>
                      + Admin login
                    </button>
                  )}
                </div>
              )}
            </div>
            {otherForm && (
              <form className="card form property-form" onSubmit={createOtherLogin}>
                <h3>New {otherForm.role} login</h3>
                <label>
                  Role
                  <select value={otherForm.role} onChange={(e) => setOtherForm({ ...otherForm, role: e.target.value as Role })}>
                    {grantable
                      .filter((r) => r !== "technician")
                      .map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]} — {ROLE_DESCRIPTIONS[r]}
                        </option>
                      ))}
                  </select>
                  <span className="hint">{ROLE_DESCRIPTIONS[otherForm.role]}</span>
                </label>
                <label>
                  Username
                  <input value={otherForm.username} onChange={(e) => setOtherForm({ ...otherForm, username: e.target.value })} autoCapitalize="none" required autoFocus />
                </label>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    Create login
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setOtherForm(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
            <ul className="user-list">
              {otherUsers.map((u) => (
                <UserRow key={u.id} u={u} />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
