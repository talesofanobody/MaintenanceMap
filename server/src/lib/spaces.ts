import { ValidationError } from "./validation";

/**
 * The location tree: making it, walking it, and matching free text to it.
 *
 * No Prisma here. The two things worth testing are the range expansion — which is
 * how three hundred and forty rooms get created without typing three hundred and
 * forty names — and the text matching, which decides whether "Room 214" and the
 * space called 214 are the same place. Both are easy to get subtly wrong and
 * neither needs a database to exercise.
 */

export const SPACE_KINDS = ["block", "floor", "space"] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];

export const SELL_STATUSES = ["green", "amber", "red"] as const;
export type SellStatus = (typeof SELL_STATUSES)[number];

/** How deep a tree may go, and how far any walk up it will follow. */
export const MAX_SPACE_DEPTH = 8;

/**
 * Turn "101-140" into a hundred and forty names, and "101-110,201-210" into two
 * runs of ten.
 *
 * This is the whole reason creating a tree for a large site is tolerable. Typed
 * one at a time, three hundred and forty rooms is an afternoon nobody will spend,
 * and a half-entered tree is worse than none because every count taken from it is
 * quietly wrong.
 *
 * Zero padding is preserved: a site whose rooms are 001 to 040 does not want them
 * renamed to 1 to 40. A prefix is preserved too, so "A1-A12" gives A1 through A12
 * rather than failing on the letter.
 */
export function expandRange(spec: string): string[] {
  const trimmed = spec.trim();
  if (!trimmed) throw new ValidationError("Nothing to expand.");

  const out: string[] = [];
  for (const part of trimmed.split(",")) {
    const piece = part.trim();
    if (!piece) continue;

    const range = piece.match(/^([A-Za-z-]*)(\d+)\s*[-–]\s*([A-Za-z-]*)(\d+)$/);
    if (!range) {
      // Not a range, so it is a single name. Taken as typed.
      out.push(piece);
      continue;
    }

    const [, prefixA, startRaw, prefixB, endRaw] = range;
    if (prefixB && prefixA && prefixB !== prefixA) {
      throw new ValidationError(`"${piece}" starts with ${prefixA} and ends with ${prefixB}.`);
    }
    const prefix = prefixA || prefixB || "";
    const start = Number(startRaw);
    const end = Number(endRaw);
    if (end < start) throw new ValidationError(`"${piece}" counts backwards.`);
    if (end - start > 500) throw new ValidationError(`"${piece}" is more than 500 at once.`);

    // Pad to the wider of the two, so 098-102 gives 098, 099, 100, 101, 102.
    const width = Math.max(startRaw.length, endRaw.length);
    for (let n = start; n <= end; n += 1) {
      out.push(`${prefix}${String(n).padStart(width, "0")}`);
    }
  }

  if (!out.length) throw new ValidationError("Nothing to expand.");
  if (out.length > 1000) throw new ValidationError("That is more than 1000 spaces at once.");
  // A spec that repeats itself is a typo; silently making one would hide it.
  const seen = new Set<string>();
  for (const name of out) {
    if (seen.has(name)) throw new ValidationError(`"${name}" appears twice in that range.`);
    seen.add(name);
  }
  return out;
}

export interface SpaceNode {
  id: string;
  parentId: string | null;
  kind: string;
  name: string;
  code: string | null;
  sellable: boolean;
  sellStatus: string | null;
  sortOrder: number;
  active: boolean;
}

export interface SpaceWithPath extends SpaceNode {
  /** Ancestors then self, as names: ["Coubaril", "Floor 2", "214"]. */
  path: string[];
  depth: number;
}

/**
 * Every space with the path that reads out loud.
 *
 * The path is what makes a tree usable in a flat list — a dropdown of three
 * hundred rooms all called things like "214" is unusable, and "Coubaril · Floor 2
 * · 214" is not.
 */
export function withPaths(spaces: SpaceNode[]): SpaceWithPath[] {
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const cache = new Map<string, string[]>();

  const pathOf = (space: SpaceNode): string[] => {
    const hit = cache.get(space.id);
    if (hit) return hit;
    const parts: string[] = [];
    let cursor: SpaceNode | undefined = space;
    const guard = new Set<string>();
    // Bounded as well as loop-aware: a tree that already contains a cycle must
    // not take the whole listing down with it.
    for (let depth = 0; cursor && depth < MAX_SPACE_DEPTH; depth += 1) {
      if (guard.has(cursor.id)) break;
      guard.add(cursor.id);
      parts.unshift(cursor.name);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    cache.set(space.id, parts);
    return parts;
  };

  return spaces.map((s) => {
    const path = pathOf(s);
    return { ...s, path, depth: path.length - 1 };
  });
}

/** Lowercased, with punctuation and spacing taken out. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The words a room name is wrapped in, which carry no information. */
const NOISE = /\b(room|rm|no|number|suite|unit|apt|apartment)\b/gi;

export interface SpaceMatch {
  spaceId: string;
  path: string[];
  /** exact — the code or name is the whole text once the noise is removed.
   *  token — the code appears as a separate word in the text.
   *  partial — the normalised text contains it, which is the weakest. */
  how: "exact" | "token" | "partial";
}

/**
 * Candidates for a piece of free text, best first.
 *
 * Deliberately returns candidates rather than an answer. "Room 214" almost
 * certainly means the space called 214 — but "Pool deck" against a site with
 * three pool decks means nothing, and a backfill that picked one would put
 * history in the wrong place with no way to tell afterwards which rows were
 * guesses. So this proposes and something else decides, and a single exact match
 * is the only case safe to apply without a person looking.
 *
 * The noise words go first: "Room 214", "Rm 214" and "214" are one room, and a
 * matcher that does not know that is useless on real data.
 */
export function matchSpaces(text: string, spaces: SpaceWithPath[]): SpaceMatch[] {
  const cleaned = text.replace(NOISE, " ").trim();
  const needle = normalise(cleaned);
  if (!needle) return [];

  const matches: SpaceMatch[] = [];
  for (const space of spaces) {
    if (!space.active) continue;
    const candidates = [space.code, space.name].filter((v): v is string => !!v);
    let best: SpaceMatch["how"] | null = null;

    for (const candidate of candidates) {
      const norm = normalise(candidate);
      if (!norm) continue;
      if (norm === needle) {
        best = "exact";
        break;
      }
      // As a whole word in the original text, which is stronger than a substring:
      // "214" matches "Room 214" as a token but "21" does not.
      const asToken = new RegExp(`(^|[^a-z0-9])${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
      if (asToken.test(cleaned)) {
        // An exact match has already broken out, so this can only be an upgrade
        // from nothing or from partial.
        best = "token";
        continue;
      }
      if (needle.includes(norm) && norm.length >= 3) {
        if (!best) best = "partial";
      }
    }

    if (best) matches.push({ spaceId: space.id, path: space.path, how: best });
  }

  const rank = { exact: 0, token: 1, partial: 2 } as const;
  return matches.sort((a, b) => rank[a.how] - rank[b.how] || a.path.join("/").localeCompare(b.path.join("/")));
}

/**
 * The one case safe to apply without a person: exactly one exact match.
 *
 * Two exact matches means the tree has two spaces of the same name in different
 * blocks, which is normal — room 214 in Coubaril and 214 in Blue Suites — and
 * picking either would be a coin toss recorded as a fact.
 */
export function unambiguousMatch(matches: SpaceMatch[]): SpaceMatch | null {
  const exact = matches.filter((m) => m.how === "exact");
  return exact.length === 1 ? exact[0] : null;
}

export interface SellRollup {
  green: number;
  amber: number;
  red: number;
  /** Sellable rooms nobody has given a status. */
  unset: number;
  total: number;
}

/**
 * The sell-status round, counted over sellable rooms only.
 *
 * Back of house is excluded by not being sellable rather than by a list of
 * exceptions, which is the difference between a count that stays right as the site
 * changes and one that needs maintaining. Rooms with no status are counted
 * separately and never folded into green: "nobody has looked" and "it is fine" are
 * different, and only one of them is good news.
 */
export function sellRollup(spaces: SpaceNode[]): SellRollup {
  const rooms = spaces.filter((s) => s.sellable && s.active);
  const count = (status: string) => rooms.filter((s) => s.sellStatus === status).length;
  return {
    green: count("green"),
    amber: count("amber"),
    red: count("red"),
    unset: rooms.filter((s) => !s.sellStatus).length,
    total: rooms.length,
  };
}
