import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { formatDate } from "../lib/dates";
import { categoryLabel, PRIORITY_LABELS, STATUS_LABELS, type Project, type ProjectIssue, type ProjectStatus } from "../types";
import ProjectPlan from "./ProjectPlan";
import ProjectGovernance from "./ProjectGovernance";
import Gantt from "./Gantt";

const TABS: { key: ProjectStatus | ""; label: string }[] = [
  { key: "planning", label: "Planning" },
  { key: "open", label: "Under way" },
  { key: "on_hold", label: "On hold" },
  { key: "done", label: "Done" },
  { key: "", label: "Everything" },
];

/**
 * Lay the work out as a tree, parents before their children.
 *
 * Reading order matters more than it looks: a flat list of forty jobs is a list,
 * and the same forty under five phases is a plan. Anything whose parent is not in
 * this project is treated as a root rather than hidden, because a job disappearing
 * from its own project would be worse than showing it at the wrong indent.
 */
function asTree(issues: ProjectIssue[]): { issue: ProjectIssue; depth: number }[] {
  const byParent = new Map<string | null, ProjectIssue[]>();
  const ids = new Set(issues.map((i) => i.id));
  for (const issue of issues) {
    const key = issue.parentId && ids.has(issue.parentId) ? issue.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(issue);
    byParent.set(key, list);
  }
  const out: { issue: ProjectIssue; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const issue of byParent.get(parentId) ?? []) {
      out.push({ issue, depth });
      // Depth is capped for layout only; the data may nest further.
      walk(issue.id, Math.min(depth + 1, 4));
    }
  };
  walk(null, 0);
  return out;
}

/**
 * A project is a plan over issues — a refurbishment, a floor's worth of snagging,
 * a treatment programme. The work itself is still issues, which carry the parent
 * and the dependencies, so nothing else in the app has to learn a second kind of
 * work and the inspection side stays separable.
 *
 * The EAM remains the record of work orders. This decides what work should exist
 * and when; the work order it becomes still lives over there.
 */
export default function Projects() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<ProjectStatus | "">("open");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Which view each expanded project is showing. The list is the default because
  // it is the one that works on a phone.
  const [view, setView] = useState<Record<string, "list" | "timeline">>({});

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
          <p className="muted">Work planned together: who owns it, what was agreed, what it is costing, and whether the quotes are in.</p>
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
                    {project.status === "done" || project.status === "cancelled" ? (
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => setStatus(project, "open")}>
                        Reopen
                      </button>
                    ) : (
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => setStatus(project, "done")}>
                        Close
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
                  {project.owner ? ` · ${project.owner.name}` : ""}
                  {/* Worth seeing without expanding: what is stuck, and whether the
                      plan disagrees with itself. */}
                  {project.openBlockers > 0 && (
                    <strong className="is-late"> · {project.openBlockers} blocked</strong>
                  )}
                  {project.analysis?.violations?.length > 0 && (
                    <strong className="is-late"> · plan contradicts itself</strong>
                  )}
                </p>
                {project.description && <p className="proj-desc">{project.description}</p>}

                {expanded && (
                  <>
                    <ProjectPlan
                      project={project}
                      onChange={(updated) => setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))}
                    />
                    <ProjectGovernance
                      project={project}
                      allProjects={projects.map((p) => ({ id: p.id, name: p.name }))}
                      onChange={(updated) => setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))}
                    />

                    {project.issues.length === 0 ? (
                      <p className="empty-state small">Nothing in this project yet.</p>
                    ) : (
                      <>
                        <div className="proj-view-switch" role="tablist">
                          <button
                            type="button"
                            role="tab"
                            aria-selected={(view[project.id] ?? "list") === "list"}
                            className={`tab ${(view[project.id] ?? "list") === "list" ? "selected" : ""}`}
                            onClick={() => setView((v) => ({ ...v, [project.id]: "list" }))}
                          >
                            The work
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={view[project.id] === "timeline"}
                            className={`tab ${view[project.id] === "timeline" ? "selected" : ""}`}
                            onClick={() => setView((v) => ({ ...v, [project.id]: "timeline" }))}
                          >
                            Timeline
                          </button>
                          {project.analysis?.longestChainDays > 0 && (
                            <span className="muted small">
                              longest chain {project.analysis.longestChainDays} days
                              {project.analysis.violations.length > 0 && (
                                <strong className="is-late">
                                  {" "}
                                  · {project.analysis.violations.length} cannot start as planned
                                </strong>
                              )}
                            </span>
                          )}
                        </div>

                        {view[project.id] === "timeline" ? (
                          <Gantt
                            rows={asTree(project.issues)}
                            analysis={project.analysis}
                            onPick={(issueId) => {
                              const issue = project.issues.find((i) => i.id === issueId);
                              if (issue) navigate(`/properties/${issue.propertyId}?issue=${issue.id}`);
                            }}
                          />
                        ) : (
                      <ul className="proj-issues">
                        {asTree(project.issues).map(({ issue, depth }) => (
                          <li
                            key={issue.id}
                            className={`proj-issue status-${issue.status} ${issue.isMilestone ? "is-milestone" : ""}`}
                            /* Indent from the row's own padding, not instead of it:
                               a depth-0 row must keep the 10px the design gives it. */
                            style={depth ? { paddingLeft: `${10 + depth * 18}px` } : undefined}
                          >
                            <Link to={`/properties/${issue.propertyId}?issue=${issue.id}`} className="proj-issue-title">
                              {issue.isMilestone && <span className="proj-milestone-mark" title="A dateline, not a job">◆</span>}
                              {issue.title}
                            </Link>
                            <span className="muted small">
                              {issue.roomName ? `${issue.roomName} · ` : ""}
                              {issue.category ? `${categoryLabel(issue.category)} · ` : ""}
                              {PRIORITY_LABELS[issue.priority]} · {STATUS_LABELS[issue.status]}
                              {issue.technician ? ` · ${issue.technician.name}` : ""}
                              {/* The agreed date against the current one, where they differ. */}
                              {issue.baselineDue && issue.dueDate && issue.baselineDue !== issue.dueDate && (
                                <strong className="is-late"> · due {issue.dueDate}, agreed {issue.baselineDue}</strong>
                              )}
                              {issue.workOrderNumber ? ` · ${issue.workOrderNumber}` : ""}
                            </span>
                            <button type="button" className="btn btn-ghost btn-small" onClick={() => release(project, issue.id)}>
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                        )}
                      </>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
