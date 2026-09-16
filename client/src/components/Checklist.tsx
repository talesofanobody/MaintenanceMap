import { useEffect, useState } from "react";
import { api } from "../api";
import type { ChecklistItem, Issue } from "../types";
import { formatDateTime } from "../lib/dates";

interface Props {
  issue: Issue;
  /** Whether the signed-in person may tick, add and remove steps. */
  editable: boolean;
  /** Called after any change so the parent can refetch the issue. */
  onChanged?: () => void;
}

/** Tick-box steps on an issue. Shown whenever there are steps, or when the viewer may add some. */
export default function Checklist({ issue, editable, onChanged }: Props) {
  const [items, setItems] = useState<ChecklistItem[]>(issue.checklist ?? []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Re-sync when the parent reloads the issue.
  const key = JSON.stringify(issue.checklist ?? []);
  useEffect(() => {
    setItems(issue.checklist ?? []);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = items.filter((i) => i.done).length;
  if (items.length === 0 && !editable) return null;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function toggle(item: ChecklistItem) {
    const next = !item.done;
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, done: next } : i)));
    run(async () => {
      const updated = await api.updateChecklistItem(issue.id, item.id, { done: next });
      setItems((list) => list.map((i) => (i.id === item.id ? updated : i)));
    });
  }

  // Not a <form>: the checklist lives inside the issue panel's form and must not submit it.
  function handleAdd() {
    const value = text.trim();
    if (!value) return;
    run(async () => {
      const created = await api.addChecklistItem(issue.id, value);
      setItems((list) => [...list, created]);
      setText("");
    });
  }

  function remove(item: ChecklistItem) {
    setItems((list) => list.filter((i) => i.id !== item.id));
    run(() => api.deleteChecklistItem(issue.id, item.id));
  }

  return (
    <div className="checklist">
      <div className="checklist-head">
        <span className="field-label">Checklist</span>
        {items.length > 0 && (
          <span className="checklist-progress">
            {done}/{items.length} done
          </span>
        )}
      </div>
      {items.length > 0 && (
        <div className="checklist-bar" aria-hidden="true">
          <span style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      )}
      {error && <div className="banner banner-error">{error}</div>}
      {items.length > 0 && (
        <ul className="checklist-list">
          {items.map((item) => (
            <li key={item.id} className={`checklist-item ${item.done ? "done" : ""}`}>
              <input type="checkbox" checked={item.done} disabled={!editable || busy} onChange={() => toggle(item)} aria-label={item.text} />
              <span>
                <span className="checklist-text">{item.text}</span>
                {item.done && item.doneAt && (
                  <span className="checklist-meta">
                    {item.doneBy ?? "someone"} · {formatDateTime(item.doneAt)}
                  </span>
                )}
              </span>
              {editable ? (
                <button type="button" className="btn-icon" aria-label={`Remove step: ${item.text}`} title="Remove step" disabled={busy} onClick={() => remove(item)}>
                  ×
                </button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
      )}
      {editable &&
        (adding || items.length === 0 ? (
          <div className="checklist-add">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder="Add a step, e.g. Check seals"
              maxLength={200}
              aria-label="New checklist step"
            />
            <button type="button" className="btn btn-secondary btn-small" disabled={busy || !text.trim()} onClick={handleAdd}>
              Add
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setAdding(true)} style={{ alignSelf: "flex-start" }}>
            + Add step
          </button>
        ))}
    </div>
  );
}
