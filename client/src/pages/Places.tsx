import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useCan } from "../auth/AuthContext";
import {
  SELL_STATUS_LABELS, SELL_STATUSES, SPACE_KIND_LABELS,
  type Property, type SellStatus, type Space, type SpaceKind, type UnmatchedText,
} from "../types";

/** Children of a node, in order, so the tree renders depth-first. */
function childrenOf(spaces: Space[], parentId: string | null): Space[] {
  return spaces
    .filter((s) => s.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/**
 * Where things are: block, floor, space.
 *
 * The tree exists because "Room 214" as free text cannot answer the questions that
 * matter once a site is large — everything in Coubaril, every room on floor two,
 * how many sellable rooms are out of order. A string can be counted; it cannot be
 * walked.
 *
 * Two things on this screen carry most of its weight. Creating a run of rooms from
 * "101-140", because typed one at a time three hundred and forty rooms is an
 * afternoon nobody will spend and a half-entered tree is worse than none. And the
 * reconcile pass, which matches the free text already in the app to the tree a
 * piece at a time — the obvious couple of hundred at once, the handful that are
 * genuinely ambiguous by hand.
 */
export default function Places() {
  const can = useCan();
  const mayEdit = can("property.write");

  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [sell, setSell] = useState({ green: 0, amber: 0, red: 0, unset: 0, total: 0 });
  const [unmatched, setUnmatched] = useState<UnmatchedText[]>([]);
  const [certainCount, setCertainCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showReconcile, setShowReconcile] = useState(false);

  // Adding, under whichever node was chosen.
  const [addUnder, setAddUnder] = useState<string | null>(null);
  const [addKind, setAddKind] = useState<SpaceKind>("space");
  const [addNames, setAddNames] = useState("");
  const [addSellable, setAddSellable] = useState(false);

  useEffect(() => {
    api.listProperties()
      .then((p) => {
        setProperties(p);
        setPropertyId((cur) => cur || p[0]?.id || "");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const load = useCallback(() => {
    if (!propertyId) return;
    setLoading(true);
    Promise.all([api.listSpaces(propertyId), api.unmatchedSpaces(propertyId)])
      .then(([tree, un]) => {
        setSpaces(tree.spaces);
        setSell(tree.sell);
        setUnmatched(un.unmatched);
        setCertainCount(un.certain);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [propertyId]);

  useEffect(load, [load]);

  async function run(work: () => Promise<unknown>, message?: string) {
    setBusy(true);
    try {
      await work();
      load();
      setError(null);
      if (message) {
        setNote(message);
        setTimeout(() => setNote(null), 4000);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Depth-first, skipping anything under a collapsed node. */
  const visible = useMemo(() => {
    const out: Space[] = [];
    const walk = (parentId: string | null) => {
      for (const node of childrenOf(spaces, parentId)) {
        out.push(node);
        if (!collapsed.has(node.id)) walk(node.id);
      }
    };
    walk(null);
    return out;
  }, [spaces, collapsed]);

  const unmatchedTotal = unmatched.reduce((n, u) => n + u.total, 0);

  if (loading && !spaces.length) return <div className="page"><div className="loading-state">Loading…</div></div>;

  return (
    <div className="page places-page">
      <div className="page-header">
        <div>
          <h1>Places</h1>
          <p className="muted">
            Blocks, floors and the spaces in them. Work keeps whatever was typed into it and points at a space
            as somebody matches it up — nothing is rewritten.
          </p>
        </div>
        <div className="page-header-actions">
          <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} aria-label="Property">
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {note && <div className="banner banner-ok small">{note}</div>}

      {/* ---- the sell-status round ---------------------------------------- */}
      {sell.total > 0 && (
        <section className="places-sell">
          <span className="sell-chip s-green"><strong>{sell.green}</strong> sellable</span>
          <span className="sell-chip s-amber"><strong>{sell.amber}</strong> watch</span>
          <span className="sell-chip s-red"><strong>{sell.red}</strong> out of order</span>
          {/* Never folded into green: "nobody has looked" and "it is fine" are
              different, and only one of them is good news. */}
          <span className="sell-chip s-unset"><strong>{sell.unset}</strong> not looked at</span>
          <span className="muted small">of {sell.total} sellable rooms</span>
        </section>
      )}

      {/* ---- reconciling the free text ------------------------------------ */}
      {unmatched.length > 0 && (
        <section className="card places-reconcile">
          <div className="places-rec-head">
            <h2>Room names not yet matched</h2>
            <span className="muted small">
              {unmatched.length} distinct name{unmatched.length === 1 ? "" : "s"} across {unmatchedTotal} record
              {unmatchedTotal === 1 ? "" : "s"}
              {certainCount > 0 && ` · ${certainCount} unambiguous`}
            </span>
            {mayEdit && certainCount > 0 && (
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await api.reconcileSpaces({ propertyId, auto: true });
                    setNote(
                      `Matched ${result.texts} name${result.texts === 1 ? "" : "s"} — ${result.issues} job${result.issues === 1 ? "" : "s"} and ${result.inspections} walk${result.inspections === 1 ? "" : "s"}. ` +
                      `${result.remaining.issues + result.remaining.inspections} left for a person.`
                    );
                  })
                }
              >
                Match the {certainCount} that are certain
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setShowReconcile((v) => !v)}>
              {showReconcile ? "Hide" : "Show them"}
            </button>
          </div>

          {showReconcile && (
            <ul className="rec-list">
              {unmatched.slice(0, 60).map((u) => (
                <li key={u.text} className={u.certain ? "is-certain" : ""}>
                  <span className="rec-text">{u.text}</span>
                  <span className="muted small">
                    {u.issues ? `${u.issues} job${u.issues === 1 ? "" : "s"}` : ""}
                    {u.issues && u.inspections ? " · " : ""}
                    {u.inspections ? `${u.inspections} walk${u.inspections === 1 ? "" : "s"}` : ""}
                  </span>
                  {mayEdit ? (
                    u.matches.length ? (
                      <select
                        defaultValue={u.certain ?? ""}
                        disabled={busy}
                        onChange={(e) => {
                          if (!e.target.value) return;
                          run(() => api.reconcileSpaces({ propertyId, text: u.text, spaceId: e.target.value }));
                        }}
                      >
                        <option value="">
                          {u.certain ? "Matches one space" : `${u.matches.length} possible — choose one`}
                        </option>
                        {u.matches.map((m) => (
                          <option key={m.spaceId} value={m.spaceId}>
                            {m.path.join(" · ")} ({m.how})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="muted small">nothing in the tree looks like it</span>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ---- the tree ------------------------------------------------------ */}
      <section className="card places-tree">
        <div className="places-rec-head">
          <h2>The tree</h2>
          <span className="muted small">{spaces.length} space{spaces.length === 1 ? "" : "s"}</span>
          {mayEdit && (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setAddUnder(addUnder === null ? "__root" : null)}>
              {addUnder === "__root" ? "Cancel" : "Add a block"}
            </button>
          )}
        </div>

        {addUnder !== null && (
          <div className="places-add">
            <label>
              {addUnder === "__root" ? "Block name" : "Name, or a range"}
              <input
                value={addNames}
                onChange={(e) => setAddNames(e.target.value)}
                placeholder={addUnder === "__root" ? "Coubaril" : "101-140, or Pool plant room"}
                maxLength={200}
                autoFocus
              />
            </label>
            {addUnder !== "__root" && (
              <>
                <label>
                  Kind
                  <select value={addKind} onChange={(e) => setAddKind(e.target.value as SpaceKind)}>
                    <option value="floor">{SPACE_KIND_LABELS.floor}</option>
                    <option value="space">{SPACE_KIND_LABELS.space}</option>
                  </select>
                </label>
                <label className="places-check">
                  <input type="checkbox" checked={addSellable} onChange={(e) => setAddSellable(e.target.checked)} />
                  Rooms that can be sold
                </label>
              </>
            )}
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={busy || !addNames.trim()}
              onClick={() =>
                run(async () => {
                  const spec = addNames.trim();
                  const result = await api.createSpaces({
                    propertyId,
                    parentId: addUnder === "__root" ? null : addUnder,
                    kind: addUnder === "__root" ? "block" : addKind,
                    // A range goes through `names`; anything else is one name.
                    ...(/[-–,]/.test(spec) ? { names: spec } : { name: spec }),
                    sellable: addUnder === "__root" ? false : addSellable,
                  });
                  setAddNames("");
                  setAddUnder(null);
                  setNote(
                    result.skipped
                      ? `Added ${result.created}, and ${result.skipped} were already there.`
                      : `Added ${result.created}.`
                  );
                })
              }
            >
              Add
            </button>
            <span className="muted small">A range like 101-140 creates them all. Zero padding and letters are kept.</span>
          </div>
        )}

        {spaces.length === 0 ? (
          <p className="muted small">
            Nothing mapped out yet. Start with a block — Coubaril, Blue Suites — then floors, then a range of rooms.
          </p>
        ) : (
          <ul className="space-tree">
            {visible.map((space) => {
              const kids = childrenOf(spaces, space.id).length;
              return (
                <li key={space.id} className={`space-row kind-${space.kind}`} style={{ paddingLeft: 6 + space.depth * 18 }}>
                  {kids > 0 ? (
                    <button type="button" className="space-caret" aria-expanded={!collapsed.has(space.id)} onClick={() => toggle(space.id)}>
                      {collapsed.has(space.id) ? "▸" : "▾"}
                    </button>
                  ) : (
                    <span className="space-caret is-leaf" />
                  )}
                  <span className="space-name">{space.name}</span>
                  <span className="muted small">
                    {SPACE_KIND_LABELS[space.kind]}
                    {kids > 0 && ` · ${kids} inside`}
                  </span>
                  {space.sellable && mayEdit ? (
                    <select
                      className={`space-sell s-${space.sellStatus ?? "unset"}`}
                      value={space.sellStatus ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        run(() => api.updateSpace(space.id, { sellStatus: (e.target.value || null) as SellStatus | null }))
                      }
                      aria-label={`Sell status for ${space.name}`}
                    >
                      <option value="">Not looked at</option>
                      {SELL_STATUSES.map((s) => <option key={s} value={s}>{SELL_STATUS_LABELS[s]}</option>)}
                    </select>
                  ) : space.sellable ? (
                    <span className={`space-sell s-${space.sellStatus ?? "unset"}`}>
                      {space.sellStatus ? SELL_STATUS_LABELS[space.sellStatus] : "Not looked at"}
                    </span>
                  ) : null}
                  {mayEdit && (
                    <span className="space-actions">
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => { setAddUnder(space.id); setAddKind(space.kind === "block" ? "floor" : "space"); }}>
                        Add inside
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-small danger"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            try {
                              await api.deleteSpace(space.id);
                            } catch (e: any) {
                              if (confirm(`${e.message}\n\nDelete it anyway?`)) await api.deleteSpace(space.id, true);
                              else throw e;
                            }
                          })
                        }
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
