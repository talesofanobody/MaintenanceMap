import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { formatDate } from "../lib/dates";
import { categoryLabel, PRIORITY_LABELS, STATUS_LABELS, type Project, type ProjectStatus } from "../types";

const TABS: { key: ProjectStatus | ""; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "done", label: "Done" },
  { key: "", label: "Everything" },
];

/**
 * Projects are a label over issues — a room refurbishment, a floor's worth of
 * snagging from one inspection. Nothing else in the app has to know about them,
 * which is what keeps the inspection side separable.
 */
export default function Projects() {
  const [tab, setTab] = useState<ProjectStatus | "">("open");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .listProjects(tab ? { status: tab } : {})
      .then((rows) => {
        setProjects(rows);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(load, [load]);

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const project = await api.createProject({ name: name.trim(), description: description.trim() || undefined });
      setProjects((prev) => [project, ...prev]);
      setName("");
      setDescription("");
      setShowNew(false);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(project: Project, status: ProjectStatus) {
    try {
      const updated = await api.updateProject(project.id, { status });
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setError(null);
    } catch (err: any) {
      // Closing with open work is refused once; the second press says so plainly.
      if (status === "done" && confirm(`${err.message} Close it anyway?`)) {
        try {
          const forced = await api.updateProject(project.id, { status, force: true });
          setProjects((prev) => prev.map((p) => (p.id === forced.id ? forced : p)));
          setError(null);
          return;
        } catch (e2: any) {
          setError(e2.message);
          return;
        }
      }
      setError(err.message);
    }
  }

  async function remove(project: Project) {
    if (!confirm(`Delete "${project.name}"? Its ${project.counts.total} issue${project.counts.total === 1 ? "" : "s"} stay, just no longer grouped.`)) return;
    try {
      await api.deleteProject(project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function release(project: Project, issueId: string) {
    try {
      const updated = await api.changeProjectIssues(project.id, { remove: [issueId] });
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="page proj-page">
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <p className="muted">Work that belongs together — usually a room's worth of findings from one inspection.</p>
        </div>
        <div className="page-header-actions">
          <Link to="/inspections" className="btn btn-ghost btn-small">
            Inspections
          </Link>
          <button type="button" className="btn btn-primary btn-small" onClick={() => setShowNew((v) => !v)}>
            {showNew ? "Cancel" : "New project"}
          </button>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {showNew && (
        <form className="card form proj-new" onSubmit={create}>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Second floor refurbishment" autoFocus required />
          </label>
          <label>
            What is it
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={2} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            Create
          </button>
        </form>
      )}

      <div className="tab-row" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? "selected" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-state">Loading…</div>
      ) : projects.length === 0 ? (
        <p className="empty-state">No projects here.</p>
      ) : (
        <ul className="proj-list">
          {projects.map((project) => {
            const expanded = open.has(project.id);
            return (
              <li key={project.id} className={`card proj-card status-${project.status}`}>
                <div className="proj-head">
                  <button type="button" className="proj-toggle" aria-expanded={expanded} onClick={() => toggle(project.id)}>
                    <span className="proj-caret">{expanded ? "▾" : "▸"}</span>
                    <span className="proj-name">{project.name}</span>
                  </button>
                  <div className="proj-progress" title={`${project.counts.done} of ${project.counts.total} done`}>
                    <div className="proj-bar">
                      <span style={{ width: `${project.counts.progress}%` }} />
                    </div>
                    <span className="muted small">
                      {project.counts.done}/{project.counts.total} done · {project.counts.open} open
                    </span>
                  </div>
                  <div className="proj-actions">
                    {project.status === "open" ? (
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => setStatus(project, "done")}>
                        Close
                      </button>
                    ) : (
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => setStatus(project, "open")}>
                        Reopen
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-small danger" onClick={() => remove(project)}>
                      Delete
                    </button>
                  </div>
                </div>

                <p className="muted small proj-meta">
                  {project.property ? `${project.property.name} · ` : ""}
                  started {formatDate(project.createdAt)}
                  {project.createdBy ? ` by ${project.createdBy}` : ""}
                </p>
                {project.description && <p className="proj-desc">{project.description}</p>}

                {expanded &&
                  (project.issues.length === 0 ? (
                    <p className="empty-state small">Nothing in this project yet.</p>
                  ) : (
                    <ul className="proj-issues">
                      {project.issues.map((issue) => (
                        <li key={issue.id} className={`proj-issue status-${issue.status}`}>
                          <Link to={`/properties/${issue.propertyId}?issue=${issue.id}`} className="proj-issue-title">
                            {issue.title}
                          </Link>
                          <span className="muted small">
                            {issue.roomName ? `${issue.roomName} · ` : ""}
                            {issue.category ? `${categoryLabel(issue.category)} · ` : ""}
                            {PRIORITY_LABELS[issue.priority]} · {STATUS_LABELS[issue.status]}
                            {issue.technician ? ` · ${issue.technician.name}` : ""}
                          </span>
                          <button type="button" className="btn btn-ghost btn-small" onClick={() => release(project, issue.id)}>
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
