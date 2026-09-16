import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { COST_KIND_LABELS, type Contractor, type Cost, type CostKind, type CostSummary, type Issue } from "../types";
import { todayStr } from "../lib/capacity";

interface Props {
  issue: Issue;
  editable: boolean;
  onChanged?: () => void;
}

const KINDS: CostKind[] = ["parts", "contractor", "hire", "other"];

/** Formats money without assuming a currency symbol, since this runs anywhere. */
export function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Cost lines on one issue, plus labour valued from clocked time. */
export default function CostPanel({ issue, editable, onChanged }: Props) {
  const [lines, setLines] = useState<Cost[]>(issue.costs ?? []);
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ kind: "parts" as CostKind, description: "", amount: "", quantity: "1", contractorId: "", invoiceRef: "", incurredOn: todayStr() });

  const load = useCallback(() => {
    api
      .listCosts(issue.id)
      .then((r) => {
        setLines(r.lines);
        setSummary(r.summary);
      })
      .catch((e) => setError(e.message));
  }, [issue.id]);

  useEffect(load, [load]);
  useEffect(() => {
    if (editable) api.listContractors().then(setContractors).catch(() => {});
  }, [editable]);

  async function add() {
    const amount = Number(draft.amount);
    if (!draft.description.trim() || !Number.isFinite(amount)) return;
    setBusy(true);
    setError(null);
    try {
      await api.addCost(issue.id, {
        kind: draft.kind,
        description: draft.description.trim(),
        amount,
        quantity: Number(draft.quantity) || 1,
        contractorId: draft.contractorId || null,
        invoiceRef: draft.invoiceRef.trim() || null,
        incurredOn: draft.incurredOn,
      });
      setDraft({ ...draft, description: "", amount: "", quantity: "1", invoiceRef: "" });
      setAdding(false);
      load();
      onChanged?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(cost: Cost) {
    if (!confirm(`Remove "${cost.description}" from this issue's costs?`)) return;
    setBusy(true);
    try {
      await api.deleteCost(issue.id, cost.id);
      load();
      onChanged?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const hasAnything = lines.length > 0 || (summary?.labour ?? 0) > 0;
  if (!hasAnything && !editable) return null;

  return (
    <div className="costs">
      <div className="costs-head">
        <span className="field-label">Costs</span>
        {summary && summary.total > 0 && <span className="costs-total">{money(summary.total)}</span>}
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {lines.length > 0 && (
        <ul className="costs-list">
          {lines.map((c) => (
            <li key={c.id}>
              <span className={`costs-kind kind-${c.kind}`}>{COST_KIND_LABELS[c.kind].split(" ")[0]}</span>
              <span className="costs-desc">
                {c.description}
                <span className="costs-meta">
                  {c.incurredOn}
                  {c.contractor ? ` · ${c.contractor.name}` : ""}
                  {c.invoiceRef ? ` · ${c.invoiceRef}` : ""}
                  {c.quantity !== 1 ? ` · ${c.quantity} × ${money(c.amount)}` : ""}
                </span>
              </span>
              <span className="costs-amount">{money(c.amount * c.quantity)}</span>
              {editable ? (
                <button type="button" className="btn-icon" aria-label={`Remove cost: ${c.description}`} disabled={busy} onClick={() => remove(c)}>
                  ×
                </button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
      )}

      {summary && summary.labour > 0 && (
        <div className="costs-labour">
          <span>
            Labour · {summary.labourHours.toFixed(2)} h clocked
            <span className="costs-meta">Valued at the technician's rate</span>
          </span>
          <strong>{money(summary.labour)}</strong>
        </div>
      )}

      {editable &&
        (adding ? (
          <div className="cost-form">
            <label>
              Type
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as CostKind })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {COST_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input type="date" value={draft.incurredOn} onChange={(e) => setDraft({ ...draft, incurredOn: e.target.value })} />
            </label>
            <label className="span-2">
              Description
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="e.g. Replacement thermostat"
                maxLength={200}
                aria-label="Cost description"
              />
            </label>
            <label>
              Amount each
              <input
                type="number"
                min={0}
                step={0.01}
                inputMode="decimal"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                placeholder="0.00"
                aria-label="Cost amount"
              />
            </label>
            <label>
              Quantity
              <input type="number" min={0} step={1} inputMode="decimal" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} aria-label="Cost quantity" />
            </label>
            <label>
              Contractor <span className="muted">(optional)</span>
              <select value={draft.contractorId} onChange={(e) => setDraft({ ...draft, contractorId: e.target.value })}>
                <option value="">None</option>
                {contractors
                  .filter((c) => c.active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.trade ? ` · ${c.trade}` : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Invoice ref <span className="muted">(optional)</span>
              <input value={draft.invoiceRef} onChange={(e) => setDraft({ ...draft, invoiceRef: e.target.value })} placeholder="e.g. INV-2043" maxLength={80} />
            </label>
            <div className="cost-form-actions">
              <button type="button" className="btn btn-secondary btn-small" disabled={busy || !draft.description.trim() || draft.amount === ""} onClick={add}>
                Add cost
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-small" style={{ alignSelf: "flex-start" }} onClick={() => setAdding(true)}>
            + Add cost
          </button>
        ))}
    </div>
  );
}
