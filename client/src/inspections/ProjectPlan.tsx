import { useEffect, useState } from "react";
import { api } from "../api";
import { formatDate } from "../lib/dates";
import type { Contractor, Project, ProjectStatus, Quote, Technician } from "../types";

const STATUS_CHOICES: { key: ProjectStatus; label: string }[] = [
  { key: "planning", label: "Planning" },
  { key: "open", label: "Under way" },
  { key: "on_hold", label: "On hold" },
  { key: "done", label: "Done" },
  { key: "cancelled", label: "Cancelled" },
];

/** Bare numbers, like the rest of the app — it is single-currency. */
function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * The parts of a project that are true of the whole: who owns it, what the plan
 * was before it moved, what was approved, and whether the quotes are in.
 *
 * Deliberately a panel inside the projects list rather than a page of its own.
 * A plan read apart from the work it covers is how a plan stops matching reality.
 */
export default function ProjectPlan({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const [team, setTeam] = useState<Technician[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState(project.budgetAmount == null ? "" : String(project.budgetAmount));

  // A quote being added.
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [qContractor, setQContractor] = useState("");
  const [qAmount, setQAmount] = useState("");
  const [qRef, setQRef] = useState("");

  useEffect(() => {
    api.listTechnicians().then((rows) => setTeam(rows.filter((t) => t.active))).catch(() => setTeam([]));
    api.listContractors().then((rows) => setContractors(rows.filter((c) => c.active))).catch(() => setContractors([]));
  }, []);

  async function run(work: () => Promise<Project>) {
    setBusy(true);
    try {
      onChange(await work());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const save = (data: Parameters<typeof api.updateProject>[1]) => run(() => api.updateProject(project.id, data));

  async function baseline() {
    setBusy(true);
    try {
      onChange(await api.baselineProject(project.id));
      setError(null);
    } catch (e: any) {
      // Re-baselining is refused once, then confirmed — it hides the slippage
      // against the plan that was originally agreed.
      if (confirm(`${e.message}\n\nFreeze the plan as it stands now?`)) {
        try {
          onChange(await api.baselineProject(project.id, true));
          setError(null);
        } catch (e2: any) {
          setError(e2.message);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function addQuote() {
    if (!qContractor) return;
    setBusy(true);
    try {
      await api.createQuote({
        projectId: project.id,
        contractorId: qContractor,
        amount: qAmount.trim() === "" ? null : Number(qAmount),
        status: qAmount.trim() === "" ? "requested" : "received",
        reference: qRef.trim() || null,
      });
      onChange(await api.getProject(project.id));
      setQContractor("");
      setQAmount("");
      setQRef("");
      setQuoteOpen(false);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function award(quote: Quote) {
    setBusy(true);
    try {
      const result = await api.awardQuote(quote.id);
      // Awarding below the rule is allowed; it says so rather than refusing.
      if (result.warning) alert(result.warning);
      onChange(await api.getProject(project.id));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const { budget, schedule, counts, quoteState } = project;
  const slip = schedule.slippageDays;

  return (
    <div className="proj-plan">
      {error && <div className="banner banner-error">{error}</div>}

      <div className="proj-plan-grid">
        <label>
          Owner
          <select value={project.ownerId ?? ""} onChange={(e) => save({ ownerId: e.target.value || null })} disabled={busy}>
            <option value="">Nobody yet</option>
            {team.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.trade ? ` · ${t.trade}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Stage
          <select value={project.status} onChange={(e) => save({ status: e.target.value as ProjectStatus })} disabled={busy}>
            {STATUS_CHOICES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Starts
          <input type="date" value={schedule.plannedStart ?? ""} onChange={(e) => save({ plannedStart: e.target.value || null })} disabled={busy} />
        </label>
        <label>
          Ends
          <input type="date" value={schedule.plannedEnd ?? ""} onChange={(e) => save({ plannedEnd: e.target.value || null })} disabled={busy} />
        </label>
      </div>

      {/* The baseline. This is the only number that says whether a project is
          drifting, which is why it is frozen deliberately rather than tracked. */}
      <div className="proj-plan-row">
        {schedule.baselined ? (
          <p className="muted small">
            Agreed plan: {schedule.baselineStart ?? "—"} to {schedule.baselineEnd ?? "—"}
            {slip !== null && slip !== 0 && (
              <strong className={slip > 0 ? "is-late" : "is-early"}>
                {" "}
                · {Math.abs(slip)} day{Math.abs(slip) === 1 ? "" : "s"} {slip > 0 ? "later than agreed" : "earlier than agreed"}
              </strong>
            )}
            {slip === 0 && " · on plan"}
          </p>
        ) : (
          <p className="muted small">No agreed plan recorded yet, so nothing can be said about slippage.</p>
        )}
        <button type="button" className="btn btn-secondary btn-small" onClick={baseline} disabled={busy || (!schedule.plannedStart && !schedule.plannedEnd)}>
          {schedule.baselined ? "Re-freeze the plan" : "Freeze this as the plan"}
        </button>
      </div>

      {/* Money three ways. Committed and actual are never added together: an
          awarded quote usually becomes the invoice behind the recorded cost. */}
      <div className="proj-money">
        <div className="proj-money-figures">
          <span>
            <small className="muted">Approved</small>
            <strong>{money(budget.approved)}</strong>
          </span>
          <span>
            <small className="muted">Committed</small>
            <strong>{money(budget.committed)}</strong>
          </span>
          <span>
            <small className="muted">Spent</small>
            <strong>{money(budget.actual)}</strong>
          </span>
          <span className={budget.overBudget ? "is-over" : ""}>
            <small className="muted">Left</small>
            <strong>{money(budget.remaining)}</strong>
          </span>
        </div>
        {budget.overBudget && <p className="banner banner-warn small">Committed or spent is past what was approved.</p>}
        <div className="proj-money-edit">
          <label>
            Budget
            <input
              type="number"
              min="0"
              step="0.01"
              value={budgetDraft}
              onChange={(e) => setBudgetDraft(e.target.value)}
              onBlur={() => {
                const next = budgetDraft.trim() === "" ? null : Number(budgetDraft);
                if (next !== project.budgetAmount) save({ budgetAmount: next });
              }}
              disabled={busy}
            />
          </label>
          {project.approved ? (
            <>
              <span className="muted small">
                Approved by {project.approvedBy} on {project.approvedAt ? formatDate(project.approvedAt) : "—"}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => run(() => api.approveProject(project.id, { approved: false }))}
                disabled={busy}
              >
                Withdraw approval
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={() => run(() => api.approveProject(project.id, { budgetAmount: budgetDraft.trim() === "" ? null : Number(budgetDraft) }))}
              disabled={busy}
            >
              Approve
            </button>
          )}
        </div>
      </div>

      <p className="muted small proj-rollup">
        {counts.leaves} job{counts.leaves === 1 ? "" : "s"} · {counts.done} done · {counts.open} open
        {counts.milestones > 0 && ` · ${counts.milestonesHit}/${counts.milestones} milestones hit`}
        {counts.estimatedHours > 0 && ` · ${counts.actualHours} of ${counts.estimatedHours}h clocked`}
      </p>

      {/* Quotes. The rule is reported, not imposed — a sole supplier and an
          emergency are both real, and a rule that blocked them would be worked
          around outside the app, where nobody can audit it. */}
      <div className="proj-quotes">
        <div className="proj-quotes-head">
          <h4>
            Quotes{" "}
            <span className={quoteState.satisfied ? "chip chip-ok" : "chip chip-warn"}>
              {quoteState.received} of 3{quoteState.satisfied ? "" : ` · ${quoteState.outstanding} to go`}
            </span>
          </h4>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setQuoteOpen((v) => !v)}>
            {quoteOpen ? "Cancel" : "Add a quote"}
          </button>
        </div>

        {quoteOpen && (
          <div className="proj-quote-new">
            <label>
              Contractor
              <select value={qContractor} onChange={(e) => setQContractor(e.target.value)}>
                <option value="">Choose…</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.trade ? ` · ${c.trade}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount
              <input type="number" min="0" step="0.01" value={qAmount} onChange={(e) => setQAmount(e.target.value)} placeholder="Leave blank if still out" />
            </label>
            <label>
              Reference
              <input value={qRef} onChange={(e) => setQRef(e.target.value)} maxLength={120} />
            </label>
            <button type="button" className="btn btn-primary btn-small" onClick={addQuote} disabled={busy || !qContractor}>
              Record it
            </button>
          </div>
        )}

        {project.quotes.length === 0 ? (
          <p className="muted small">No quotes recorded.</p>
        ) : (
          <ul className="proj-quote-list">
            {project.quotes.map((q) => (
              <li key={q.id} className={`proj-quote status-${q.status}`}>
                <span className="proj-quote-who">{q.contractor.name}</span>
                <span className="proj-quote-amount">{money(q.amount)}</span>
                <span className="muted small">
                  {q.status === "awarded"
                    ? `awarded${q.decidedBy ? ` by ${q.decidedBy}` : ""}`
                    : q.status === "received"
                      ? "received"
                      : q.status === "declined"
                        ? "declined"
                        : "out for quote"}
                  {q.reference ? ` · ${q.reference}` : ""}
                </span>
                {q.status === "received" && (
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => award(q)} disabled={busy}>
                    Award
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
