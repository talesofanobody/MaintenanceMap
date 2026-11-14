import { Router } from "express";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { parseOptionalString, ValidationError } from "../lib/validation";
import { wouldCycleInHierarchy } from "../lib/planning";
import {
  expandRange, matchSpaces, MAX_SPACE_DEPTH, SELL_STATUSES, sellRollup, SPACE_KINDS,
  unambiguousMatch, withPaths,
} from "../lib/spaces";

/**
 * Where things are.
 *
 * Property, block, floor, space. The tree exists because "Room 214" as free text
 * cannot answer the questions that matter once a site is large — everything in
 * Coubaril, every room on floor two, how many sellable rooms are out of order — and
 * a string can be counted but not walked.
 *
 * It does not replace the free text, and the matching endpoints here are the reason
 * why: history gets reconciled a piece at a time, by somebody looking, rather than
 * by a migration that guessed.
 */
export const spacesRouter = Router();

const SELECT = {
  id: true, propertyId: true, parentId: true, kind: true, name: true, code: true,
  sellable: true, sellStatus: true, lat: true, lng: true, notes: true, sortOrder: true, active: true,
} as const;

function oneOf(value: unknown, allowed: readonly string[], field: string): string {
  const s = typeof value === "string" ? value : "";
  if (!allowed.includes(s)) throw new ValidationError(`${field} must be one of ${allowed.join(", ")}`);
  return s;
}

/** The whole tree for a property, with paths and the sell-status roll-up. */
spacesRouter.get("/", async (req, res) => {
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
  if (!propertyId) return res.status(400).json({ error: "Which property?" });

  const spaces = await prisma.space.findMany({
    where: { propertyId, ...(req.query.all ? {} : { active: true }) },
    select: SELECT,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    // A very large site is still only a few thousand spaces, and the tree is read
    // whole because a partial tree cannot produce a path.
    take: 5000,
  });

  res.json({
    spaces: withPaths(spaces),
    sell: sellRollup(spaces),
    kinds: SPACE_KINDS,
    sellStatuses: SELL_STATUSES,
  });
});

/**
 * Create one space, or a run of them.
 *
 * `names` takes a range spec — "101-140", or "101-110,201-210" — which is the only
 * reason setting up a site of this size is tolerable. A half-entered tree is worse
 * than none, because every count taken from it is quietly wrong.
 */
spacesRouter.post("/", requires("property.write"), async (req, res) => {
  try {
    const propertyId = typeof req.body.propertyId === "string" ? req.body.propertyId : "";
    const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, name: true } });
    if (!property) return res.status(400).json({ error: "That property does not exist." });

    const parentId = typeof req.body.parentId === "string" && req.body.parentId ? req.body.parentId : null;
    if (parentId) {
      const parent = await prisma.space.findUnique({ where: { id: parentId }, select: { id: true, propertyId: true } });
      if (!parent) return res.status(400).json({ error: "That parent does not exist." });
      if (parent.propertyId !== propertyId) {
        return res.status(400).json({ error: "A space can only sit under a parent at the same property." });
      }
      // Depth is bounded so the tree stays something a person can read.
      const depth = await depthOf(parentId);
      if (depth + 1 >= MAX_SPACE_DEPTH) {
        return res.status(400).json({ error: `That would nest deeper than ${MAX_SPACE_DEPTH} levels.` });
      }
    }

    const kind = oneOf(req.body.kind ?? "space", SPACE_KINDS, "kind");
    const sellable = req.body.sellable === true;

    // One name, or a range.
    const spec = typeof req.body.names === "string" ? req.body.names : null;
    const single = parseOptionalString(req.body.name, "name", 120);
    if (!spec && !single) return res.status(400).json({ error: "A space needs a name, or a range like 101-140." });
    const names = spec ? expandRange(spec) : [single!];

    // Anything already there is skipped rather than failing the lot: running the
    // same range twice should fill the gaps, not refuse.
    const existing = await prisma.space.findMany({
      where: { propertyId, parentId, name: { in: names } },
      select: { name: true },
    });
    const have = new Set(existing.map((e) => e.name));
    const wanted = names.filter((n) => !have.has(n));

    const base = await prisma.space.aggregate({ where: { propertyId, parentId }, _max: { sortOrder: true } });
    let order = base._max.sortOrder ?? -1;

    await prisma.space.createMany({
      data: wanted.map((name) => ({
        propertyId,
        parentId,
        kind,
        name,
        // For a run of rooms the name *is* the reference, so it doubles as the code.
        code: spec ? name : parseOptionalString(req.body.code, "code", 60) ?? null,
        sellable,
        notes: spec ? null : parseOptionalString(req.body.notes, "notes", 1000) ?? null,
        sortOrder: ++order,
      })),
    });

    if (wanted.length) {
      await logActivity(req, {
        action: "space.created",
        entityType: "system",
        entityId: parentId ?? propertyId,
        propertyId,
        summary:
          wanted.length === 1
            ? `Added the ${kind} "${wanted[0]}" at ${property.name}`
            : `Added ${wanted.length} ${kind}s at ${property.name} (${wanted[0]} to ${wanted[wanted.length - 1]})`,
      });
    }

    const spaces = await prisma.space.findMany({ where: { propertyId }, select: SELECT, orderBy: [{ sortOrder: "asc" }] });
    res.status(201).json({
      created: wanted.length,
      skipped: have.size,
      spaces: withPaths(spaces),
      sell: sellRollup(spaces),
    });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

spacesRouter.put("/:id", requires("property.write"), async (req, res) => {
  const existing = await prisma.space.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not found" });
  try {
    const data: Record<string, unknown> = {};
    if (req.body.name !== undefined) {
      const name = parseOptionalString(req.body.name, "name", 120);
      if (!name) return res.status(400).json({ error: "A space needs a name." });
      data.name = name;
    }
    if (req.body.code !== undefined) data.code = parseOptionalString(req.body.code, "code", 60) ?? null;
    if (req.body.kind !== undefined) data.kind = oneOf(req.body.kind, SPACE_KINDS, "kind");
    if (req.body.sellable !== undefined) data.sellable = !!req.body.sellable;
    if (req.body.notes !== undefined) data.notes = parseOptionalString(req.body.notes, "notes", 1000) ?? null;
    if (req.body.active !== undefined) data.active = !!req.body.active;
    if (req.body.lat !== undefined) data.lat = req.body.lat === null ? null : Number(req.body.lat);
    if (req.body.lng !== undefined) data.lng = req.body.lng === null ? null : Number(req.body.lng);

    if (req.body.sellStatus !== undefined) {
      if (req.body.sellStatus === null || req.body.sellStatus === "") {
        data.sellStatus = null;
      } else {
        const status = oneOf(req.body.sellStatus, SELL_STATUSES, "sellStatus");
        // A status on something nobody sells is a category error, and quietly
        // accepting it would make the roll-up disagree with itself.
        if (!existing.sellable && req.body.sellable !== true) {
          return res.status(400).json({ error: "Only a sellable room has a sell status." });
        }
        data.sellStatus = status;
      }
    }

    // Moving a space, which must not close a loop: every path walk and every
    // roll-up follows this structure.
    if (req.body.parentId !== undefined) {
      const parentId = typeof req.body.parentId === "string" && req.body.parentId ? req.body.parentId : null;
      if (parentId) {
        const parent = await prisma.space.findUnique({ where: { id: parentId }, select: { id: true, propertyId: true } });
        if (!parent) return res.status(400).json({ error: "That parent does not exist." });
        if (parent.propertyId !== existing.propertyId) {
          return res.status(400).json({ error: "A space can only move to a parent at the same property." });
        }
        const loops = await wouldCycleInHierarchy(existing.id, parentId, async (id) => {
          const row = await prisma.space.findUnique({ where: { id }, select: { parentId: true } });
          return row?.parentId ?? null;
        });
        if (loops) return res.status(400).json({ error: "That would put the space inside itself." });
      }
      data.parentId = parentId;
    }

    await prisma.space.update({ where: { id: existing.id }, data });
    const spaces = await prisma.space.findMany({ where: { propertyId: existing.propertyId }, select: SELECT, orderBy: [{ sortOrder: "asc" }] });
    res.json({ spaces: withPaths(spaces), sell: sellRollup(spaces) });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/**
 * Deleting a space takes its children with it, and releases the work.
 *
 * The children cascade because a floor with no block is not a thing. The issues
 * and inspections do not: they keep their free text and simply stop pointing at a
 * space, because the history of what was done is not the tree's to delete.
 */
spacesRouter.delete("/:id", requires("property.write"), async (req, res) => {
  const space = await prisma.space.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, propertyId: true, _count: { select: { children: true, issues: true, inspections: true } } },
  });
  if (!space) return res.status(404).json({ error: "not found" });

  const attached = space._count.issues + space._count.inspections;
  if ((space._count.children > 0 || attached > 0) && !req.body?.force) {
    return res.status(400).json({
      error:
        `"${space.name}" has ` +
        [
          space._count.children ? `${space._count.children} space${space._count.children === 1 ? "" : "s"} under it` : null,
          attached ? `${attached} job${attached === 1 ? "" : "s"} and walk${attached === 1 ? "" : "s"} pointing at it` : null,
        ].filter(Boolean).join(" and ") +
        ". Deleting it removes the spaces beneath and unlinks the work, which keeps its own record of where it was.",
      children: space._count.children,
      attached,
    });
  }

  await prisma.space.delete({ where: { id: space.id } });
  await logActivity(req, {
    action: "space.deleted",
    entityType: "system",
    entityId: space.id,
    propertyId: space.propertyId,
    summary: `Deleted the space "${space.name}"${space._count.children ? ` and the ${space._count.children} beneath it` : ""}`,
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Reconciling the free text
// ---------------------------------------------------------------------------

/**
 * What the free text on a property's work probably means, grouped by text.
 *
 * The point is to make the reconciliation a short job rather than a long one:
 * every distinct string, how many rows use it, and the candidates. A string used
 * two hundred times is worth looking at first, and one used once probably is not
 * worth looking at at all.
 */
spacesRouter.get("/unmatched", async (req, res) => {
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
  if (!propertyId) return res.status(400).json({ error: "Which property?" });

  const spaces = withPaths(
    await prisma.space.findMany({ where: { propertyId, active: true }, select: SELECT, orderBy: [{ sortOrder: "asc" }] })
  );

  const [issues, inspections] = await Promise.all([
    prisma.issue.groupBy({
      by: ["roomName"],
      where: { propertyId, spaceId: null, roomName: { not: null } },
      _count: { _all: true },
    }),
    prisma.inspection.groupBy({
      by: ["roomName"],
      where: { propertyId, spaceId: null },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map<string, { issues: number; inspections: number }>();
  for (const row of issues) {
    if (!row.roomName) continue;
    const entry = counts.get(row.roomName) ?? { issues: 0, inspections: 0 };
    entry.issues += row._count._all;
    counts.set(row.roomName, entry);
  }
  for (const row of inspections) {
    const entry = counts.get(row.roomName) ?? { issues: 0, inspections: 0 };
    entry.inspections += row._count._all;
    counts.set(row.roomName, entry);
  }

  const out = [...counts.entries()]
    .map(([text, c]) => {
      const matches = matchSpaces(text, spaces);
      return {
        text,
        ...c,
        total: c.issues + c.inspections,
        matches: matches.slice(0, 5),
        // Only one exact match is safe without somebody looking; two means the
        // same name exists in two blocks and picking either is a coin toss.
        certain: unambiguousMatch(matches)?.spaceId ?? null,
      };
    })
    .sort((a, b) => b.total - a.total || a.text.localeCompare(b.text));

  res.json({
    unmatched: out.slice(0, 500),
    distinct: out.length,
    certain: out.filter((o) => o.certain).length,
  });
});

/**
 * Point every row with a given piece of text at a space.
 *
 * Takes the text and the space explicitly rather than guessing, so the decision is
 * always somebody's. `auto` applies only the unambiguous ones — a single exact
 * match — and reports what it left, which is the useful shape: clear the obvious
 * couple of hundred, then look at the dozen that need a person.
 */
spacesRouter.post("/reconcile", requires("property.write"), async (req, res) => {
  const propertyId = typeof req.body.propertyId === "string" ? req.body.propertyId : "";
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, name: true } });
  if (!property) return res.status(400).json({ error: "That property does not exist." });

  const spaces = withPaths(
    await prisma.space.findMany({ where: { propertyId, active: true }, select: SELECT, orderBy: [{ sortOrder: "asc" }] })
  );

  /** One text to one space, or every unambiguous one at once. */
  const pairs: { text: string; spaceId: string }[] = [];

  if (req.body.auto === true) {
    const [issues, inspections] = await Promise.all([
      prisma.issue.groupBy({ by: ["roomName"], where: { propertyId, spaceId: null, roomName: { not: null } } }),
      prisma.inspection.groupBy({ by: ["roomName"], where: { propertyId, spaceId: null } }),
    ]);
    const texts = new Set<string>();
    for (const r of issues) if (r.roomName) texts.add(r.roomName);
    for (const r of inspections) texts.add(r.roomName);
    for (const text of texts) {
      const certain = unambiguousMatch(matchSpaces(text, spaces));
      if (certain) pairs.push({ text, spaceId: certain.spaceId });
    }
  } else {
    const text = typeof req.body.text === "string" ? req.body.text : "";
    const spaceId = typeof req.body.spaceId === "string" ? req.body.spaceId : "";
    if (!text || !spaceId) return res.status(400).json({ error: "Which text, and which space?" });
    if (!spaces.some((s) => s.id === spaceId)) return res.status(400).json({ error: "That space is not at this property." });
    pairs.push({ text, spaceId });
  }

  let issuesMatched = 0;
  let inspectionsMatched = 0;
  for (const pair of pairs) {
    const a = await prisma.issue.updateMany({
      where: { propertyId, spaceId: null, roomName: pair.text },
      data: { spaceId: pair.spaceId },
    });
    const b = await prisma.inspection.updateMany({
      where: { propertyId, spaceId: null, roomName: pair.text },
      data: { spaceId: pair.spaceId },
    });
    issuesMatched += a.count;
    inspectionsMatched += b.count;
  }

  if (pairs.length) {
    await logActivity(req, {
      action: "space.reconciled",
      entityType: "system",
      entityId: propertyId,
      propertyId,
      summary:
        `Matched ${pairs.length} room name${pairs.length === 1 ? "" : "s"} to the tree at ${property.name} — ` +
        `${issuesMatched} job${issuesMatched === 1 ? "" : "s"} and ${inspectionsMatched} walk${inspectionsMatched === 1 ? "" : "s"}`,
    });
  }

  // What is left, so the next step is obvious rather than needing another request.
  const remainingIssues = await prisma.issue.count({ where: { propertyId, spaceId: null, roomName: { not: null } } });
  const remainingInspections = await prisma.inspection.count({ where: { propertyId, spaceId: null } });

  res.json({
    texts: pairs.length,
    issues: issuesMatched,
    inspections: inspectionsMatched,
    remaining: { issues: remainingIssues, inspections: remainingInspections },
  });
});

/** How deep a space sits, walking up and bounded against a looped tree. */
async function depthOf(id: string): Promise<number> {
  let depth = 0;
  let cursor: string | null = id;
  const seen = new Set<string>();
  while (cursor && depth < MAX_SPACE_DEPTH) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const row: { parentId: string | null } | null = await prisma.space.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    if (!row) break;
    cursor = row.parentId;
    if (cursor) depth += 1;
  }
  return depth;
}
