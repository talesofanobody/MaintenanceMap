import { ValidationError } from "./validation";

/**
 * Equipment, and the graph of what it does to other things.
 *
 * The traversals here are the reason the asset tables exist. Everything else in
 * the app helps record a problem; these answer the questions that cost time while
 * standing in front of one — what does this breaker control, what feeds this room,
 * where do I isolate this without dropping the block.
 *
 * Pure, and over edge lists rather than Prisma, because a graph walk is the single
 * easiest thing here to get subtly wrong: an unbounded one hangs on a loop, and a
 * loop in real electrical records is not hypothetical.
 */

export const ASSET_KINDS = [
  "panel", "breaker", "valve", "generator", "tank", "pump", "ahu", "fcu",
  "ice_machine", "lift", "meter", "grease_trap", "calorifier", "chiller", "other",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  panel: "Distribution panel",
  breaker: "Breaker",
  valve: "Valve",
  generator: "Generator",
  tank: "Tank",
  pump: "Pump",
  ahu: "Air handling unit",
  fcu: "Fan coil unit",
  ice_machine: "Ice machine",
  lift: "Lift",
  meter: "Meter",
  grease_trap: "Grease trap",
  calorifier: "Calorifier",
  chiller: "Chiller",
  other: "Other",
};

/** What one thing does to another. */
export const RELATION_KINDS = ["feeds", "isolates", "serves", "drains", "vents"] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export const RELATION_LABELS: Record<RelationKind, string> = {
  feeds: "feeds",
  isolates: "isolates",
  serves: "serves",
  drains: "drains from",
  vents: "extracts from",
};

/** Supply relations — the ones that answer "what goes dark". */
export const SUPPLY_KINDS: readonly string[] = ["feeds", "serves"];

export const SERVICE_KINDS = ["service", "test", "repair", "replacement", "inspection"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

/** How far a traversal will follow, and how many nodes it will touch. */
export const MAX_WALK_DEPTH = 12;
export const MAX_WALK_NODES = 2000;

export interface RelationEdge {
  id: string;
  fromAssetId: string;
  toAssetId: string | null;
  toSpaceId: string | null;
  kind: string;
}

export interface Reached {
  id: string;
  /** Hops from the starting point. 1 is directly connected. */
  depth: number;
  /** The relation kind of the last hop, so a mixed path can be read back. */
  via: string;
}

export interface Downstream {
  assets: Reached[];
  spaces: Reached[];
  /** True when the walk stopped at a bound rather than running out of graph. */
  truncated: boolean;
}

/**
 * Everything an asset reaches, following supply outwards.
 *
 * This is the "what else goes dark if I open this breaker" answer, and the reason
 * it has to be transitive: a breaker feeds a sub-panel which feeds eight rooms,
 * and the person about to open it cares about the eight rooms, not the sub-panel.
 *
 * Bounded on depth and on nodes, and loop-aware. A real set of electrical records
 * will contain a ring main or a plain mistake sooner or later, and a walk that
 * hangs on one takes the screen down with it.
 */
export function downstream(
  startAssetId: string,
  edges: RelationEdge[],
  kinds: readonly string[] = SUPPLY_KINDS
): Downstream {
  const byFrom = new Map<string, RelationEdge[]>();
  for (const e of edges) {
    if (!kinds.includes(e.kind)) continue;
    (byFrom.get(e.fromAssetId) ?? byFrom.set(e.fromAssetId, []).get(e.fromAssetId)!).push(e);
  }

  const assets = new Map<string, Reached>();
  const spaces = new Map<string, Reached>();
  const seen = new Set<string>([startAssetId]);
  let queue: { id: string; depth: number }[] = [{ id: startAssetId, depth: 0 }];
  let touched = 0;
  let truncated = false;

  while (queue.length) {
    const node = queue.shift()!;
    if (node.depth >= MAX_WALK_DEPTH) {
      truncated = true;
      continue;
    }
    for (const edge of byFrom.get(node.id) ?? []) {
      touched += 1;
      if (touched > MAX_WALK_NODES) {
        truncated = true;
        queue = [];
        break;
      }
      if (edge.toSpaceId) {
        // A space is a leaf: nothing is downstream of a room.
        const existing = spaces.get(edge.toSpaceId);
        if (!existing || existing.depth > node.depth + 1) {
          spaces.set(edge.toSpaceId, { id: edge.toSpaceId, depth: node.depth + 1, via: edge.kind });
        }
      } else if (edge.toAssetId) {
        const existing = assets.get(edge.toAssetId);
        if (!existing || existing.depth > node.depth + 1) {
          assets.set(edge.toAssetId, { id: edge.toAssetId, depth: node.depth + 1, via: edge.kind });
        }
        if (!seen.has(edge.toAssetId)) {
          seen.add(edge.toAssetId);
          queue.push({ id: edge.toAssetId, depth: node.depth + 1 });
        }
      }
    }
  }

  const byDepth = (a: Reached, b: Reached) => a.depth - b.depth || a.id.localeCompare(b.id);
  return { assets: [...assets.values()].sort(byDepth), spaces: [...spaces.values()].sort(byDepth), truncated };
}

export interface Target {
  assetId?: string;
  spaceId?: string;
}

/**
 * Everything that reaches a target, following supply backwards.
 *
 * The inverse question, and the one people actually ask: what feeds this room.
 * A tree could only answer it one way round, which is why the relations are a
 * graph — a room is fed by a breaker and served by a valve and conditioned by an
 * air handler, each with its own upstream.
 */
export function upstream(
  target: Target,
  edges: RelationEdge[],
  kinds: readonly string[] = SUPPLY_KINDS
): Downstream {
  const byTo = new Map<string, RelationEdge[]>();
  const key = (e: RelationEdge) => (e.toSpaceId ? `space:${e.toSpaceId}` : e.toAssetId ? `asset:${e.toAssetId}` : null);
  for (const e of edges) {
    if (!kinds.includes(e.kind)) continue;
    const k = key(e);
    if (!k) continue;
    (byTo.get(k) ?? byTo.set(k, []).get(k)!).push(e);
  }

  const start = target.spaceId ? `space:${target.spaceId}` : target.assetId ? `asset:${target.assetId}` : null;
  if (!start) return { assets: [], spaces: [], truncated: false };

  const assets = new Map<string, Reached>();
  const seen = new Set<string>([start]);
  let queue: { key: string; depth: number }[] = [{ key: start, depth: 0 }];
  let touched = 0;
  let truncated = false;

  while (queue.length) {
    const node = queue.shift()!;
    if (node.depth >= MAX_WALK_DEPTH) {
      truncated = true;
      continue;
    }
    for (const edge of byTo.get(node.key) ?? []) {
      touched += 1;
      if (touched > MAX_WALK_NODES) {
        truncated = true;
        queue = [];
        break;
      }
      const existing = assets.get(edge.fromAssetId);
      if (!existing || existing.depth > node.depth + 1) {
        assets.set(edge.fromAssetId, { id: edge.fromAssetId, depth: node.depth + 1, via: edge.kind });
      }
      const next = `asset:${edge.fromAssetId}`;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push({ key: next, depth: node.depth + 1 });
      }
    }
  }

  const byDepth = (a: Reached, b: Reached) => a.depth - b.depth || a.id.localeCompare(b.id);
  return { assets: [...assets.values()].sort(byDepth), spaces: [], truncated };
}

/**
 * Where to isolate something, most local first.
 *
 * Follows the isolating relations rather than the supplying ones: a valve that
 * isolates a pipe run is not the same relation as the pump that serves it, and
 * conflating them would answer "where do I shut this off" with "where does the
 * water come from".
 *
 * Ordering is the part that matters operationally, and it cannot come from the
 * isolation edges alone. A room's local valve and its riser valve both isolate
 * that room directly, so both sit one hop away and the graph has no opinion about
 * which to shut. The supply chain does: the local valve sits closest to the room, so
 * it is the nearest hop on it. Ordering by supply distance, nearest first, puts
 * the valve that takes out one room ahead of the one that takes out the block —
 * which is the whole difference this list is consulted for.
 */
export function isolationPoints(target: Target, edges: RelationEdge[]): Reached[] {
  const points = upstream(target, edges, ["isolates"]).assets;
  if (points.length < 2) return points;

  // How far along the supply chain each point sits, counted outwards from the
  // target. The local valve is the nearest hop, so it carries the SMALLEST depth;
  // the riser is a hop further out and the main further still.
  const supply = upstream(target, edges, SUPPLY_KINDS).assets;
  const supplyDepth = new Map(supply.map((a) => [a.id, a.depth]));

  // A point that is not on the supply chain at all cannot be placed by locality,
  // so it sorts after the ones that can rather than jumping the queue.
  const rank = (p: Reached) => supplyDepth.get(p.id) ?? Number.POSITIVE_INFINITY;
  return [...points].sort((a, b) => {
    const byLocality = rank(a) - rank(b);
    if (byLocality !== 0) return byLocality;
    return a.depth - b.depth || a.id.localeCompare(b.id);
  });
}

export interface ServiceShape {
  serviceIntervalDays: number | null;
  lastServicedAt: Date | string | null;
  installedAt: Date | string | null;
}

export type ServiceState = "ok" | "due" | "overdue" | "never" | "unknown";

export interface ServiceStatus {
  state: ServiceState;
  /** When it next falls due, where that can be worked out. */
  dueOn: string | null;
  /** Negative while it is still in date. */
  daysOverdue: number | null;
}

/** Within this many days of falling due counts as "due" rather than "ok". */
const DUE_SOON_DAYS = 7;

/**
 * Whether a piece of equipment is in date.
 *
 * `never` is kept apart from `overdue` on purpose. A unit with an interval and no
 * service record at all is a different problem from one serviced four months ago:
 * the second is a scheduling failure and the first usually means the record was
 * never started, and a list that merges them sends somebody to look for paperwork
 * that does not exist.
 *
 * Where there is no service record, the install date stands in — a unit fitted
 * eight months ago on a ninety-day interval is overdue whatever the log says.
 */
export function serviceStatus(asset: ServiceShape, now: Date = new Date()): ServiceStatus {
  if (!asset.serviceIntervalDays || asset.serviceIntervalDays <= 0) {
    return { state: "unknown", dueOn: null, daysOverdue: null };
  }

  const ms = (v: Date | string | null) => (v === null ? null : v instanceof Date ? v.getTime() : Date.parse(v));
  const last = ms(asset.lastServicedAt);
  const installed = ms(asset.installedAt);
  const baseline = last ?? installed;

  if (baseline === null || Number.isNaN(baseline)) {
    return { state: "never", dueOn: null, daysOverdue: null };
  }

  const due = baseline + asset.serviceIntervalDays * 86400000;
  const daysOverdue = Math.floor((now.getTime() - due) / 86400000);
  const dueOn = new Date(due).toISOString().slice(0, 10);

  if (daysOverdue > 0) return { state: last === null ? "never" : "overdue", dueOn, daysOverdue };
  if (daysOverdue >= -DUE_SOON_DAYS) return { state: "due", dueOn, daysOverdue };
  return { state: "ok", dueOn, daysOverdue };
}

export function parseInterval(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 3650) {
    throw new ValidationError("A service interval is a whole number of days, 1 to 3650.");
  }
  return n;
}
