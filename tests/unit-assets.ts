import {
  downstream, upstream, isolationPoints, serviceStatus, parseInterval,
  placeAssets, mapMarkers, MAX_WALK_DEPTH,
  type RelationEdge, type Placeable, type SpacePoint,
} from "../server/src/lib/assets";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "PASS" : "FAIL") + " — " + m); if (!c) fail++; };
const threw = (fn: () => unknown): boolean => { try { fn(); return false; } catch { return true; } };

let seq = 0;
const feeds = (from: string, to: string, kind = "feeds"): RelationEdge =>
  ({ id: `e${seq++}`, fromAssetId: from, toAssetId: to, toSpaceId: null, kind });
const serves = (from: string, space: string, kind = "feeds"): RelationEdge =>
  ({ id: `e${seq++}`, fromAssetId: from, toAssetId: null, toSpaceId: space, kind });

/*
 * The site this models, which is the shape the real one takes:
 *
 *   GEN-1 ──> DB-MAIN ──> DB-3 ──> CB-14 ──> room 101
 *                     │                  └─> room 102
 *                     └──> DB-4 ──> CB-02 ──> lobby
 *
 * The question that matters is asked at CB-14 and at DB-MAIN, and the answers have
 * to differ by more than one hop.
 */
const site: RelationEdge[] = [
  feeds("gen1", "dbmain"),
  feeds("dbmain", "db3"),
  feeds("dbmain", "db4"),
  feeds("db3", "cb14"),
  feeds("db4", "cb02"),
  serves("cb14", "r101"),
  serves("cb14", "r102"),
  serves("cb02", "lobby"),
];

// ---- downstream: what else goes dark -------------------------------------
const atCb14 = downstream("cb14", site);
ok(atCb14.spaces.length === 2, `a breaker reaches its two rooms (${atCb14.spaces.length})`);
ok(atCb14.spaces.map((s) => s.id).sort().join(",") === "r101,r102", "and names them");
ok(atCb14.assets.length === 0, "with nothing downstream of it");

const atMain = downstream("dbmain", site);
ok(atMain.spaces.length === 3, `the main board reaches all three spaces (${atMain.spaces.length})`);
ok(atMain.assets.length === 4, `through four boards and breakers (${atMain.assets.length})`);

// Transitive is the whole point: a one-hop answer at DB-MAIN would name DB-3 and
// DB-4 and no rooms at all, which is exactly the answer nobody needs.
ok(atMain.spaces.every((s) => s.depth > 1), "the rooms it reaches are all more than one hop away");
ok(atMain.assets.find((a) => a.id === "cb14")?.depth === 2, "and depth counts the real distance");

// Depth is shortest-path, not first-seen, so a board reachable two ways reports the
// near route — the one somebody will actually trace.
const twoWays = [...site, feeds("dbmain", "cb14")];
ok(downstream("dbmain", twoWays).assets.find((a) => a.id === "cb14")?.depth === 1,
  "a second, shorter route wins");

// ---- upstream: what feeds this room --------------------------------------
const feedingR101 = upstream({ spaceId: "r101" }, site);
ok(feedingR101.assets.length === 4, `four things feed room 101 (${feedingR101.assets.length})`);
ok(feedingR101.assets[0].id === "cb14", "nearest first");
ok(feedingR101.assets.map((a) => a.id).includes("gen1"), "and the walk reaches the generator");

const feedingLobby = upstream({ spaceId: "lobby" }, site);
ok(!feedingLobby.assets.map((a) => a.id).includes("db3"), "the other riser does not feed the lobby");

ok(upstream({ spaceId: "nowhere" }, site).assets.length === 0, "an unconnected space is fed by nothing");
ok(upstream({}, site).assets.length === 0, "and a walk with no target returns nothing rather than everything");

// ---- loops ---------------------------------------------------------------
// A ring main is a real arrangement and a miswired record is a common one. Either
// way the walk has to come back.
const ring: RelationEdge[] = [feeds("a", "b"), feeds("b", "c"), feeds("c", "a"), serves("c", "hall")];
const inRing = downstream("a", ring);
ok(inRing.assets.length === 3, `a loop is walked once per node, not endlessly (${inRing.assets.length})`);
ok(inRing.spaces.map((s) => s.id).join(",") === "hall", "and the space past the loop is still reached");
ok(upstream({ spaceId: "hall" }, ring).assets.length === 3, "and the loop walks backwards too");

// ---- bounds --------------------------------------------------------------
const chain: RelationEdge[] = [];
for (let i = 0; i < 40; i += 1) chain.push(feeds(`n${i}`, `n${i + 1}`));
const deep = downstream("n0", chain);
ok(deep.truncated, "a chain longer than the bound reports that it was cut short");
ok(deep.assets.length === MAX_WALK_DEPTH, `and stops at the bound (${deep.assets.length})`);
ok(!downstream("cb14", site).truncated, "a normal walk does not claim truncation");

// ---- isolation follows a different relation ------------------------------
// The valve that isolates a room is not the pump that serves it. Answering "where
// do I shut this off" with the supply chain sends somebody to the wrong floor.
const water: RelationEdge[] = [
  feeds("pump", "riser", "serves"),
  feeds("riser", "v207", "serves"),
  serves("v207", "r207", "serves"),
  serves("v207", "r207", "isolates"),
  serves("riser", "r207", "isolates"),
];
const points = isolationPoints({ spaceId: "r207" }, water);
ok(points.length === 2, `two isolation points for the room (${points.length})`);
ok(points[0].id === "v207", "the local valve before the riser");
ok(points[1].id === "riser", "and the riser second, though both isolate the room directly");
ok(!points.map((p) => p.id).includes("pump"), "and the pump is supply, not isolation");

const supply = upstream({ spaceId: "r207" }, water, ["serves"]);
ok(supply.assets.map((a) => a.id).sort().join(",") === "pump,riser,v207", "while the supply walk sees all three");

// ---- service status ------------------------------------------------------
const now = new Date("2026-11-14T12:00:00.000Z");
const at = (d: string) => new Date(d + "T00:00:00.000Z");

ok(serviceStatus({ serviceIntervalDays: null, lastServicedAt: at("2026-01-01"), installedAt: null }, now).state === "unknown",
  "no interval means nothing can be said");
ok(serviceStatus({ serviceIntervalDays: 90, lastServicedAt: at("2026-10-01"), installedAt: null }, now).state === "ok",
  "serviced six weeks ago on a ninety-day interval is in date");
ok(serviceStatus({ serviceIntervalDays: 90, lastServicedAt: at("2026-05-01"), installedAt: null }, now).state === "overdue",
  "and six months ago is not");
ok(serviceStatus({ serviceIntervalDays: 90, lastServicedAt: at("2026-08-20"), installedAt: null }, now).state === "due",
  "a few days short of ninety reads as due, not ok");

// `never` is kept apart from `overdue` on purpose: one is a scheduling failure, the
// other usually means the record was never started, and they send somebody to look
// for different things.
const neverLogged = serviceStatus({ serviceIntervalDays: 90, lastServicedAt: null, installedAt: at("2026-01-01") }, now);
ok(neverLogged.state === "never", "a unit with no service record reads as never serviced");
ok((neverLogged.daysOverdue ?? 0) > 200, `and still says how far past due it is (${neverLogged.daysOverdue})`);
ok(serviceStatus({ serviceIntervalDays: 90, lastServicedAt: null, installedAt: null }, now).state === "never",
  "with no dates at all it is still never, not ok");

// Install date standing in for a missing service record is the difference between
// a new unit reading as compliant and reading as untouched.
ok(serviceStatus({ serviceIntervalDays: 90, lastServicedAt: null, installedAt: at("2026-11-01") }, now).state === "ok",
  "a unit fitted a fortnight ago is in date, not overdue by months");
ok(serviceStatus({ serviceIntervalDays: 90, lastServicedAt: at("2026-10-01"), installedAt: null }, now).dueOn === "2026-12-30",
  "the due date is the interval past the last service");

// Strings go in as readily as Dates: the API hands over ISO text.
ok(serviceStatus({ serviceIntervalDays: 90, lastServicedAt: "2026-05-01T00:00:00.000Z", installedAt: null }, now).state === "overdue",
  "an ISO string is read as a date");

// ---- interval parsing ----------------------------------------------------
ok(parseInterval(90) === 90, "a plain interval passes");
ok(parseInterval("90") === 90, "and so does one from a form");
ok(parseInterval(null) === null, "clearing it is allowed");
ok(parseInterval(undefined) === undefined, "and leaving it alone is distinct from clearing it");
ok(threw(() => parseInterval(0)), "zero days is refused");
ok(threw(() => parseInterval(-5)), "and a negative");
ok(threw(() => parseInterval(1.5)), "and a fraction of a day");
ok(threw(() => parseInterval(5000)), "and an interval longer than ten years");

// ---- where things sit on a map -------------------------------------------
const A = (o: Partial<Placeable> & { id: string }): Placeable =>
  ({ lat: null, lng: null, spaceId: null, parentId: null, ...o });
const S = (o: Partial<SpacePoint> & { id: string }): SpacePoint =>
  ({ parentId: null, lat: null, lng: null, ...o });

/*
 * A building with coordinates, a floor and a riser without, and a panel inside the
 * riser with a breaker inside it. Which is the normal case: the site is surveyed,
 * the cupboard on floor two is not.
 */
const places: SpacePoint[] = [
  S({ id: "block", lat: 13.99, lng: -61.0 }),
  S({ id: "floor2", parentId: "block" }),
  S({ id: "riser", parentId: "floor2" }),
  S({ id: "yard", lat: 13.98, lng: -61.01 }),
];

const kit: Placeable[] = [
  A({ id: "gen", lat: 13.981, lng: -61.011, spaceId: "yard" }),
  A({ id: "dbmain", spaceId: "riser" }),
  A({ id: "cb14", parentId: "dbmain" }),
  A({ id: "tank", lat: 13.979, lng: -61.012 }),
  A({ id: "orphan" }),
];
const placed = placeAssets(kit, places);

ok(placed.get("gen")!.source === "own", "a surveyed generator uses its own position");
ok(placed.get("gen")!.lat === 13.981, "the one recorded against it, not its yard's");

// The point of anchoring: a riser has no GPS worth trusting, the building does.
ok(placed.get("dbmain")!.source === "space", "a board in an unplaced riser falls back to a space");
ok(placed.get("dbmain")!.lat === 13.99, "the nearest ancestor that has been placed");
ok(placed.get("dbmain")!.anchorId === "block", "and says which one it anchored to");

ok(placed.get("cb14")!.source === "parent", "a breaker inside a board sits where the board does");
ok(placed.get("cb14")!.lat === 13.99, "at the same point");
ok(placed.get("cb14")!.anchorId === "block", "sharing the board\u2019s anchor rather than making its own");

ok(placed.get("tank")!.source === "own", "equipment in no space at all is still placed by its own position");
ok(placed.get("orphan")!.source === "none", "and one with neither is honestly unplaced");
ok(placed.get("orphan")!.lat === null, "with no coordinate invented for it");

// A containment loop in the records must not hang the walk.
const looped = placeAssets([A({ id: "x", parentId: "y" }), A({ id: "y", parentId: "x" })], []);
ok(looped.get("x")!.source === "none" && looped.get("y")!.source === "none",
  "a containment loop resolves to unplaced rather than hanging");

// ---- markers, not pins ----------------------------------------------------
const { markers, unplaced } = mapMarkers(placed);
ok(markers.length === 3, `four placed assets make three markers (${markers.length})`);
ok(unplaced.join(",") === "orphan", "and the unplaced one is reported rather than dropped");

const atBlock = markers.find((m) => m.anchorId === "block")!;
ok(atBlock.assetIds.join(",") === "cb14,dbmain", "the board and its breaker share one marker");
ok(atBlock.anchorKind === "space", "anchored to the building");

const atGen = markers.find((m) => m.anchorId === "gen")!;
ok(atGen.assetIds.join(",") === "gen", "the generator keeps its own");
ok(markers.every((m) => m.lat !== null), "every marker has a position");

// Eight breakers in one riser is the case this exists to prevent.
const riserKit: Placeable[] = [A({ id: "board", spaceId: "riser" })];
for (let i = 0; i < 8; i += 1) riserKit.push(A({ id: `cb${i}`, parentId: "board" }));
const dense = mapMarkers(placeAssets(riserKit, places));
ok(dense.markers.length === 1, `nine items in one riser draw one marker (${dense.markers.length})`);
ok(dense.markers[0].assetIds.length === 9, "holding all nine");

console.log(fail === 0 ? "\nAll unit-assets checks passed." : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
