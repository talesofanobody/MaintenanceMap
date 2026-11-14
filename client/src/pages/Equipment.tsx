import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useCan } from "../auth/AuthContext";
import {
  ASSET_KIND_LABELS, ASSET_KINDS, RELATION_KINDS, RELATION_LABELS,
  SERVICE_KIND_LABELS, SERVICE_KINDS, SERVICE_STATE_LABELS,
  type Asset, type AssetDetail, type AssetKind, type Property, type RelationKind,
  type ServiceKind, type ServiceState, type Space, type SpaceTrace,
} from "../types";

/** Service state decides the colour, so the list can be read without reading it. */
const STATE_CLASS: Record<ServiceState, string> = {
  overdue: "eq-chip eq-chip-red",
  never: "eq-chip eq-chip-red",
  due: "eq-chip eq-chip-amber",
  ok: "eq-chip eq-chip-green",
  unknown: "eq-chip eq-chip-grey",
};

function assetLabel(a: { name: string; ref?: string | null }): string {
  return a.ref && a.ref !== a.name ? `${a.ref} — ${a.name}` : a.name;
}

/**
 * The property manual: equipment, and what it does to everything else.
 *
 * The register is the easy half of this screen. The half that earns its keep is
 * the relation graph, because the questions that cost time on site are not "what
 * is this" but "what else goes dark if I open it" and "where do I isolate this
 * room" — and both are graph walks that no spreadsheet column can answer.
 *
 * Two things carry most of the weight here. The blast radius, which reads the
 * supply graph forward from a breaker or a valve and names the rooms rather than
 * the sub-panel in between, because the sub-panel is not what anybody is asking
 * about. And the trace, which runs the same graph backwards from a room, because
 * that is the direction somebody standing in the room needs it.
 */
export default function Equipment() {
  const can = useCan();
  const mayEdit = can("property.write");

  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [spaces, setSpaces] = useState<(Space & { path: string[] })[]>([]);
  const [dueCounts, setDueCounts] = useState({ overdue: 0, never: 0, dueSoon: 0 });
  const [kindFilter, setKindFilter] = useState<"" | AssetKind>("");
  const [search, setSearch] = useState("");
  const [onlyDue, setOnlyDue] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Adding equipment.
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: "", kind: "panel" as AssetKind, ref: "", spaceId: "", parentId: "",
    manufacturer: "", model: "", serialNumber: "", rating: "",
    installedAt: "", lastServicedAt: "", serviceIntervalDays: "", notes: "",
  });

  // Adding a relation to whatever is selected.
  const [relKind, setRelKind] = useState<RelationKind>("feeds");
  const [relTargetKind, setRelTargetKind] = useState<"space" | "asset">("space");
  const [relTarget, setRelTarget] = useState("");

  // Logging a service.
  const [showService, setShowService] = useState(false);
  const [svc, setSvc] = useState({ kind: "service" as ServiceKind, performedAt: "", performedBy: "", summary: "", reading: "", unit: "" });

  // The trace, from a room's end.
  const [traceSpaceId, setTraceSpaceId] = useState("");
  const [trace, setTrace] = useState<SpaceTrace | null>(null);

  useEffect(() => {
    api.listProperties()
      .then((p) => {
        setProperties(p);
        setPropertyId((cur) => cur || p[0]?.id || "");
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const [reg, tree, due] = await Promise.all([
        api.listAssets(propertyId),
        api.listSpaces(propertyId),
        api.assetsDue(propertyId),
      ]);
      setAssets(reg.assets);
      setSpaces(tree.spaces as (Space & { path: string[] })[]);
      setDueCounts(due.counts);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { void load(); }, [load]);

  const openAsset = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    try {
      setDetail(await api.getAsset(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const run = async (fn: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (message) setNote(message);
      await load();
      if (selectedId) setDetail(await api.getAsset(selectedId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const spacePath = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of spaces) m.set(s.id, s.path.join(" · "));
    return m;
  }, [spaces]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (kindFilter && a.kind !== kindFilter) return false;
      if (onlyDue && (a.service.state === "ok" || a.service.state === "unknown")) return false;
      if (!q) return true;
      return [a.name, a.ref, a.model, a.serialNumber, a.manufacturer]
        .some((v) => v && v.toLowerCase().includes(q));
    });
  }, [assets, kindFilter, onlyDue, search]);

  const byKind = useMemo(() => {
    const groups = new Map<AssetKind, Asset[]>();
    for (const a of shown) {
      const list = groups.get(a.kind) ?? [];
      list.push(a);
      groups.set(a.kind, list);
    }
    return [...groups.entries()].sort((a, b) =>
      (ASSET_KIND_LABELS[a[0]] ?? a[0]).localeCompare(ASSET_KIND_LABELS[b[0]] ?? b[0]));
  }, [shown]);

  const sellableRooms = useMemo(() => spaces.filter((s) => s.sellable).length, [spaces]);

  if (loading && assets.length === 0) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page equipment-page">
      <div className="page-header">
        <div>
          <h1>Equipment</h1>
          <p className="muted">
            What is on site, where it is, and what it controls. The relations are what
            answer “what else goes dark” — a register on its own cannot.
          </p>
        </div>
        <div className="page-header-actions">
          <select
            value={propertyId}
            aria-label="Property"
            onChange={(e) => { setPropertyId(e.target.value); setSelectedId(null); setDetail(null); setTrace(null); setTraceSpaceId(""); }}
          >
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {note && <div className="banner banner-ok" onClick={() => setNote(null)}>{note}</div>}

      {/* ---- what is out of date ---------------------------------------- */}
      {(dueCounts.overdue > 0 || dueCounts.never > 0 || dueCounts.dueSoon > 0) && (
        <div className="banner banner-warn eq-due-banner">
          <span>
            {dueCounts.overdue > 0 && <strong>{dueCounts.overdue} overdue</strong>}
            {dueCounts.overdue > 0 && (dueCounts.never > 0 || dueCounts.dueSoon > 0) ? " · " : ""}
            {dueCounts.never > 0 && <>{dueCounts.never} never serviced</>}
            {dueCounts.never > 0 && dueCounts.dueSoon > 0 ? " · " : ""}
            {dueCounts.dueSoon > 0 && <>{dueCounts.dueSoon} due within the week</>}
          </span>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setOnlyDue((v) => !v)}>
            {onlyDue ? "Show everything" : "Show only these"}
          </button>
        </div>
      )}

      {/* ---- trace a room ------------------------------------------------ */}
      <section className="card eq-trace">
        <div className="eq-row-head">
          <h2>Trace a room</h2>
          <span className="muted small">What feeds it, and where to shut it off</span>
        </div>
        <div className="eq-trace-controls">
          <select
            value={traceSpaceId}
            onChange={async (e) => {
              const id = e.target.value;
              setTraceSpaceId(id);
              setTrace(null);
              if (!id) return;
              try {
                setTrace(await api.traceSpace(id));
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <option value="">Choose a room or space…</option>
            {spaces.map((s) => <option key={s.id} value={s.id}>{s.path.join(" · ")}</option>)}
          </select>
        </div>

        {trace && (
          <div className="eq-trace-result">
            <div>
              <h3>Fed by</h3>
              {trace.fedBy.length === 0 ? (
                <p className="muted small">
                  Nothing recorded yet. Until something feeds it, this room cannot be traced —
                  which is a gap in the records rather than a room with no supply.
                </p>
              ) : (
                <ol className="eq-chain">
                  {trace.fedBy.map((f) => (
                    <li key={f.id}>
                      <button type="button" className="link-button" onClick={() => void openAsset(f.id)}>
                        {f.asset ? assetLabel(f.asset) : f.id}
                      </button>
                      <span className="muted small"> · {f.depth === 1 ? "directly" : `${f.depth} hops`}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div>
              <h3>Isolate at</h3>
              {trace.isolateAt.length === 0 ? (
                <p className="muted small">No isolation point recorded.</p>
              ) : (
                <>
                  <ol className="eq-chain">
                    {trace.isolateAt.map((f) => (
                      <li key={f.id}>
                        <button type="button" className="link-button" onClick={() => void openAsset(f.id)}>
                          {f.asset ? assetLabel(f.asset) : f.id}
                        </button>
                      </li>
                    ))}
                  </ol>
                  <p className="muted small">
                    Most local first. The first one on this list is the smallest thing that
                    does the job; the ones below it take out more than this room.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="eq-body">
        {/* ---- the register ---------------------------------------------- */}
        <section className="card eq-list">
          <div className="eq-row-head">
            <h2>Register</h2>
            <span className="muted small">{shown.length} of {assets.length}</span>
            {mayEdit && (
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setShowAdd((v) => !v)}>
                {showAdd ? "Cancel" : "Add equipment"}
              </button>
            )}
          </div>

          <div className="eq-filters">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, reference, serial…"
              maxLength={120}
            />
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as "" | AssetKind)}>
              <option value="">Every kind</option>
              {ASSET_KINDS.map((k) => <option key={k} value={k}>{ASSET_KIND_LABELS[k]}</option>)}
            </select>
          </div>

          {showAdd && mayEdit && (
            <div className="eq-add">
              <label>
                Name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="DB-3" maxLength={200} autoFocus />
              </label>
              <label>
                Reference
                <input value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} placeholder="What people say out loud" maxLength={60} />
              </label>
              <label>
                Kind
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as AssetKind })}>
                  {ASSET_KINDS.map((k) => <option key={k} value={k}>{ASSET_KIND_LABELS[k]}</option>)}
                </select>
              </label>
              <label>
                Where it is
                <select value={form.spaceId} onChange={(e) => setForm({ ...form, spaceId: e.target.value })}>
                  <option value="">Not recorded</option>
                  {spaces.map((s) => <option key={s.id} value={s.id}>{s.path.join(" · ")}</option>)}
                </select>
              </label>
              <label>
                Inside
                <select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
                  <option value="">Nothing</option>
                  {assets.map((a) => <option key={a.id} value={a.id}>{assetLabel(a)}</option>)}
                </select>
              </label>
              <label>
                Rating
                <input value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} placeholder="80A, 250 kVA" maxLength={120} />
              </label>
              <label>
                Manufacturer
                <input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} maxLength={120} />
              </label>
              <label>
                Model
                <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} maxLength={120} />
              </label>
              <label>
                Serial
                <input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} maxLength={120} />
              </label>
              <label>
                Installed
                <input type="date" value={form.installedAt} onChange={(e) => setForm({ ...form, installedAt: e.target.value })} />
              </label>
              <label>
                Last serviced
                <input type="date" value={form.lastServicedAt} onChange={(e) => setForm({ ...form, lastServicedAt: e.target.value })} />
              </label>
              <label>
                Service every (days)
                <input
                  type="number" min={1} max={3650}
                  value={form.serviceIntervalDays}
                  onChange={(e) => setForm({ ...form, serviceIntervalDays: e.target.value })}
                  placeholder="90"
                />
              </label>
              <label className="eq-add-wide">
                Notes
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} maxLength={2000} />
              </label>
              <div className="eq-add-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={busy || !form.name.trim()}
                  onClick={() =>
                    run(async () => {
                      const created = await api.createAsset({
                        propertyId,
                        name: form.name.trim(),
                        kind: form.kind,
                        ref: form.ref.trim() || null,
                        spaceId: form.spaceId || null,
                        parentId: form.parentId || null,
                        manufacturer: form.manufacturer.trim() || null,
                        model: form.model.trim() || null,
                        serialNumber: form.serialNumber.trim() || null,
                        rating: form.rating.trim() || null,
                        installedAt: form.installedAt || null,
                        lastServicedAt: form.lastServicedAt || null,
                        serviceIntervalDays: form.serviceIntervalDays ? Number(form.serviceIntervalDays) : null,
                        notes: form.notes.trim() || null,
                      });
                      setForm({
                        name: "", kind: form.kind, ref: "", spaceId: form.spaceId, parentId: "",
                        manufacturer: "", model: "", serialNumber: "", rating: "",
                        installedAt: "", lastServicedAt: "", serviceIntervalDays: form.serviceIntervalDays, notes: "",
                      });
                      setShowAdd(false);
                      void openAsset(created.asset.id);
                    }, "Added.")
                  }
                >
                  Add
                </button>
                <span className="muted small">
                  An interval here is what puts it on the overdue list — the ninety-day
                  standard lives on the equipment, not in a separate tracker.
                </span>
              </div>
            </div>
          )}

          {assets.length === 0 ? (
            <p className="muted">
              Nothing logged yet. Start with the things that take out more than one room when
              they fail — boards, risers, generators — because those are the ones worth tracing.
            </p>
          ) : shown.length === 0 ? (
            <p className="muted">Nothing matches that.</p>
          ) : (
            byKind.map(([kind, list]) => (
              <div key={kind} className="eq-group">
                <h3>{ASSET_KIND_LABELS[kind] ?? kind} <span className="muted small">{list.length}</span></h3>
                <ul className="eq-items">
                  {list.map((a) => (
                    <li key={a.id} className={a.id === selectedId ? "eq-item eq-item-on" : "eq-item"}>
                      <button type="button" className="eq-item-btn" onClick={() => void openAsset(a.id)}>
                        <span className="eq-item-name">{assetLabel(a)}</span>
                        {a.spaceName && a.spaceName.length > 0 && (
                          <span className="muted small">{a.spaceName.join(" · ")}</span>
                        )}
                      </button>
                      <span className={STATE_CLASS[a.service.state]} title={a.service.dueOn ? `Due ${a.service.dueOn}` : undefined}>
                        {a.service.state === "overdue" && a.service.daysOverdue !== null
                          ? `${a.service.daysOverdue}d over`
                          : SERVICE_STATE_LABELS[a.service.state]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>

        {/* ---- one piece of equipment ----------------------------------- */}
        <section className="card eq-detail">
          {!selectedId ? (
            <p className="muted">Choose something on the left.</p>
          ) : !detail ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <div className="eq-row-head">
                <h2>{assetLabel(detail.asset)}</h2>
                <span className={STATE_CLASS[detail.asset.service.state]}>
                  {SERVICE_STATE_LABELS[detail.asset.service.state]}
                  {detail.asset.service.dueOn ? ` · due ${detail.asset.service.dueOn}` : ""}
                </span>
              </div>

              <dl className="eq-facts">
                <div><dt>Kind</dt><dd>{ASSET_KIND_LABELS[detail.asset.kind] ?? detail.asset.kind}</dd></div>
                {detail.asset.space && <div><dt>Where</dt><dd>{spacePath.get(detail.asset.space.id) ?? detail.asset.space.name}</dd></div>}
                {detail.asset.parent && <div><dt>Inside</dt><dd>
                  <button type="button" className="link-button" onClick={() => void openAsset(detail.asset.parent!.id)}>{detail.asset.parent.name}</button>
                </dd></div>}
                {detail.asset.rating && <div><dt>Rating</dt><dd>{detail.asset.rating}</dd></div>}
                {detail.asset.manufacturer && <div><dt>Make</dt><dd>{detail.asset.manufacturer} {detail.asset.model ?? ""}</dd></div>}
                {detail.asset.serialNumber && <div><dt>Serial</dt><dd>{detail.asset.serialNumber}</dd></div>}
                {detail.asset.installedAt && <div><dt>Installed</dt><dd>{detail.asset.installedAt.slice(0, 10)}</dd></div>}
                {detail.asset.serviceIntervalDays && <div><dt>Interval</dt><dd>every {detail.asset.serviceIntervalDays} days</dd></div>}
                {detail.asset.lastServicedAt && <div><dt>Last serviced</dt><dd>{detail.asset.lastServicedAt.slice(0, 10)}</dd></div>}
              </dl>
              {detail.asset.notes && <p className="eq-notes">{detail.asset.notes}</p>}

              {/* The headline answer. */}
              <div className="eq-blast">
                <h3>If this is isolated</h3>
                {detail.affects.spaces.length === 0 && detail.affects.assets.length === 0 ? (
                  <p className="muted small">
                    Nothing is recorded downstream, so nothing can be said. That is an empty
                    record rather than a safe isolation — record what it feeds before relying on it.
                  </p>
                ) : (
                  <>
                    <p className="eq-blast-headline">
                      <strong>{detail.affects.spaces.length}</strong> space{detail.affects.spaces.length === 1 ? "" : "s"} affected
                      {detail.affects.sellableCount > 0 && (
                        <>, <strong>{detail.affects.sellableCount}</strong> of them sellable
                          {sellableRooms > 0 && <span className="muted small"> of {sellableRooms}</span>}
                        </>
                      )}
                      {detail.affects.assets.length > 0 && (
                        <span className="muted small"> · through {detail.affects.assets.length} other item{detail.affects.assets.length === 1 ? "" : "s"}</span>
                      )}
                    </p>
                    {detail.affects.truncated && (
                      <p className="muted small">
                        The walk hit its depth limit, so this list may be incomplete — usually a
                        loop or an unusually deep chain in the records.
                      </p>
                    )}
                    <ul className="eq-affected">
                      {detail.affects.spaces.map((s) => (
                        <li key={s.id}>
                          {s.space ? s.space.path.join(" · ") : s.id}
                          {s.space?.sellable && <span className="eq-sellable" title="A sellable room">·</span>}
                          <span className="muted small"> {s.depth === 1 ? "direct" : `${s.depth} hops`}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              {detail.fedBy.length > 0 && (
                <div className="eq-fedby">
                  <h3>Fed by</h3>
                  <ol className="eq-chain">
                    {detail.fedBy.map((f) => (
                      <li key={f.id}>
                        <button type="button" className="link-button" onClick={() => void openAsset(f.id)}>
                          {f.asset ? assetLabel(f.asset) : f.id}
                        </button>
                        <span className="muted small"> · {RELATION_LABELS[f.via] ?? f.via}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* ---- relations ------------------------------------------ */}
              <div className="eq-relations">
                <h3>What it does</h3>
                {detail.asset.relationsOut.length === 0 ? (
                  <p className="muted small">Nothing recorded.</p>
                ) : (
                  <ul className="eq-rel-list">
                    {detail.asset.relationsOut.map((r) => (
                      <li key={r.id}>
                        <span className="eq-rel-kind">{RELATION_LABELS[r.kind] ?? r.kind}</span>
                        {r.to ? (
                          <button type="button" className="link-button" onClick={() => void openAsset(r.to!.id)}>{assetLabel(r.to)}</button>
                        ) : (
                          <span>{r.toSpace ? spacePath.get(r.toSpace.id) ?? r.toSpace.name : "—"}</span>
                        )}
                        {mayEdit && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-small"
                            disabled={busy}
                            onClick={() => run(() => api.removeRelation(detail.asset.id, r.id), "Removed.")}
                          >
                            Remove
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {mayEdit && (
                  <div className="eq-rel-add">
                    <select value={relKind} onChange={(e) => setRelKind(e.target.value as RelationKind)}>
                      {RELATION_KINDS.map((k) => <option key={k} value={k}>{RELATION_LABELS[k]}</option>)}
                    </select>
                    <select value={relTargetKind} onChange={(e) => { setRelTargetKind(e.target.value as "space" | "asset"); setRelTarget(""); }}>
                      <option value="space">a space</option>
                      <option value="asset">equipment</option>
                    </select>
                    <select value={relTarget} onChange={(e) => setRelTarget(e.target.value)}>
                      <option value="">Choose…</option>
                      {relTargetKind === "space"
                        ? spaces.map((s) => <option key={s.id} value={s.id}>{s.path.join(" · ")}</option>)
                        : assets.filter((a) => a.id !== detail.asset.id).map((a) => <option key={a.id} value={a.id}>{assetLabel(a)}</option>)}
                    </select>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      disabled={busy || !relTarget}
                      onClick={() =>
                        run(async () => {
                          await api.addRelation(detail.asset.id, {
                            kind: relKind,
                            ...(relTargetKind === "space" ? { toSpaceId: relTarget } : { toAssetId: relTarget }),
                          });
                          setRelTarget("");
                        }, "Recorded.")
                      }
                    >
                      Record
                    </button>
                  </div>
                )}
              </div>

              {/* ---- service history ------------------------------------ */}
              <div className="eq-services">
                <div className="eq-row-head">
                  <h3>History</h3>
                  {mayEdit && (
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => setShowService((v) => !v)}>
                      {showService ? "Cancel" : "Log work"}
                    </button>
                  )}
                </div>

                {showService && mayEdit && (
                  <div className="eq-svc-form">
                    <label>
                      What
                      <select value={svc.kind} onChange={(e) => setSvc({ ...svc, kind: e.target.value as ServiceKind })}>
                        {SERVICE_KINDS.map((k) => <option key={k} value={k}>{SERVICE_KIND_LABELS[k]}</option>)}
                      </select>
                    </label>
                    <label>
                      When
                      <input type="date" value={svc.performedAt} onChange={(e) => setSvc({ ...svc, performedAt: e.target.value })} />
                    </label>
                    <label>
                      By
                      <input value={svc.performedBy} onChange={(e) => setSvc({ ...svc, performedBy: e.target.value })} maxLength={120} />
                    </label>
                    <label>
                      Reading
                      <input value={svc.reading} onChange={(e) => setSvc({ ...svc, reading: e.target.value })} placeholder="optional" maxLength={20} />
                    </label>
                    <label>
                      Unit
                      <input value={svc.unit} onChange={(e) => setSvc({ ...svc, unit: e.target.value })} placeholder="MΩ, bar" maxLength={20} />
                    </label>
                    <label className="eq-add-wide">
                      What was done
                      <textarea value={svc.summary} onChange={(e) => setSvc({ ...svc, summary: e.target.value })} rows={2} maxLength={2000} />
                    </label>
                    <div className="eq-add-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-small"
                        disabled={busy || !svc.summary.trim()}
                        onClick={() =>
                          run(async () => {
                            await api.logService(detail.asset.id, {
                              kind: svc.kind,
                              performedAt: svc.performedAt || null,
                              performedBy: svc.performedBy.trim() || null,
                              summary: svc.summary.trim(),
                              reading: svc.reading.trim() === "" ? null : svc.reading.trim(),
                              unit: svc.unit.trim() || null,
                            });
                            setSvc({ kind: "service", performedAt: "", performedBy: "", summary: "", reading: "", unit: "" });
                            setShowService(false);
                          }, "Logged.")
                        }
                      >
                        Log it
                      </button>
                      <span className="muted small">
                        A service or a replacement resets the clock. A repair, test or inspection
                        is recorded without resetting it, because a repair is not a service.
                      </span>
                    </div>
                  </div>
                )}

                {detail.asset.services.length === 0 ? (
                  <p className="muted small">Nothing logged.</p>
                ) : (
                  <ul className="eq-svc-list">
                    {detail.asset.services.map((s) => (
                      <li key={s.id}>
                        <span className="eq-svc-when">{s.performedAt.slice(0, 10)}</span>
                        <span className="eq-svc-kind">{SERVICE_KIND_LABELS[s.kind] ?? s.kind}</span>
                        <span className="eq-svc-what">
                          {s.summary}
                          {s.reading !== null && <span className="muted small"> · {s.reading}{s.unit ?? ""}</span>}
                          {s.performedBy && <span className="muted small"> · {s.performedBy}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {detail.asset.children.length > 0 && (
                <div className="eq-children">
                  <h3>Inside it</h3>
                  <ul className="eq-chain">
                    {detail.asset.children.map((c) => (
                      <li key={c.id}>
                        <button type="button" className="link-button" onClick={() => void openAsset(c.id)}>{assetLabel(c)}</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {detail.asset.issues.length > 0 && (
                <div className="eq-issues">
                  <h3>Faults logged against it</h3>
                  <ul className="eq-chain">
                    {detail.asset.issues.map((i) => (
                      <li key={i.id}>
                        {i.title}
                        <span className="muted small"> · {i.status.replace("_", " ")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
