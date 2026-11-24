// Two ways to work a walk-through: photograph first, or one issue at a time.
const { session } = require('./session');
let fail = 0;
let req, state;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const API = process.env.MM_API || 'http://127.0.0.1:4000';

(async () => {
  const s = await session();
  req = s.req;
  state = s;

  const stamp = Date.now();
  const prop = (await req('POST', '/properties', { name: 'Walk modes ' + stamp })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });
  const other = (await req('POST', '/properties', { name: 'Elsewhere ' + stamp })).body;

  const rows = (await req('POST', '/spaces', { propertyId: prop.id, name: 'Coubaril', kind: 'block' })).body;
  const block = rows.spaces.find(x => x.name === 'Coubaril');
  const roomRows = await req('POST', '/spaces', { propertyId: prop.id, parentId: block.id, names: '101-102', sellable: true });
  const r101 = roomRows.body.spaces.find(x => x.name === '101');
  const r102 = roomRows.body.spaces.find(x => x.name === '102');
  const far = (await req('POST', '/spaces', { propertyId: other.id, name: 'Far block', kind: 'block' })).body
    .spaces.find(x => x.name === 'Far block');

  // ---- the default is unchanged ---------------------------------------
  let r = await req('POST', '/walkthroughs', { propertyId: prop.id });
  ok(r.status === 201, `a walk starts (${r.status})`);
  ok(r.body.mode === 'group', `and works the old way unless told otherwise (${r.body.mode})`);

  r = await req('POST', '/walkthroughs', { propertyId: prop.id, mode: 'nonsense' });
  ok(r.body.mode === 'group', 'an unknown mode falls back rather than being stored');

  // ---- starting one that is worked a room at a time -------------------
  r = await req('POST', '/walkthroughs', { propertyId: prop.id, mode: 'direct', spaceId: r101.id, roomName: 'Room 101' });
  ok(r.status === 201 && r.body.mode === 'direct', `a direct walk starts (${r.body.mode})`);
  ok(r.body.spaceId === r101.id, 'carrying where it is');
  ok(r.body.roomName === 'Room 101', 'and what the person called it');
  const walk = r.body;

  // Choosing from the tree alone still has to produce a readable room, because
  // roomName is what every issue list in the app actually prints.
  r = await req('POST', '/walkthroughs', { propertyId: prop.id, mode: 'direct', spaceId: r102.id });
  ok(r.body.roomName === '102', `a location chosen from the tree names itself (${r.body.roomName})`);
  r = await req('POST', '/walkthroughs', { propertyId: prop.id, mode: 'direct', spaceId: r102.id, roomName: 'The one with the broken blind' });
  ok(r.body.roomName === 'The one with the broken blind', 'and typed text still wins');

  r = await req('POST', '/walkthroughs', { propertyId: prop.id, mode: 'direct', spaceId: far.id });
  ok(r.status === 400, `a space from another property is refused (${r.status})`);

  // The mode survives a reload, which is the point of storing it.
  r = await req('GET', `/walkthroughs/${walk.id}`);
  ok(r.body.mode === 'direct', 'the mode is still there when the walk is picked back up');

  // ---- a named issue, no photographs ----------------------------------
  r = await req('POST', `/walkthroughs/${walk.id}/issues`, { title: 'Corridor light out' });
  ok(r.status === 201, `an issue can be logged with a name alone (${r.status}) ${r.body && r.body.error || ''}`);
  ok(r.body.title === 'Corridor light out', 'keeping its name');
  ok(r.body.photos.length === 0, 'with no photographs');
  ok(r.body.spaceId === r101.id, 'filed against the location the walk is at');
  ok(r.body.roomName === 'Room 101', 'and the free text too');
  ok(r.body.walkthroughId === walk.id, 'and attached to the walk');
  ok(r.body.lat === 13.99, `positioned from the property centre when nothing better exists (${r.body.lat})`);

  r = await req('POST', `/walkthroughs/${walk.id}/issues`, { title: '   ' });
  ok(r.status === 400, 'a nameless issue is refused');
  r = await req('POST', `/walkthroughs/${walk.id}/issues`, { title: 'x'.repeat(201) });
  ok(r.status === 400, 'and an absurdly long name');

  // ---- a named issue with photographs ---------------------------------
  const upload = async (walkId, n) => {
    const form = new FormData();
    for (let i = 0; i < n; i += 1) form.append('photos', new Blob([PNG], { type: 'image/png' }), `shot${i}.png`);
    const res = await fetch(API + `/api/walkthroughs/${walkId}/photos`, {
      method: 'POST',
      headers: { Cookie: state.cookie, 'X-CSRF-Token': state.csrf },
      body: form,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  let up = await upload(walk.id, 2);
  ok(up.status === 201 || up.status === 200, `photos can be added to the walk (${up.status}) ${up.body && up.body.error || ''}`);
  const shots = up.body.map(p => p.id);

  r = await req('POST', `/walkthroughs/${walk.id}/issues`, { title: 'Cracked tile by the lift', photoIds: shots });
  ok(r.status === 201, `an issue can carry photographs (${r.status})`);
  ok(r.body.photos.length === 2, `both of them (${r.body.photos.length})`);

  // They move off the walk, so the same photo cannot be logged twice.
  r = await req('GET', `/walkthroughs/${walk.id}`);
  ok(r.body.photos.length === 0, 'and leave the walk\'s unsorted pile');
  r = await req('POST', `/walkthroughs/${walk.id}/issues`, { title: 'Second claim', photoIds: shots });
  ok(r.status === 400, 'claiming them again is refused rather than silently making an empty issue');

  // ---- the location moves with the walker -----------------------------
  r = await req('PUT', `/walkthroughs/${walk.id}`, { spaceId: r102.id, roomName: 'Room 102' });
  ok(r.status === 200 && r.body.spaceId === r102.id, 'the walk can be moved to the next room');
  r = await req('POST', `/walkthroughs/${walk.id}/issues`, { title: 'Tap drips' });
  ok(r.body.spaceId === r102.id, 'and what is logged next is filed there');
  ok(r.body.roomName === 'Room 102', 'under the new name too');

  r = await req('PUT', `/walkthroughs/${walk.id}`, { spaceId: far.id });
  ok(r.status === 400, "a space from another property is refused on the way through as well");

  // An issue may override the walk's location without moving the walk.
  r = await req('POST', `/walkthroughs/${walk.id}/issues`, { title: 'Spotted in passing', spaceId: r101.id });
  ok(r.body.spaceId === r101.id, 'one issue can be filed elsewhere without moving the walk');
  r = await req('GET', `/walkthroughs/${walk.id}`);
  ok(r.body.spaceId === r102.id, 'and the walk stays where it was');

  // ---- grouping still means what it meant -----------------------------
  const groupWalk = (await req('POST', '/walkthroughs', { propertyId: prop.id })).body;
  r = await req('POST', `/walkthroughs/${groupWalk.id}/group`, { photoIds: [] });
  ok(r.status === 400, 'grouping nothing is still refused — the evidence is the finding there');
  up = await upload(groupWalk.id, 2);
  r = await req('POST', `/walkthroughs/${groupWalk.id}/group`, { photoIds: up.body.map(p => p.id), title: 'Mould patch' });
  ok(r.status === 201 && r.body.photos.length === 2, `and grouping still works (${r.status})`);

  // ---- a finished walk takes nothing more -----------------------------
  r = await req('PUT', `/walkthroughs/${walk.id}`, { areas: 'Coubaril, floors 1-2', state: 'completed' });
  ok(r.status === 200, `the walk can be finished (${r.status})`);
  r = await req('POST', `/walkthroughs/${walk.id}/issues`, { title: 'Too late' });
  ok(r.status === 400, 'and takes no more issues once it is');

  r = await req('GET', `/walkthroughs/${walk.id}`);
  ok(r.body.issues.length === 4, `the walk holds everything logged on it (${r.body.issues.length})`);

  console.log(fail === 0 ? '\nAll api-walkmode checks passed.' : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
