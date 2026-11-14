// Slice 5: the equipment register and the relation graph, over the API.
const { session } = require('./session');
let fail = 0;
let req;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

(async () => {
  ({ req } = await session());
  ok(true, 'signed in (shared session)');

  const stamp = Date.now();
  const prop = (await req('POST', '/properties', { name: 'La Toc plant ' + stamp })).body;
  const other = (await req('POST', '/properties', { name: 'Elsewhere ' + stamp })).body;

  // A small but real slice of the site: one riser feeding two floors of rooms.
  const mkSpace = async (body) => (await req('POST', '/spaces', { propertyId: prop.id, ...body })).body;
  const blockRows = await mkSpace({ name: 'Coubaril', kind: 'block' });
  const block = blockRows.spaces.find(s => s.name === 'Coubaril');
  const floorRows = await mkSpace({ parentId: block.id, name: 'Floor 1', kind: 'floor' });
  const floor = floorRows.spaces.find(s => s.name === 'Floor 1');
  const roomRows = await mkSpace({ parentId: floor.id, names: '101-104', sellable: true });
  const rooms = ['101', '102', '103', '104'].map(n => roomRows.spaces.find(s => s.name === n && s.parentId === floor.id));
  ok(rooms.every(Boolean), 'four rooms to hang equipment off');

  const mk = async (body) => await req('POST', '/assets', { propertyId: prop.id, ...body });

  // ---- the register ------------------------------------------------------
  let r = await mk({ name: 'GEN-1', kind: 'generator', ref: 'GEN-1', rating: '250 kVA', serviceIntervalDays: 90 });
  ok(r.status === 201, `an asset can be created (${r.status})`);
  const gen = r.body.asset;
  ok(gen.kind === 'generator' && gen.rating === '250 kVA', 'with its kind and rating');

  r = await mk({ name: 'No kind here', kind: 'spaceship' });
  ok(r.status === 400, `an unknown kind is refused (${r.status})`);
  r = await mk({ name: '', kind: 'panel' });
  ok(r.status === 400, 'and an asset with no name');
  r = await mk({ name: 'Stray', kind: 'panel', spaceId: 'does-not-exist' });
  ok(r.status === 400, 'and one pointed at a space that does not exist');

  // A space from another property is a different mistake and a likelier one.
  const elsewhereRows = (await req('POST', '/spaces', { propertyId: other.id, name: 'Other block', kind: 'block' })).body;
  const elsewhere = elsewhereRows.spaces.find(s => s.name === 'Other block');
  r = await mk({ name: 'Cross-site', kind: 'panel', spaceId: elsewhere.id });
  ok(r.status === 400, `and one pointed at another property's space (${r.status})`);

  const dbmain = (await mk({ name: 'DB-MAIN', kind: 'panel', ref: 'DB-MAIN', spaceId: block.id })).body.asset;
  const db3 = (await mk({ name: 'DB-3', kind: 'panel', ref: 'DB-3', parentId: dbmain.id, spaceId: floor.id })).body.asset;
  const cb14 = (await mk({ name: 'CB-14', kind: 'breaker', ref: 'CB-14', parentId: db3.id })).body.asset;
  const cb15 = (await mk({ name: 'CB-15', kind: 'breaker', ref: 'CB-15', parentId: db3.id })).body.asset;

  r = await req('GET', `/assets?propertyId=${prop.id}`);
  ok(r.status === 200 && r.body.assets.length === 5, `the register lists all five (${r.body.assets.length})`);
  ok(r.body.assets.find(a => a.id === db3.id).spaceName.join(' · ') === 'Coubaril · Floor 1',
    'with the space as a readable path');
  ok(r.body.kinds.includes('generator') && r.body.relationKinds.includes('isolates'),
    'and the vocabularies the form needs');

  r = await req('GET', `/assets?propertyId=${prop.id}&kind=breaker`);
  ok(r.body.assets.length === 2, `filtering by kind works (${r.body.assets.length})`);

  r = await req('GET', '/assets');
  ok(r.status === 400, 'the register refuses to list every property at once');

  // ---- containment is a tree --------------------------------------------
  r = await req('PATCH', `/assets/${dbmain.id}`, { parentId: dbmain.id });
  ok(r.status === 400, `an asset cannot contain itself (${r.status})`);
  r = await req('PATCH', `/assets/${dbmain.id}`, { parentId: cb14.id });
  ok(r.status === 400, 'nor sit inside one of its own children');
  r = await req('PATCH', `/assets/${cb15.id}`, { parentId: dbmain.id });
  ok(r.status === 200, 'but it can be moved to a legitimate parent');
  await req('PATCH', `/assets/${cb15.id}`, { parentId: db3.id });

  // ---- relations ---------------------------------------------------------
  const rel = async (from, body) => await req('POST', `/assets/${from}/relations`, body);

  r = await rel(gen.id, { kind: 'feeds', toAssetId: dbmain.id });
  ok(r.status === 201, `a relation can be recorded (${r.status})`);
  r = await rel(gen.id, { kind: 'feeds', toAssetId: dbmain.id });
  ok(r.status === 409, `and recording it twice is refused (${r.status})`);

  r = await rel(gen.id, { kind: 'feeds' });
  ok(r.status === 400, 'a relation pointed at nothing is refused');
  r = await rel(gen.id, { kind: 'feeds', toAssetId: dbmain.id, toSpaceId: rooms[0].id });
  ok(r.status === 400, 'and one pointed at two things');
  r = await rel(gen.id, { kind: 'feeds', toAssetId: gen.id });
  ok(r.status === 400, 'and one pointed at itself');
  r = await rel(gen.id, { kind: 'powers', toAssetId: dbmain.id });
  ok(r.status === 400, 'and an unknown relation kind');
  r = await rel(gen.id, { kind: 'feeds', toSpaceId: elsewhere.id });
  ok(r.status === 400, "and one pointed at another property's space");

  await rel(dbmain.id, { kind: 'feeds', toAssetId: db3.id });
  await rel(db3.id, { kind: 'feeds', toAssetId: cb14.id });
  await rel(db3.id, { kind: 'feeds', toAssetId: cb15.id });
  await rel(cb14.id, { kind: 'feeds', toSpaceId: rooms[0].id });
  await rel(cb14.id, { kind: 'feeds', toSpaceId: rooms[1].id });
  await rel(cb15.id, { kind: 'feeds', toSpaceId: rooms[2].id });

  // ---- the question this exists to answer -------------------------------
  r = await req('GET', `/assets/${cb14.id}`);
  ok(r.status === 200, 'an asset reads back');
  ok(r.body.affects.spaces.length === 2, `a breaker takes out two rooms (${r.body.affects.spaces.length})`);
  ok(r.body.affects.sellableCount === 2, 'both of them sellable');
  ok(r.body.affects.spaces[0].space.path.join(' · ').startsWith('Coubaril · Floor 1'),
    'named by path rather than by id');
  ok(r.body.fedBy.map(a => a.asset.name).includes('GEN-1'), 'and the generator is upstream of it');

  r = await req('GET', `/assets/${gen.id}`);
  ok(r.body.affects.spaces.length === 3, `the generator takes out all three wired rooms (${r.body.affects.spaces.length})`);
  ok(r.body.affects.assets.length === 4, `through four boards (${r.body.affects.assets.length})`);
  ok(r.body.fedBy.length === 0, 'and nothing feeds the generator');

  // Room 104 was never wired to anything, so it must not appear.
  const reached = r.body.affects.spaces.map(s => s.space && s.space.name);
  ok(!reached.includes('104'), 'a room with no recorded supply is not claimed as affected');

  // ---- the trace, from the room's end -----------------------------------
  r = await req('GET', `/assets/trace?spaceId=${rooms[0].id}`);
  ok(r.status === 200, `the trace endpoint is reachable, not read as an id (${r.status})`);
  ok(r.body.fedBy.length === 4, `four things feed room 101 (${r.body.fedBy.length})`);
  ok(r.body.fedBy[0].asset.name === 'CB-14', 'nearest first');
  ok(r.body.isolateAt.length === 0, 'with no isolation point recorded yet');

  await rel(cb14.id, { kind: 'isolates', toSpaceId: rooms[0].id });
  await rel(dbmain.id, { kind: 'isolates', toSpaceId: rooms[0].id });
  r = await req('GET', `/assets/trace?spaceId=${rooms[0].id}`);
  ok(r.body.isolateAt.length === 2, `two isolation points once recorded (${r.body.isolateAt.length})`);
  ok(r.body.isolateAt[0].asset.name === 'CB-14',
    'and the breaker that drops one room is listed before the board that drops the block');

  r = await req('GET', '/assets/trace?spaceId=nope');
  ok(r.status === 404, 'tracing a space that does not exist is a 404');
  r = await req('GET', '/assets/trace');
  ok(r.status === 400, 'and tracing nothing is a 400');

  // ---- services ---------------------------------------------------------
  const ahu = (await mk({ name: 'AHU-2', kind: 'ahu', serviceIntervalDays: 90, installedAt: '2026-01-10' })).body.asset;
  ok(ahu.service.state === 'never', `a unit with an interval and no service record reads as never (${ahu.service.state})`);

  r = await req('POST', `/assets/${ahu.id}/services`, { kind: 'service', performedAt: '2026-11-01', summary: 'Coils washed, filters changed.' });
  ok(r.status === 201, `a service can be logged (${r.status})`);
  ok(r.body.asset.service.state === 'ok', 'and the unit is in date afterwards');
  ok(r.body.asset.lastServicedAt.slice(0, 10) === '2026-11-01',
    'the register moves with the log rather than needing its own update');

  // A test or a repair is not a service, and must not reset the clock.
  const before = r.body.asset.lastServicedAt;
  r = await req('POST', `/assets/${ahu.id}/services`, { kind: 'repair', performedAt: '2026-11-10', summary: 'Belt replaced.' });
  ok(r.status === 201 && r.body.asset.lastServicedAt === before,
    'a repair is recorded without resetting the service clock');
  r = await req('POST', `/assets/${ahu.id}/services`, { kind: 'test', performedAt: '2026-11-11', summary: 'Insulation test.', reading: 12.4, unit: 'MΩ', passed: true });
  ok(r.status === 201 && r.body.service.reading === 12.4, 'a test carries a reading and a verdict');
  ok(r.body.asset.lastServicedAt === before, 'and also leaves the clock alone');

  r = await req('POST', `/assets/${ahu.id}/services`, { kind: 'service', summary: '' });
  ok(r.status === 400, 'a service with no summary is refused');
  r = await req('POST', `/assets/${ahu.id}/services`, { kind: 'polish', summary: 'x' });
  ok(r.status === 400, 'and an unknown service kind');
  r = await req('POST', `/assets/${ahu.id}/services`, { kind: 'test', summary: 'x', reading: 'high' });
  ok(r.status === 400, 'and a reading that is not a number');

  // A date that does not exist must not roll over into the next month.
  r = await req('POST', `/assets/${ahu.id}/services`, { kind: 'service', performedAt: '2026-02-30', summary: 'x' });
  ok(r.status === 400, `the thirtieth of February is refused, not rolled into March (${r.status})`);

  r = await req('GET', `/assets/${ahu.id}`);
  ok(r.body.asset.services.length === 3, `the history holds all three entries (${r.body.asset.services.length})`);
  ok(r.body.asset.services[0].kind === 'test', 'most recent first');

  // ---- the due list -----------------------------------------------------
  const old1 = (await mk({ name: 'FCU-9', kind: 'fcu', serviceIntervalDays: 90, lastServicedAt: '2026-03-01' })).body.asset;
  const old2 = (await mk({ name: 'FCU-10', kind: 'fcu', serviceIntervalDays: 90, lastServicedAt: '2026-07-01' })).body.asset;
  await mk({ name: 'Tank, no interval', kind: 'tank' });

  r = await req('GET', `/assets/due?propertyId=${prop.id}`);
  ok(r.status === 200, `the due list is reachable, not read as an id (${r.status})`);
  const dueIds = r.body.due.map(a => a.id);
  ok(dueIds.includes(old1.id) && dueIds.includes(old2.id), 'both lapsed units are listed');
  ok(!dueIds.includes(ahu.id), 'and the one just serviced is not');
  ok(r.body.due[0].id === old1.id, 'worst first');
  ok(!r.body.due.some(a => a.name === 'Tank, no interval'),
    'equipment with no interval is absent rather than reported overdue');
  ok(r.body.counts.overdue >= 2, `with a count to put on the dashboard (${r.body.counts.overdue})`);

  // ---- relations can be removed -----------------------------------------
  const detail = (await req('GET', `/assets/${cb15.id}`)).body;
  const toRemove = detail.asset.relationsOut[0];
  r = await req('DELETE', `/assets/${cb15.id}/relations/${toRemove.id}`);
  ok(r.status === 200, `a relation can be removed (${r.status})`);
  r = await req('DELETE', `/assets/${cb15.id}/relations/${toRemove.id}`);
  ok(r.status === 404, 'and removing it twice is a 404');
  r = await req('GET', `/assets/${gen.id}`);
  ok(r.body.affects.spaces.length === 2, `the blast radius shrinks accordingly (${r.body.affects.spaces.length})`);

  // ---- an asset on an issue ---------------------------------------------
  r = await req('POST', '/issues', { propertyId: prop.id, title: 'AHU-2 noisy', priority: 'medium', lat: 13.99, lng: -61.0, assetId: ahu.id, spaceId: rooms[0].id });
  ok(r.status === 201, `an issue can name the asset and the room it is about (${r.status})`);
  ok(r.body.assetId === ahu.id && r.body.spaceId === rooms[0].id, 'and keeps both');

  // Both have to belong to this property, or the tree can be made to count rooms
  // at another resort.
  r = await req('POST', '/issues', { propertyId: prop.id, title: 'Cross-site', priority: 'medium', lat: 13.99, lng: -61.0, spaceId: elsewhere.id });
  ok(r.status === 400, `an issue cannot be filed against another property's space (${r.status})`);
  const otherAsset = (await req('POST', '/assets', { propertyId: other.id, name: 'Far pump', kind: 'pump' })).body.asset;
  r = await req('POST', '/issues', { propertyId: prop.id, title: 'Cross-site 2', priority: 'medium', lat: 13.99, lng: -61.0, assetId: otherAsset.id });
  ok(r.status === 400, "nor against another property's equipment");
  r = await req('GET', `/assets/${ahu.id}`);
  ok(r.body.asset.issues.length === 1 && r.body.asset.issues[0].title === 'AHU-2 noisy',
    'and the asset reads back its own history of faults');

  r = await req('GET', '/assets/does-not-exist');
  ok(r.status === 404, 'an unknown asset is a 404');

  console.log(fail === 0 ? '\nAll api-assets checks passed.' : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
