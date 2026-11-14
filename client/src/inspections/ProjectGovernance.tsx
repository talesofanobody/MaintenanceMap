import { useEffect, useState } from "react";
import { api } from "../api";
import { formatDate } from "../lib/dates";
import {
  BLOCKER_KIND_LABELS,
  STAKEHOLDER_ROLE_LABELS,
  type BlockerKind,
  type Project,
  type StakeholderRole,
  type Technician,
} from "../types";

const KINDS = Object.keys(BLOCKER_KIND_LABELS) as BlockerKind[];
const ROLES = Object.keys(STAKEHOLDER_ROLE_LABELS) as StakeholderRole[];

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000));
}

/**
 * Who is involved, what is in the way, and what this project waits on.
 *
 * The three things a plan needs around it that a list of dates cannot carry.
 * Blockers and stakeholders are both kept deliberately plain — the value is in
 * them being written down at all, not in the ceremony around them.
 */
export default function ProjectGovernance({
  project,
  onChange,
  allProjects,
}: {
  project: Project;
  onChange: (p: Project) => void;
  allProjects: { id: string; name: string }[];
}) {
  const [team, setTeam] = useState<Technician[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCleared, setShowCleared] = useState(false);

  const [bOpen, setBOpen] = useState(false);
  const [bKind, setBKind] = useState<BlockerKind>("parts");
  const [bSummary, setBSummary] = useState("");
  const [bOwner, setBOwner] = useState("");
  const [bOwnerName, setBOwnerName] = useState("");

  const [sOpen, setSOpen] = useState(false);
  const [sTech, setSTech] = useState("");
  const [sName, setSName] = useState("");
  const [sOrg, setSOrg] = useState("");
  const [sRole, setSRole] = useState<StakeholderRole>("informed");

  const [depOpen, setDepOpen] = useState(false);
  const [depTarget, setDepTarget] = useState("");

  useEffect(() => {
    api.listTechnicians().then((rows) => setTeam(rows.filter((t) => t.active))).catch(() => setTeam([]));
  }, []);

  async function run(work: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    try {
      const result = await work();
      // Blocker calls return the blocker, not the project, so refetch either way.
      onChange((result && (result as Project).counts ? result : await api.getProject(project.id)) as Project);
      setError(null);
      after?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const blockers = [
    ...project.blockers.map((b) => ({ ...b, on: null as string | null })),
    ...project.issues.flatMap((i) =>
      (i.blockers ?? []).map((b) => ({ ...b, on: i.title, owner: null, ownerName: null, raisedBy: null, clearedBy: null, resolution: null })),
    ),
  ];
  const open = blockers.filter((b) => !b.clearedAt);
  const cleared = blockers.filter((b) => b.clearedAt);
  const { blockerState } = project;

  return (
    <div className="proj-gov">
      {error && <div className="banner banner-error">{error}</div>}

      {/* ---- blockers ------------------------------------------------- */}
      <section className="proj-gov-block">
        <div className="proj-gov-head">
          <h4>
            In the way{" "}
            {open.length > 0 ? (
              <span className="chip chip-warn">
                {open.length} open
                {blockerState.oldestOpenDays !== null && blockerState.oldestOpenDays > 0 && ` · oldest ${blockerState.oldestOpenDays}d`}
              </span>
            ) : (
              <span className="chip chip-ok">nothing</span>
            )}
          </h4>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setBOpen((v) => !v)}>
            {bOpen ? "Cancel" : "Raise a blocker"}
          </button>
        </div>

        {bOpen && (
          <div className="proj-gov-new">
            <label>
              Kind
              <select value={bKind} onChange={(e) => setBKind(e.target.value as BlockerKind)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {BLOCKER_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="is-wide">
              What is in the way
              <input value={bSummary} onChange={(e) => setBSummary(e.target.value)} maxLength={500} placeholder="No fogging machine on site" />
            </label>
            <label>
              Who is chasing it
              <select value={bOwner} onChange={(e) => setBOwner(e.target.value)}>
                <option value="">Somebody else…</option>
                {team.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            {!bOwner && (
              <label>
                Their name
                <input value={bOwnerName} onChange={(e) => setBOwnerName(e.target.value)} maxLength={120} placeholder="Head office, a supplier…" />
              </label>
            )}
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={busy || !bSummary.trim()}
              onClick={() =>
                run(
                  () =>
                    api.createBlocker({
                      projectId: project.id,
                      kind: bKind,
                      summary: bSummary.trim(),
                      ownerId: bOwner || undefined,
                      ownerName: bOwner ? undefined : bOwnerName.trim() || undefined,
                    }),
                  () => {
                    setBSummary("");
                    setBOwnerName("");
                    setBOpen(false);
                  },
                )
              }
            >
              Raise it
            </button>
          </div>
        )}

        {open.length === 0 && cleared.length === 0 ? (
          <p className="muted small">Nothing recorded as blocking this.</p>
        ) : (
          <ul className="blocker-list">
            {open.map((b) => (
              <li key={b.id} className="blocker is-open">
                <span className="blocker-kind">{BLOCKER_KIND_LABELS[b.kind]}</span>
                <span className="blocker-what">
                  {b.summary}
                  {b.on && <em className="muted"> · on {b.on}</em>}
                </span>
                <span className="muted small">
                  {daysSince(b.raisedAt)}d
                  {"owner" in b && b.owner ? ` · ${b.owner.name}` : b.ownerName ? ` · ${b.ownerName}` : ""}
                </span>
                {/* Only the project's own are clearable here; a job's blockers
                    belong on the job, where whoever is doing it will see them. */}
                {!b.on && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={busy}
                    onClick={() => {
                      const resolution = prompt("What sorted it out?") ?? undefined;
                      run(() => api.clearBlocker(b.id, { resolution }));
                    }}
                  >
                    Cleared
                  </button>
                )}
              </li>
            ))}
            {cleared.length > 0 && (
              <li className="blocker-more">
                <button type="button" className="btn btn-ghost btn-small" onClick={() => setShowCleared((v) => !v)}>
                  {showCleared ? "Hide" : `${cleared.length} cleared`}
                  {blockerState.meanDaysToClear !== null && ` · ${blockerState.meanDaysToClear}d on average`}
                </button>
              </li>
            )}
            {showCleared &&
              cleared.map((b) => (
                <li key={b.id} className="blocker is-cleared">
                  <span className="blocker-kind">{BLOCKER_KIND_LABELS[b.kind]}</span>
                  <span className="blocker-what">
                    {b.summary}
                    {"resolution" in b && b.resolution && <em className="muted"> · {b.resolution}</em>}
                  </span>
                  <span className="muted small">
                    cleared {b.clearedAt ? formatDate(b.clearedAt) : ""}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* ---- stakeholders --------------------------------------------- */}
      <section className="proj-gov-block">
        <div className="proj-gov-head">
          <h4>Who is involved</h4>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setSOpen((v) => !v)}>
            {sOpen ? "Cancel" : "Add somebody"}
          </button>
        </div>

        {sOpen && (
          <div className="proj-gov-new">
            <label>
              From the team
              <select
                value={sTech}
                onChange={(e) => {
                  setSTech(e.target.value);
                  if (e.target.value) setSName("");
                }}
              >
                <option value="">Somebody else…</option>
                {team.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            {!sTech && (
              <>
                <label>
                  Name
                  <input value={sName} onChange={(e) => setSName(e.target.value)} maxLength={120} placeholder="Fred" />
                </label>
                <label>
                  Organisation
                  <input value={sOrg} onChange={(e) => setSOrg(e.target.value)} maxLength={120} placeholder="Head office" />
                </label>
              </>
            )}
            <label>
              Role
              <select value={sRole} onChange={(e) => setSRole(e.target.value as StakeholderRole)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {STAKEHOLDER_ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={busy || (!sTech && !sName.trim())}
              onClick={() =>
                run(
                  () =>
                    api.addStakeholder(project.id, {
                      technicianId: sTech || undefined,
                      name: sTech ? undefined : sName.trim(),
                      organisation: sOrg.trim() || undefined,
                      role: sRole,
                    }),
                  () => {
                    setSName("");
                    setSOrg("");
                    setSTech("");
                    setSOpen(false);
                  },
                )
              }
            >
              Add
            </button>
          </div>
        )}

        {project.stakeholders.length === 0 ? (
          <p className="muted small">
            Nobody recorded. Worth filling in — the usual failure on this kind of work is not disagreement, it is
            somebody finding out late.
          </p>
        ) : (
          <ul className="stake-list">
            {project.stakeholders.map((s) => (
              <li key={s.id} className={`stake role-${s.role}`}>
                <span className="stake-who">
                  {s.technician?.name ?? s.name}
                  {s.organisation && <em className="muted"> · {s.organisation}</em>}
                </span>
                <select
                  className="stake-role"
                  value={s.role}
                  disabled={busy}
                  onChange={(e) => run(() => api.updateStakeholder(project.id, s.id, { role: e.target.value as StakeholderRole }))}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {STAKEHOLDER_ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-ghost btn-small danger" disabled={busy} onClick={() => run(() => api.removeStakeholder(project.id, s.id))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- dependencies between projects ---------------------------- */}
      <section className="proj-gov-block">
        <div className="proj-gov-head">
          <h4>Waits on, and holds up</h4>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setDepOpen((v) => !v)}>
            {depOpen ? "Cancel" : "Add a dependency"}
          </button>
        </div>

        {depOpen && (
          <div className="proj-gov-new">
            <label className="is-wide">
              This project must finish before
              <select value={depTarget} onChange={(e) => setDepTarget(e.target.value)}>
                <option value="">Choose a project…</option>
                {allProjects.filter((p) => p.id !== project.id).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={busy || !depTarget}
              onClick={() =>
                run(() => api.linkProjects(project.id, { toProjectId: depTarget, kind: "precedes" }), () => {
                  setDepTarget("");
                  setDepOpen(false);
                })
              }
            >
              Link them
            </button>
          </div>
        )}

        {project.linksIn.length === 0 && project.linksOut.length === 0 ? (
          <p className="muted small">This project does not wait on anything, and nothing waits on it.</p>
        ) : (
          <ul className="dep-list">
            {project.linksIn.map((l) => (
              <li key={l.id} className="dep">
                <span className="dep-dir muted small">after</span>
                <span className="dep-what">{l.from?.name}</span>
                <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => run(() => api.unlinkProjects(project.id, l.id))}>
                  Remove
                </button>
              </li>
            ))}
            {project.linksOut.map((l) => (
              <li key={l.id} className="dep">
                <span className="dep-dir muted small">{l.kind === "precedes" ? "before" : l.kind}</span>
                <span className="dep-what">{l.to?.name}</span>
                <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => run(() => api.unlinkProjects(project.id, l.id))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
