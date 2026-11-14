import {
  expandRange, matchSpaces, sellRollup, unambiguousMatch, withPaths, type SpaceNode,
} from "../server/src/lib/spaces";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "PASS" : "FAIL") + " — " + m); if (!c) fail++; };
const threw = (fn: () => unknown): boolean => { try { fn(); return false; } catch { return true; } };
const node = (o: Partial<SpaceNode> & { id: string; name: string }): SpaceNode =>
  ({ parentId: null, kind: "space", code: null, sellable: false, sellStatus: null, sortOrder: 0, active: true, ...o });

// ---- ranges: how 340 rooms get created without typing 340 names ----------
ok(expandRange("101-105").join(",") === "101,102,103,104,105", "a simple range expands");
ok(expandRange("101-140").length === 40, `forty rooms from one spec (${expandRange("101-140").length})`);
ok(expandRange("101-105,201-205").length === 10, "two runs in one spec");
ok(expandRange("Pool deck").join(",") === "Pool deck", "a plain name is taken as typed");
ok(expandRange("101, 103, 107").join(",") === "101,103,107", "and so is a list");

// Padding is preserved: a site numbered 001-040 does not want them renamed.
ok(expandRange("001-003").join(",") === "001,002,003", "zero padding survives");
ok(expandRange("098-102").join(",") === "098,099,100,101,102", "and widens correctly across a hundred");

// A letter prefix is kept rather than choking on it.
ok(expandRange("A1-A4").join(",") === "A1,A2,A3,A4", "a prefix is preserved");
ok(expandRange("1-3").join(",") === "1,2,3", "and no prefix is fine");

// Nonsense is refused rather than quietly producing something.
ok(threw(() => expandRange("105-101")), "a backwards range is refused");
ok(threw(() => expandRange("A1-B4")), "and one that changes prefix halfway");
ok(threw(() => expandRange("1-900")), "and one larger than 500 at a time");
ok(threw(() => expandRange("")), "and an empty spec");
ok(threw(() => expandRange("101-105,103")), "a spec that repeats itself is a typo, not a plan");

// ---- paths read out loud --------------------------------------------------
const tree: SpaceNode[] = [
  node({ id: "coub", name: "Coubaril", kind: "block" }),
  node({ id: "f1", name: "Floor 1", kind: "floor", parentId: "coub" }),
  node({ id: "r101", name: "101", code: "101", parentId: "f1", sellable: true }),
  node({ id: "blue", name: "Blue Suites", kind: "block" }),
  node({ id: "bf1", name: "Floor 1", kind: "floor", parentId: "blue" }),
  node({ id: "b101", name: "101", code: "101", parentId: "bf1", sellable: true }),
  node({ id: "plant", name: "Pool plant room", parentId: "coub" }),
];
const paths = withPaths(tree);
const r101 = paths.find((p) => p.id === "r101")!;
ok(r101.path.join(" · ") === "Coubaril · Floor 1 · 101", `a path reads out loud (${r101.path.join(" · ")})`);
ok(r101.depth === 2, `with a depth (${r101.depth})`);
ok(paths.find((p) => p.id === "coub")!.depth === 0, "a block is at the top");
// Two rooms can share a name in different blocks, which is normal.
ok(paths.filter((p) => p.name === "101").length === 2, "two blocks may both have a 101");
ok(paths.find((p) => p.id === "b101")!.path[0] === "Blue Suites", "and their paths tell them apart");

// A tree that already contains a loop must not hang the listing.
const looped = withPaths([
  node({ id: "a", name: "A", parentId: "b" }),
  node({ id: "b", name: "B", parentId: "a" }),
]);
ok(looped.length === 2, "a looped tree still lists");

// ---- matching free text to the tree -------------------------------------
// "Room 214" and the space called 214 are the same place, and a matcher that
// does not know that is useless on real data.
const single = withPaths([
  node({ id: "r214", name: "214", code: "214", parentId: null }),
  node({ id: "r215", name: "215", code: "215", parentId: null }),
  node({ id: "pool", name: "Pool deck", parentId: null }),
]);
let m = matchSpaces("Room 214", single);
ok(m.length >= 1 && m[0].spaceId === "r214", `"Room 214" finds 214 (${m[0]?.spaceId})`);
ok(m[0].how === "exact", `as an exact match once the noise word is dropped (${m[0]?.how})`);
ok(!!unambiguousMatch(m), "and is safe to apply without asking");

ok(matchSpaces("Rm 214", single)[0]?.spaceId === "r214", '"Rm 214" too');
ok(matchSpaces("214", single)[0]?.spaceId === "r214", "and the bare number");
ok(matchSpaces("Suite 215", single)[0]?.spaceId === "r215", "and a different noise word");
ok(matchSpaces("Pool deck", single)[0]?.spaceId === "pool", "a named space matches by name");

// A number that is not a room is not a match.
ok(matchSpaces("21", single).length === 0, '"21" does not match 214 or 215');
ok(matchSpaces("", single).length === 0, "empty text matches nothing");
ok(matchSpaces("Corridor by the lift", single).length === 0, "and text with nothing in common");

// ---- the case that must NOT be auto-applied -----------------------------
// Room 101 exists in two blocks. Picking either would be a coin toss recorded
// as a fact.
m = matchSpaces("Room 101", paths);
ok(m.filter((x) => x.how === "exact").length === 2, `101 matches in two blocks (${m.filter((x) => x.how === "exact").length})`);
ok(unambiguousMatch(m) === null, "so nothing is applied without somebody looking");

// ---- the sell-status round ----------------------------------------------
const rooms: SpaceNode[] = [
  node({ id: "1", name: "101", sellable: true, sellStatus: "green" }),
  node({ id: "2", name: "102", sellable: true, sellStatus: "green" }),
  node({ id: "3", name: "103", sellable: true, sellStatus: "amber" }),
  node({ id: "4", name: "104", sellable: true, sellStatus: "red" }),
  node({ id: "5", name: "105", sellable: true }),
  node({ id: "6", name: "Plant room", sellable: false }),
  node({ id: "7", name: "106", sellable: true, sellStatus: "green", active: false }),
];
const roll = sellRollup(rooms);
ok(roll.total === 5, `five sellable rooms, not seven (${roll.total})`);
ok(roll.green === 2 && roll.amber === 1 && roll.red === 1, `counted by status (${roll.green}/${roll.amber}/${roll.red})`);
ok(roll.unset === 1, `and one nobody has looked at (${roll.unset})`);
ok(roll.green + roll.amber + roll.red + roll.unset === roll.total, "the parts add up to the whole");
ok(sellRollup([]).total === 0, "no rooms is zero rather than a crash");

console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
