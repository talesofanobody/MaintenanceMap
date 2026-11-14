// Slice 4: the location tree, and reconciling the free text against it.
const { session } = require('./session');
let fail = 0;
let req;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

(async () => {
  ({ req } = await session());
  ok(true, 'signed in (shared session)');

  const stamp = Date.now();
  const prop = (await req('POST', '/properties', { name: 'La Toc tree ' + stamp })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });
  const tree = async () => (await req('GET', `/spaces?propertyId=${prop.id}`)).body;

  // ---- blocks, floors, rooms -------------------------------------------
  let r = await req('POST', '/spaces', { propertyId: prop.id, name: 'Coubaril', kind: 'block' });
  ok(r.status === 201, `a block can be created (${r.status})`);
  const coub = r.body.spaces.find(s => s.name === 'Coubaril');
  ok(coub.kind === 'block' && coub.parentId === null, 'at the top of the tree');

  const blue = (await req('POST', '/spaces', { propertyId: prop.id, name: 'Blue Suites', kind: 'block' })).body
    .spaces.find(s => s.name === 'Blue Suites');
  r = await req('POST', '/spaces', { propertyId: prop.id, parentId: coub.id, name: 'Floor 1', kind: 'floor' });
  ok(r.status === 201, 'a floor under a block');
  const f1 = r.body.spaces.find(s => s.name === 'Floor 1' && s.parentId === coub.id);

  r = await req('POST', '/spaces', { propertyId: prop.id, name: 'Coubaril', kind: 'block' });
  ok(r.body.created === 0 && r.body.skipped === 1, `the same name under one parent is skipped, not duplicated (${r.body.created}/${r.body.skipped})`);

  // ---- the range, which is why this is tolerable at all ----------------
  r = await req('POST', '/spaces', { propertyId: prop.id, parentId: f1.id, names: '101-140', sellable: true });
  ok(r.status === 201 && r.body.created === 40, `forty rooms from one spec (${r.body.created})`);
  const rooms = r.body.spaces.filter(s => s.parentId === f1.id);
  ok(rooms.length === 40, 'all under that floor');
  ok(rooms.every(s => s.sellable), 'and all sellable');
  ok(rooms.find(s => s.name === '101').code === '101', 'with the name doubling as the code');

  // Re-running fills gaps rather than refusing.
  r = await req('POST', '/spaces', { propertyId: prop.id, parentId: f1.id, names: '138-145', sellable: true });
  ok(r.body.created === 5 && r.body.skipped === 3, `re-running a range fills the gaps (${r.body.created} new, ${r.body.skipped} already there)`);

  r = await req('POST', '/spaces', { propertyId: prop.id, parentId: f1.id, names: '201-100' });
  ok(r.status === 400, `a backwards range is refused (${r.status})`);
  r = await req('POST', '/spaces', { propertyId: prop.id, parentId: f1.id, names: '1-900' });
  ok(r.status === 400, 'and one bigger than 500 at a time');
  r = await req('POST', '/spaces', { propertyId: prop.id, parentId: f1.id });
  ok(r.status === 400, 'and one with no name at all');

  // ---- paths read out loud ----------------------------------------------
  let t = await tree();
  const r101 = t.spaces.find(s => s.name === '101' && s.parentId === f1.id);
  ok(r101.path.join(' · ') === 'Coubaril · Floor 1 · 101', `a path reads out loud (${r101.path.join(' · ')})`);
  ok(r101.depth === 2, `with its depth (${r101.depth})`);

  // ---- moving, and not into itself --------------------------------------
  r = await req('PUT', `/spaces/${f1.id}`, { parentId: blue.id });
  ok(r.status === 200, `a floor can move to another block (${r.status})`);
  t = await tree();
  ok(t.spaces.find(s => s.id === r101.id).path[0] === 'Blue Suites', 'and its rooms move with it');
  await req('PUT', `/spaces/${f1.id}`, { parentId: coub.id });

  r = await req('PUT', `/spaces/${coub.id}`, { parentId: f1.id });
  ok(r.status === 400, `a block cannot move inside its own floor (${r.status})`);
  r = await req('PUT', `/spaces/${coub.id}`, { parentId: coub.id });
  ok(r.status === 400, 'nor inside itself');

  // ---- the sell-status round --------------------------------------------
  const plant = (await req('POST', '/spaces', { propertyId: prop.id, parentId: coub.id, name: 'Pool plant room' })).body
    .spaces.find(s => s.name === 'Pool plant room');
  r = await req('PUT', `/spaces/${plant.id}`, { sellStatus: 'green' });
  ok(r.status === 400, `a sell status on something nobody sells is refused (${r.status})`);

  await req('PUT', `/spaces/${r101.id}`, { sellStatus: 'red' });
  const r102 = t.spaces.find(s => s.name === '102');
  await req('PUT', `/spaces/${r102.id}`, { sellStatus: 'amber' });
  t = await tree();
  ok(t.sell.total === 45, `forty-five sellable rooms (${t.sell.total})`);
  ok(t.sell.red === 1 && t.sell.amber === 1, `counted by status (${t.sell.red} red, ${t.sell.amber} amber)`);
  ok(t.sell.unset === 43, `and the rest unlooked-at rather than green (${t.sell.unset})`);
  ok(t.sell.green + t.sell.amber + t.sell.red + t.sell.unset === t.sell.total, 'the parts add up');

  // ---- work points at a space, beside its own text ---------------------
  const issue = (await req('POST', '/issues', {
    propertyId: prop.id, title: 'Mould on the ceiling', lat: 13.99, lng: -61.0,
    priority: 'medium', roomName: 'Room 101',
  })).body;
  ok(issue.roomName === 'Room 101' && issue.spaceId === null, 'a new job starts with text and no space');

  // ---- reconciling, which is the whole point of coexisting -------------
  r = await req('GET', `/spaces/unmatched?propertyId=${prop.id}`);
  ok(r.status === 200, `the unmatched list reads (${r.status})`);
  const row = r.body.unmatched.find(u => u.text === 'Room 101');
  ok(!!row, 'the free text is listed');
  ok(row.total === 1, `with how many rows use it (${row.total})`);
  ok(row.matches.length >= 1 && row.matches[0].how === 'exact',
     `and an exact candidate once the noise word is dropped (${row.matches[0]?.how})`);
  ok(row.certain === r101.id, 'which is unambiguous, so safe to apply');

  r = await req('POST', '/spaces/reconcile', { propertyId: prop.id, auto: true });
  ok(r.status === 200, `the unambiguous ones can be applied at once (${r.status})`);
  ok(r.body.issues === 1, `matching the job (${r.body.issues})`);
  const matched = (await req('GET', `/issues/${issue.id}`)).body;
  ok(matched.spaceId === r101.id, 'the job now points at the space');
  ok(matched.roomName === 'Room 101', 'and keeps what was typed, rather than being rewritten');

  // ---- the case that must NOT be applied automatically -----------------
  // 101 exists in two blocks now, so "Room 101" is a coin toss.
  const bf1 = (await req('POST', '/spaces', { propertyId: prop.id, parentId: blue.id, name: 'Floor 1', kind: 'floor' })).body
    .spaces.find(s => s.parentId === blue.id && s.name === 'Floor 1');
  await req('POST', '/spaces', { propertyId: prop.id, parentId: bf1.id, names: '101-105', sellable: true });
  const second = (await req('POST', '/issues', {
    propertyId: prop.id, title: 'Another one', lat: 13.99, lng: -61.0, priority: 'low', roomName: 'Room 101',
  })).body;

  r = await req('GET', `/spaces/unmatched?propertyId=${prop.id}`);
  const ambiguous = r.body.unmatched.find(u => u.text === 'Room 101');
  ok(ambiguous.matches.filter(m => m.how === 'exact').length === 2,
     `101 now matches in two blocks (${ambiguous.matches.filter(m => m.how === 'exact').length})`);
  ok(ambiguous.certain === null, 'so nothing is certain any more');

  r = await req('POST', '/spaces/reconcile', { propertyId: prop.id, auto: true });
  ok(r.body.issues === 0, `and the automatic pass leaves it alone (${r.body.issues})`);
  ok((await req('GET', `/issues/${second.id}`)).body.spaceId === null, 'the job stays unmatched rather than guessed');

  // Named explicitly, it goes where it is told.
  r = await req('POST', '/spaces/reconcile', { propertyId: prop.id, text: 'Room 101', spaceId: r101.id });
  ok(r.body.issues === 1, `naming the space applies it (${r.body.issues})`);
  ok(r.body.remaining.issues === 0, `and says what is left (${r.body.remaining.issues})`);

  r = await req('POST', '/spaces/reconcile', { propertyId: prop.id, text: 'Room 999' });
  ok(r.status === 400, `reconciling with no space named is refused (${r.status})`);

  // ---- deleting takes the tree but not the history ---------------------
  r = await req('DELETE', `/spaces/${f1.id}`);
  ok(r.status === 400, `a floor with rooms under it is not deleted by accident (${r.status})`);
  ok(/spaces under it/.test(r.body?.error ?? ''), 'and says what is in the way');

  r = await req('DELETE', `/spaces/${f1.id}`, { force: true });
  ok(r.status === 204, `with force it goes (${r.status})`);
  const after = (await req('GET', `/issues/${issue.id}`)).body;
  ok(after.roomName === 'Room 101', 'the job keeps its own record of where it was');
  ok(after.spaceId === null, 'and simply stops pointing at a space');
  t = await tree();
  ok(!t.spaces.some(s => s.id === r101.id), 'the rooms beneath went with the floor');
  ok(t.spaces.some(s => s.id === coub.id), 'but the block above is untouched');

  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message, e.stack); process.exit(2); });
