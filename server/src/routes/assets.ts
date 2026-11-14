import { Router } from "express";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { parseOptionalString, parseOptionalDay, ValidationError } from "../lib/validation";
import { wouldCycleInHierarchy } from "../lib/planning";
import { withPaths } from "../lib/spaces";
import {
  ASSET_KINDS, ASSET_KIND_LABELS, RELATION_KINDS, RELATION_LABELS, SERVICE_KINDS,
  downstream, upstream, isolationPoints, serviceStatus, parseInterval,
  placeAssets, mapMarkers,
  type RelationEdge,
} from "../lib/assets";

/**
 * The property manual: equipment, and what it does to everything else.
 *
 * The register is the easy half. The half that earns its keep is the relation
 * graph, because the questions that cost time on site are not "what is this" but
 * "what else goes dark if I open it" and "where do I isolate this room" — and both
 * of those are graph walks that no spreadsheet column can answer.
 *
 * NOTE ON ROUTE ORDER: every literal path in here is declared before "/:id".
 * Express matches in declaration order, so a literal placed after a parameter
 * route is unreachable — "/due" would be read as an asset whose id is "due".
 */
export const assetsRouter = Router();

const SELECT = {
  id: true, propertyId: true, spaceId: true, parentId: true, kind: true, ref: true, name: true,
  manufacturer: true, model: true, serialNumber: true, rating: true, installedAt: true,
  lat: true, lng: true, serviceIntervalDays: true, lastServicedAt: true, notes: true, active: true,
} as const;

/**
 * A day string to a timestamp.
 *
 * `parseOptionalDay` returns "YYYY-MM-DD", which is right for the planning fields
 * because those columns are text. These two are real DateTime columns, so the day
 * has to be widened before Prisma will take it — and anchored at midnight UTC, so
 * a service logged on the first does not read as the previous evening wherever the
 * server happens to be.
 */
function dayToDate(day: string | null | undefined): Date | null | undefined {
  if (day === undefined) return undefined;
  if (day === null) return null;
  return new Date(`${day}T00:00:00.000Z`);
}

function oneOf(value: unknown, allowed: readonly string[], field: string): string {
  const s = typeof value === "string" ? value : "";
  if (!allowed.includes(s)) throw new ValidationError(`${field} must be one of ${allowed.join(", ")}`);
  return s;
}

/** Edges for a whole property, which is what both walks need. */
async function edgesFor(propertyId: string): Promise<RelationEdge[]> {
  const rows = await prisma.assetRelation.findMany({
    where: { from: { propertyId } },
    select: { id: true, fromAssetId: true, toAssetId: true, toSpaceId: true, kind: true },
    take: 20000,
  });
  return rows;
}

/** The register, each row carrying whether it is in date. */
assetsRouter.get("/", async (req, res) => {
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
  if (!propertyId) return res.status(400).json({ error: "Which property?" });

  const kind = typeof req.query.kind === "string" && ASSET_KINDS.includes(req.query.kind as never)
    ? req.query.kind : undefined;

  const assets = await prisma.asset.findMany({
    where: { propertyId, ...(kind ? { kind } : {}), ...(req.query.all ? {} : { active: true }) },
    select: SELECT,
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    take: 5000,
  });

  const spaces = await prisma.space.findMany({
    where: { propertyId },
    select: { id: true, parentId: true, name: true, code: true, kind: true, sellable: true, sellStatus: true, sortOrder: true, active: true },
    take: 5000,
  });
  const spaceNames = new Map(withPaths(spaces).map((s) => [s.id, s.path]));

  res.json({
    assets: assets.map((a) => ({
      ...a,
      spaceName: a.spaceId ? spaceNames.get(a.spaceId) ?? null : null,
      service: serviceStatus(a),
    })),
    kinds: ASSET_KINDS,
    kindLabels: ASSET_KIND_LABELS,
    relationKinds: RELATION_KINDS,
    relationLabels: RELATION_LABELS,
    serviceKinds: SERVICE_KINDS,
  });
});

/**
 * Everything out of date, worst first.
 *
 * Declared before "/:id". This is the endpoint that turns the ninety-day AC
 * standard from a column somebody maintains by hand into a question the site can
 * be asked, which was the whole point of putting the interval on the equipment.
 */
assetsRouter.get("/due", async (req, res) => {
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
  if (!propertyId) return res.status(400).json({ error: "Which property?" });

  const assets = await prisma.asset.findMany({
    where: { propertyId, active: true, serviceIntervalDays: { not: null } },
    select: SELECT,
    take: 5000,
  });

  const rows = assets
    .map((a) => ({ ...a, service: serviceStatus(a) }))
    .filter((a) => a.service.state !== "ok" && a.service.state !== "unknown")
    .sort((a, b) => (b.service.daysOverdue ?? 0) - (a.service.daysOverdue ?? 0));

  res.json({
    due: rows,
    counts: {
      overdue: rows.filter((r) => r.service.state === "overdue").length,
      never: rows.filter((r) => r.service.state === "never").length,
      dueSoon: rows.filter((r) => r.service.state === "due").length,
    },
  });
});

/**
 * What feeds a space, and where to isolate it.
 *
 * Declared before "/:id". The inverse of the asset walk, and the one somebody
 * standing in a room actually needs.
 */
assetsRouter.get("/trace", async (req, res) => {
  const spaceId = typeof req.query.spaceId === "string" ? req.query.spaceId : undefined;
  if (!spaceId) return res.status(400).json({ error: "Which space?" });

  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { id: true, name: true, code: true, propertyId: true },
  });
  if (!space) return res.status(404).json({ error: "No such space." });

  const edges = await edgesFor(space.propertyId);
  const feeds = upstream({ spaceId }, edges);
  const isolate = isolationPoints({ spaceId }, edges);

  const ids = [...new Set([...feeds.assets, ...isolate].map((a) => a.id))];
  const assets = await prisma.asset.findMany({ where: { id: { in: ids } }, select: SELECT });
  const byId = new Map(assets.map((a) => [a.id, a]));
  const hydrate = (r: { id: string; depth: number; via: string }) => ({ ...r, asset: byId.get(r.id) ?? null });

  res.json({
    space,
    fedBy: feeds.assets.map(hydrate),
    isolateAt: isolate.map(hydrate),
    truncated: feeds.truncated,
  });
});

/**
 * Everything placed on the map, as markers rather than as assets.
 *
 * Declared before "/:id". A marker is an anchor, not a piece of equipment: a riser
 * with eight breakers in it is one marker holding eight, because eight pins on one
 * pixel looks like a map and reads like nothing.
 *
 * Assets that resolve nowhere come back in `unplaced` rather than being dropped.
 * Equipment the map cannot show is exactly what somebody needs to be told about —
 * silently omitting it makes an incomplete map look finished.
 */
assetsRouter.get("/map", async (req, res) => {
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
  if (!propertyId) return res.status(400).json({ error: "Which property?" });

  const assets = await prisma.asset.findMany({
    where: { propertyId, active: true },
    select: {
      id: true, name: true, ref: true, kind: true, lat: true, lng: true,
      spaceId: true, parentId: true, serviceIntervalDays: true, lastServicedAt: true, installedAt: true,
    },
    take: 5000,
  });

  const spaceRows = await prisma.space.findMany({
    where: { propertyId },
    select: { id: true, parentId: true, name: true, code: true, kind: true, lat: true, lng: true, sellable: true, sellStatus: true, sortOrder: true, active: true },
    take: 5000,
  });

  const placed = placeAssets(assets, spaceRows);
  const { markers, unplaced } = mapMarkers(placed);

  const withPath = withPaths(spaceRows);
  const spaceName = new Map(withPath.map((s) => [s.id, s.path]));
  const assetById = new Map(assets.map((a) => [a.id, a]));

  // How many photographs each one carries, so the map can say which are documented.
  const photoCounts = await prisma.photo.groupBy({
    by: ["assetId"],
    where: { assetId: { in: assets.map((a) => a.id) } },
    _count: { _all: true },
  });
  const photos = new Map(photoCounts.map((p) => [p.assetId as string, p._count._all]));

  const summarise = (id: string) => {
    const a = assetById.get(id)!;
    const p = placed.get(id)!;
    return {
      id: a.id, name: a.name, ref: a.ref, kind: a.kind,
      source: p.source,
      photoCount: photos.get(a.id) ?? 0,
      service: serviceStatus(a),
    };
  };

  res.json({
    markers: markers.map((m) => ({
      ...m,
      spacePath: m.anchorKind === "space" ? spaceName.get(m.anchorId) ?? null : null,
      assets: m.assetIds.map(summarise),
    })),
    unplaced: unplaced.map(summarise),
    /** Spaces that could anchor equipment, for the "put it in a room" picker. */
    spaces: spaceRows.map((s) => ({
      id: s.id, path: spaceName.get(s.id) ?? [s.name], lat: s.lat, lng: s.lng, kind: s.kind,
    })),
  });
});

/** One asset, its relations, its service history, and both walks. */
assetsRouter.get("/:id", async (req, res) => {
  const asset = await prisma.asset.findUnique({
    where: { id: req.params.id },
    select: {
      ...SELECT,
      parent: { select: { id: true, name: true, kind: true } },
      children: { select: { id: true, name: true, kind: true, ref: true }, orderBy: { name: "asc" } },
      space: { select: { id: true, name: true, code: true } },
      relationsOut: {
        select: {
          id: true, kind: true, notes: true,
          to: { select: { id: true, name: true, kind: true, ref: true } },
          toSpace: { select: { id: true, name: true, code: true } },
        },
      },
      relationsIn: {
        select: { id: true, kind: true, notes: true, from: { select: { id: true, name: true, kind: true, ref: true } } },
      },
      services: {
        select: { id: true, kind: true, performedAt: true, performedBy: true, summary: true, reading: true, unit: true, passed: true },
        orderBy: { performedAt: "desc" },
        take: 50,
      },
      issues: {
        select: { id: true, workOrderNumber: true, title: true, status: true, priority: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      photos: {
        select: { id: true, filename: true, thumbFilename: true, hasGps: true, gpsLat: true, gpsLng: true, takenAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 40,
      },
    },
  });
  if (!asset) return res.status(404).json({ error: "No such asset." });

  const edges = await edgesFor(asset.propertyId);
  const reach = downstream(asset.id, edges);
  const feeds = upstream({ assetId: asset.id }, edges);

  const assetIds = [...new Set([...reach.assets, ...feeds.assets].map((a) => a.id))];
  const named = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, name: true, kind: true, ref: true },
  });
  const assetById = new Map(named.map((a) => [a.id, a]));

  const spaceRows = await prisma.space.findMany({
    where: { propertyId: asset.propertyId },
    select: { id: true, parentId: true, name: true, code: true, kind: true, sellable: true, sellStatus: true, sortOrder: true, active: true },
    take: 5000,
  });
  const spaceById = new Map(withPaths(spaceRows).map((s) => [s.id, s]));

  res.json({
    asset: { ...asset, service: serviceStatus(asset) },
    /**
     * The blast radius. Spaces rather than assets is deliberate: the sub-panel in
     * between is not what anybody is asking about.
     */
    affects: {
      spaces: reach.spaces.map((s) => ({ ...s, space: spaceById.get(s.id) ?? null })),
      assets: reach.assets.map((a) => ({ ...a, asset: assetById.get(a.id) ?? null })),
      sellableCount: reach.spaces.filter((s) => spaceById.get(s.id)?.sellable).length,
      truncated: reach.truncated,
    },
    fedBy: feeds.assets.map((a) => ({ ...a, asset: assetById.get(a.id) ?? null })),
  });
});

assetsRouter.post("/", requires("property.write"), async (req, res) => {
  try {
    const propertyId = typeof req.body.propertyId === "string" ? req.body.propertyId : "";
    const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, name: true } });
    if (!property) return res.status(400).json({ error: "That property does not exist." });

    const name = parseOptionalString(req.body.name, "Name", 200);
    if (!name) return res.status(400).json({ error: "An asset needs a name." });
    const kind = oneOf(req.body.kind, ASSET_KINDS, "Kind");

    const spaceId = parseOptionalString(req.body.spaceId, "Space", 40) ?? null;
    if (spaceId) {
      const space = await prisma.space.findFirst({ where: { id: spaceId, propertyId }, select: { id: true } });
      if (!space) return res.status(400).json({ error: "That space is not in this property." });
    }

    const parentId = parseOptionalString(req.body.parentId, "Parent", 40) ?? null;
    if (parentId) {
      const parent = await prisma.asset.findFirst({ where: { id: parentId, propertyId }, select: { id: true } });
      if (!parent) return res.status(400).json({ error: "That parent is not in this property." });
    }

    const asset = await prisma.asset.create({
      data: {
        propertyId, name, kind, spaceId, parentId,
        ref: parseOptionalString(req.body.ref, "Reference", 60) ?? null,
        manufacturer: parseOptionalString(req.body.manufacturer, "Manufacturer", 120) ?? null,
        model: parseOptionalString(req.body.model, "Model", 120) ?? null,
        serialNumber: parseOptionalString(req.body.serialNumber, "Serial number", 120) ?? null,
        rating: parseOptionalString(req.body.rating, "Rating", 120) ?? null,
        installedAt: dayToDate(parseOptionalDay(req.body.installedAt, "Installed")) ?? null,
        lastServicedAt: dayToDate(parseOptionalDay(req.body.lastServicedAt, "Last serviced")) ?? null,
        serviceIntervalDays: parseInterval(req.body.serviceIntervalDays) ?? null,
        notes: parseOptionalString(req.body.notes, "Notes", 2000) ?? null,
        lat: typeof req.body.lat === "number" ? req.body.lat : null,
        lng: typeof req.body.lng === "number" ? req.body.lng : null,
      },
      select: SELECT,
    });

    await logActivity(req, { entityType: "asset", entityId: asset.id, action: "created", summary: `${ASSET_KIND_LABELS[kind as never] ?? kind}: ${name}` });
    res.status(201).json({ asset: { ...asset, service: serviceStatus(asset) } });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

assetsRouter.patch("/:id", requires("property.write"), async (req, res) => {
  try {
    const existing = await prisma.asset.findUnique({ where: { id: req.params.id }, select: SELECT });
    if (!existing) return res.status(404).json({ error: "No such asset." });

    const data: Record<string, unknown> = {};
    if (req.body.name !== undefined) {
      const name = parseOptionalString(req.body.name, "Name", 200);
      if (!name) return res.status(400).json({ error: "An asset needs a name." });
      data.name = name;
    }
    if (req.body.kind !== undefined) data.kind = oneOf(req.body.kind, ASSET_KINDS, "Kind");
    for (const [field, max] of [["ref", 60], ["manufacturer", 120], ["model", 120], ["serialNumber", 120], ["rating", 120], ["notes", 2000]] as const) {
      if (req.body[field] !== undefined) data[field] = parseOptionalString(req.body[field], field, max) ?? null;
    }
    for (const field of ["installedAt", "lastServicedAt"] as const) {
      if (req.body[field] !== undefined) data[field] = dayToDate(parseOptionalDay(req.body[field], field)) ?? null;
    }
    if (req.body.serviceIntervalDays !== undefined) data.serviceIntervalDays = parseInterval(req.body.serviceIntervalDays) ?? null;
    if (req.body.lat !== undefined) data.lat = typeof req.body.lat === "number" ? req.body.lat : null;
    if (req.body.lng !== undefined) data.lng = typeof req.body.lng === "number" ? req.body.lng : null;
    if (req.body.active !== undefined) data.active = Boolean(req.body.active);

    if (req.body.spaceId !== undefined) {
      const spaceId = parseOptionalString(req.body.spaceId, "Space", 40) ?? null;
      if (spaceId) {
        const space = await prisma.space.findFirst({ where: { id: spaceId, propertyId: existing.propertyId }, select: { id: true } });
        if (!space) return res.status(400).json({ error: "That space is not in this property." });
      }
      data.spaceId = spaceId;
    }

    if (req.body.parentId !== undefined) {
      const parentId = parseOptionalString(req.body.parentId, "Parent", 40) ?? null;
      if (parentId === existing.id) return res.status(400).json({ error: "An asset cannot contain itself." });
      if (parentId) {
        const parent = await prisma.asset.findFirst({ where: { id: parentId, propertyId: existing.propertyId }, select: { id: true } });
        if (!parent) return res.status(400).json({ error: "That parent is not in this property." });
        // Containment is a tree, so it has to stay one: a panel inside its own
        // sub-panel makes every walk over it either wrong or endless.
        const parentOf = async (id: string) => {
          const row = await prisma.asset.findUnique({ where: { id }, select: { parentId: true } });
          return row?.parentId ?? null;
        };
        if (await wouldCycleInHierarchy(existing.id, parentId, parentOf)) {
          return res.status(400).json({ error: "That would put this asset inside one of its own children." });
        }
      }
      data.parentId = parentId;
    }

    const asset = await prisma.asset.update({ where: { id: existing.id }, data, select: SELECT });
    await logActivity(req, { entityType: "asset", entityId: asset.id, action: "updated", summary: Object.keys(data).join(", ") });
    res.json({ asset: { ...asset, service: serviceStatus(asset) } });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/**
 * Record what one thing does to another.
 *
 * A relation points at an asset or at a space, never both and never neither — a
 * breaker feeding "something" is a record that reads as complete and answers
 * nothing.
 */
assetsRouter.post("/:id/relations", requires("property.write"), async (req, res) => {
  try {
    const from = await prisma.asset.findUnique({ where: { id: req.params.id }, select: { id: true, propertyId: true, name: true } });
    if (!from) return res.status(404).json({ error: "No such asset." });

    const kind = oneOf(req.body.kind, RELATION_KINDS, "Kind");
    const toAssetId = parseOptionalString(req.body.toAssetId, "Asset", 40) ?? null;
    const toSpaceId = parseOptionalString(req.body.toSpaceId, "Space", 40) ?? null;

    if (!toAssetId && !toSpaceId) return res.status(400).json({ error: "Point the relation at an asset or a space." });
    if (toAssetId && toSpaceId) return res.status(400).json({ error: "Point the relation at one thing, not two." });
    if (toAssetId === from.id) return res.status(400).json({ error: "An asset cannot feed itself." });

    if (toAssetId) {
      const target = await prisma.asset.findFirst({ where: { id: toAssetId, propertyId: from.propertyId }, select: { id: true } });
      if (!target) return res.status(400).json({ error: "That asset is not in this property." });
    }
    if (toSpaceId) {
      const target = await prisma.space.findFirst({ where: { id: toSpaceId, propertyId: from.propertyId }, select: { id: true } });
      if (!target) return res.status(400).json({ error: "That space is not in this property." });
    }

    const duplicate = await prisma.assetRelation.findFirst({
      where: { fromAssetId: from.id, kind, toAssetId, toSpaceId },
      select: { id: true },
    });
    if (duplicate) return res.status(409).json({ error: "That relation is already recorded." });

    /**
     * A supply loop is allowed to exist in the records, because ring mains and
     * cross-connections are real, and the walks are built to survive one. What is
     * refused is the trivial case above: a self-reference is always a slip.
     */
    const relation = await prisma.assetRelation.create({
      data: { fromAssetId: from.id, kind, toAssetId, toSpaceId, notes: parseOptionalString(req.body.notes, "Notes", 500) ?? null },
      select: {
        id: true, kind: true, notes: true,
        to: { select: { id: true, name: true, kind: true, ref: true } },
        toSpace: { select: { id: true, name: true, code: true } },
      },
    });

    await logActivity(req, {
      entityType: "asset", entityId: from.id, action: "relation added",
      summary: `${from.name} ${RELATION_LABELS[kind as never] ?? kind} ${relation.to?.name ?? relation.toSpace?.name ?? ""}`.trim(),
    });
    res.status(201).json({ relation });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

assetsRouter.delete("/:id/relations/:relationId", requires("property.write"), async (req, res) => {
  const relation = await prisma.assetRelation.findFirst({
    where: { id: req.params.relationId, fromAssetId: req.params.id },
    select: { id: true, kind: true },
  });
  if (!relation) return res.status(404).json({ error: "No such relation." });

  await prisma.assetRelation.delete({ where: { id: relation.id } });
  await logActivity(req, { entityType: "asset", entityId: req.params.id, action: "relation removed", summary: relation.kind });
  res.json({ ok: true });
});

/**
 * Log a service, test or repair.
 *
 * Writing the service also moves `lastServicedAt`, so the register and the history
 * cannot disagree — two places to update is one place to forget.
 */
assetsRouter.post("/:id/services", requires("property.write"), async (req, res) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, serviceIntervalDays: true } });
    if (!asset) return res.status(404).json({ error: "No such asset." });

    const kind = oneOf(req.body.kind, SERVICE_KINDS, "Kind");
    const performedAt = parseOptionalDay(req.body.performedAt, "Performed") ?? new Date().toISOString().slice(0, 10);
    const summary = parseOptionalString(req.body.summary, "Summary", 2000);
    if (!summary) return res.status(400).json({ error: "Say what was done." });

    const reading = req.body.reading === undefined || req.body.reading === null || req.body.reading === ""
      ? null : Number(req.body.reading);
    if (reading !== null && !Number.isFinite(reading)) return res.status(400).json({ error: "A reading must be a number." });

    const service = await prisma.assetService.create({
      data: {
        assetId: asset.id, kind, performedAt: new Date(`${performedAt}T00:00:00.000Z`), summary, reading,
        performedBy: parseOptionalString(req.body.performedBy, "Performed by", 120) ?? null,
        unit: parseOptionalString(req.body.unit, "Unit", 20) ?? null,
        passed: req.body.passed === undefined || req.body.passed === null ? null : Boolean(req.body.passed),
      },
      select: { id: true, kind: true, performedAt: true, performedBy: true, summary: true, reading: true, unit: true, passed: true },
    });

    // Only a service resets the clock. A repair or a test is not a service, and
    // treating one as such is how a unit goes a year without being serviced while
    // the register reports it in date.
    const updated = kind === "service" || kind === "replacement"
      ? await prisma.asset.update({ where: { id: asset.id }, data: { lastServicedAt: service.performedAt }, select: SELECT })
      : await prisma.asset.findUnique({ where: { id: asset.id }, select: SELECT });

    await logActivity(req, { entityType: "asset", entityId: asset.id, action: `${kind} logged`, summary: summary.slice(0, 200) });
    res.status(201).json({ service, asset: updated ? { ...updated, service: serviceStatus(updated) } : null });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});
