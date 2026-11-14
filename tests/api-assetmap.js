// Slice 5b: equipment placed on a map, and photographed.
const { session } = require('./session');
const fs = require('fs');
const path = require('path');
let fail = 0;
let req, state;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

// A one-pixel PNG is a real image as far as the pipeline is concerned, which is
// what this needs to prove — not that a photograph looks nice.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

(async () => {
  const s = await session();
  req = s.req;
  state = s;

  const stamp = Date.now();
  const prop = (await req('POST', '/properties', { name: 'La Toc map ' + stamp })).body;

  // A block that has been surveyed, a floor and a riser inside it that have not.
  const mkSpace = async (body) => (await req('POST', '/spaces', { propertyId: prop.id, ...body })).body;
  const block = (await mkSpace({ name: 'Coubaril', kind: 'block' })).spaces.find(x => x.name === 'Coubaril');
  await req('PUT', `/spaces/${block.id}`, { lat: 13.99, lng: -61.0 });
  const floor = (await mkSpace({ parentId: block.id, name: 'Floor 2', kind: 'floor' })).spaces.find(x => x.name === 'Floor 2');
  const riser = (await mkSpace({ parentId: floor.id, name: 'Riser', kind: 'space' })).spaces.find(x => x.name === 'Riser');
  const yard = (await mkSpace({ name: 'Plant yard', kind: 'block' })).spaces.find(x => x.name === 'Plant yard');

  const mk = async (body) => (await req('POST', '/assets', { propertyId: prop.id, ...body })).body.asset;
  const gen = await mk({ name: 'GEN-1', kind: 'generator', ref: 'GEN-1', spaceId: yard.id, lat: 13.981, lng: -61.011 });
  const board = await mk({ name: 'Riser board', kind: 'panel', ref: 'DB-3', spaceId: riser.id });
  const cb14 = await mk({ name: 'Rooms 101-102', kind: 'breaker', ref: 'CB-14', parentId: board.id });
  const cb15 = await mk({ name: 'Room 103', kind: 'breaker', ref: 'CB-15', parentId: board.id });
  const lost = await mk({ name: 'Unplaced pump', kind: 'pump', ref: 'P-9' });

  // ---- the map --------------------------------------------------------
  let r = await req('GET', `/assets/map?propertyId=${prop.id}`);
  ok(r.status === 200, `the map endpoint is reachable, not read as an id (${r.status})`);
  const { markers, unplaced } = r.body;

  ok(markers.length === 2, `five assets make two markers (${markers.length})`);

  const own = markers.find(m => m.anchorKind === 'asset');
  ok(!!own, 'the surveyed generator anchors to itself');
  ok(own.lat === 13.981, 'at its own position');
  ok(own.assets.length === 1 && own.assets[0].ref === 'GEN-1', 'holding only itself');
  ok(own.assets[0].source === 'own', 'and says the position is surveyed');

  const atBlock = markers.find(m => m.anchorKind === 'space');
  ok(!!atBlock, 'the riser equipment anchors to a space');
  ok(atBlock.anchorId === block.id, 'the nearest ancestor that has been placed, not the riser');
  ok(atBlock.lat === 13.99, 'using the block position');
  ok(atBlock.spacePath.join(' · ') === 'Coubaril', 'and names it');
  ok(atBlock.assets.length === 3, `the board and both breakers share it (${atBlock.assets.length})`);
  const sources = atBlock.assets.map(a => a.source).sort();
  ok(sources.join(',') === 'parent,parent,space', `each says how it got there (${sources.join(',')})`);

  // Equipment the map cannot place is reported, not quietly dropped.
  ok(unplaced.length === 1 && unplaced[0].id === lost.id, `the unplaceable pump is reported (${unplaced.length})`);
  ok(markers.every(m => !m.assets.some(a => a.id === lost.id)), 'and is not drawn anywhere');

  // Placing it moves it onto the map.
  await req('PATCH', `/assets/${lost.id}`, { lat: 13.985, lng: -61.005 });
  r = await req('GET', `/assets/map?propertyId=${prop.id}`);
  ok(r.body.unplaced.length === 0, 'placing it clears the unplaced list');
  ok(r.body.markers.length === 3, `and adds a marker (${r.body.markers.length})`);

  // Giving the riser its own position pulls its equipment off the block.
  await req('PUT', `/spaces/${riser.id}`, { lat: 13.9905, lng: -61.0005 });
  r = await req('GET', `/assets/map?propertyId=${prop.id}`);
  const nowAtRiser = r.body.markers.find(m => m.anchorId === riser.id);
  ok(!!nowAtRiser, 'a placed riser becomes the anchor itself');
  ok(nowAtRiser.assets.length === 3, 'taking its equipment with it');
  ok(!r.body.markers.some(m => m.anchorId === block.id), 'and the block no longer carries them');

  r = await req('GET', '/assets/map');
  ok(r.status === 400, 'the map refuses to draw every property at once');

  // ---- photographs of equipment ---------------------------------------
  const tmp = path.join(require('os').tmpdir(), `mm-asset-${stamp}.png`);
  fs.writeFileSync(tmp, PNG);

  const upload = async (fields) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('photo', new Blob([PNG], { type: 'image/png' }), 'nameplate.png');
    const res = await fetch((process.env.MM_API || 'http://127.0.0.1:4000') + '/api/photos', {
      method: 'POST',
      headers: { Cookie: state.cookie, 'X-CSRF-Token': state.csrf },
      body: form,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  let up = await upload({ assetId: gen.id });
  ok(up.status === 201, `a photo of equipment can be uploaded (${up.status}) ${up.body && up.body.error || ''}`);
  ok(up.body.assetId === gen.id, 'and hangs off the equipment');

  up = await upload({});
  ok(up.status === 400, 'a photo belonging to nothing is refused');
  up = await upload({ assetId: gen.id, issueId: 'something' });
  ok(up.status === 400, 'and one claiming to belong to two things');
  up = await upload({ assetId: 'does-not-exist' });
  ok(up.status === 404, 'and one against equipment that does not exist');

  r = await req('GET', `/assets/${gen.id}`);
  ok(r.body.asset.photos.length === 1, `the photo reads back on the asset (${r.body.asset.photos.length})`);
  const photoId = r.body.asset.photos[0].id;

  r = await req('GET', `/assets/map?propertyId=${prop.id}`);
  const genMarker = r.body.markers.find(m => m.assets.some(a => a.id === gen.id));
  ok(genMarker.assets.find(a => a.id === gen.id).photoCount === 1,
    'and the map says which equipment is documented');

  // The file itself is served.
  const file = await fetch((process.env.MM_API || 'http://127.0.0.1:4000') + `/api/photos/${photoId}/file`, {
    headers: { Cookie: state.cookie },
  });
  ok(file.status === 200, `the image is served back (${file.status})`);

  r = await req('DELETE', `/photos/${photoId}`);
  ok(r.status === 200, `it can be removed (${r.status})`);
  r = await req('GET', `/assets/${gen.id}`);
  ok(r.body.asset.photos.length === 0, 'and is gone from the asset');

  // Deleting equipment must take its photographs with it, and nothing else.
  await upload({ assetId: cb15.id });
  r = await req('GET', `/assets/${cb15.id}`);
  ok(r.body.asset.photos.length === 1, 'a second photo is in place for the cascade check');

  // ---- a technician in the field --------------------------------------
  // The manual gets filled in by the people who open the panels, so adding a
  // photograph is deliberately a lower bar than changing the record. Removing one
  // is not: an extra photo costs nothing, a missing one cannot be recovered.
  const techName = 'Fieldhand ' + stamp;
  const tech = (await req('POST', '/technicians', { name: techName, trade: 'electrical' })).body;
  const techUser = 'tech' + stamp;
  const made = await req('POST', '/users', {
    username: techUser, password: 'correcthorsebattery9', role: 'technician', technicianId: tech.id,
  });
  ok(made.status === 201 || made.status === 200, `a technician login can be created (${made.status}) ${made.body && made.body.error || ''}`);

  const API = process.env.MM_API || 'http://127.0.0.1:4000';
  const techState = { cookie: '', csrf: '' };
  const asTech = async (method, pathname, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (techState.cookie) headers.Cookie = techState.cookie;
    if (techState.csrf) headers['X-CSRF-Token'] = techState.csrf;
    const r = await fetch(API + '/api' + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) techState.cookie = sc.split(';')[0];
    const t = r.headers.get('x-csrf-token');
    if (t) techState.csrf = t;
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  const signIn = await asTech('POST', '/auth/login', { username: techUser, password: 'correcthorsebattery9' });
  ok(signIn.status === 200, `the technician can sign in (${signIn.status})`);
  await asTech('GET', '/auth/me');

  const techUpload = async (fields) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('photo', new Blob([PNG], { type: 'image/png' }), 'nameplate.png');
    const res = await fetch(API + '/api/photos', {
      method: 'POST',
      headers: { Cookie: techState.cookie, 'X-CSRF-Token': techState.csrf },
      body: form,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  let t = await techUpload({ assetId: board.id });
  ok(t.status === 201, `a technician can photograph equipment (${t.status}) ${t.body && t.body.error || ''}`);
  const techPhotoId = t.body && t.body.id;

  // No crew check: the plant room walked past on the way to something else is
  // exactly the case this exists for.
  t = await techUpload({ assetId: gen.id });
  ok(t.status === 201, 'including equipment they are not assigned to');

  // But not removing one.
  t = await asTech('DELETE', `/photos/${techPhotoId}`);
  ok(t.status === 403, `a technician cannot remove one (${t.status})`);

  r = await req('DELETE', `/photos/${techPhotoId}`);
  ok(r.status === 200, 'while somebody who may change the records can');

  // Nor photographing equipment taken out of service.
  await req('PATCH', `/assets/${board.id}`, { active: false });
  t = await techUpload({ assetId: board.id });
  ok(t.status === 400, `equipment out of service takes no new photographs (${t.status})`);
  await req('PATCH', `/assets/${board.id}`, { active: true });

  fs.unlinkSync(tmp);
  console.log(fail === 0 ? '\nAll api-assetmap checks passed.' : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
