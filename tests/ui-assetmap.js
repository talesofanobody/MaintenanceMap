// Slice 5b on screen: equipment on a map, with the graph in a side tab.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const B = process.env.MM_CLIENT || 'http://localhost:5173';
const API = (process.env.MM_API || 'http://localhost:4000') + '/api';
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  const noise = /favicon|404 \(Not Found\)|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|arcgisonline|tile/i;
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !noise.test(m.text())) errs.push(m.text().slice(0, 160)); });

  const { session } = require('./session');
  const { cookie } = await session();
  const [cn, cv] = cookie.split('=');
  await ctx.addCookies([{ name: cn, value: cv, domain: 'localhost', path: '/' }]);
  await page.goto(B + '/');
  await page.waitForSelector('.nav-toggle', { timeout: 20000 });
  const csrf = (await page.request.fetch(API + '/auth/me')).headers()['x-csrf-token'];
  const req = async (method, path, data) => {
    const r = await page.request.fetch(API + path, {
      method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, data,
    });
    return { status: r.status(), body: await r.json().catch(() => null) };
  };

  const stamp = Date.now();
  const name = 'ZZZ Map ' + stamp;
  const prop = (await req('POST', '/properties', { name })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });

  const mkSpace = async (body) => (await req('POST', '/spaces', { propertyId: prop.id, ...body })).body;
  const block = (await mkSpace({ name: 'Coubaril', kind: 'block' })).spaces.find(x => x.name === 'Coubaril');
  await req('PUT', `/spaces/${block.id}`, { lat: 13.9902, lng: -61.0002 });
  const floor = (await mkSpace({ parentId: block.id, name: 'Floor 1', kind: 'floor' })).spaces.find(x => x.name === 'Floor 1');
  const roomRows = await mkSpace({ parentId: floor.id, names: '101-103', sellable: true });
  const rooms = ['101', '102', '103'].map(n => roomRows.spaces.find(s => s.name === n && s.parentId === floor.id));

  const mk = async (body) => (await req('POST', '/assets', { propertyId: prop.id, ...body })).body.asset;
  const gen = await mk({ name: 'Standby set', kind: 'generator', ref: 'GEN-1', lat: 13.9893, lng: -61.0012, serviceIntervalDays: 90, lastServicedAt: '2026-02-01' });
  const board = await mk({ name: 'Riser board', kind: 'panel', ref: 'DB-3', spaceId: floor.id });
  const cb14 = await mk({ name: 'Rooms 101-102', kind: 'breaker', ref: 'CB-14', parentId: board.id });
  const cb15 = await mk({ name: 'Room 103', kind: 'breaker', ref: 'CB-15', parentId: board.id });
  await mk({ name: 'Homeless pump', kind: 'pump', ref: 'P-9' });

  const rel = async (from, body) => await req('POST', `/assets/${from}/relations`, body);
  await rel(gen.id, { kind: 'feeds', toAssetId: board.id });
  await rel(board.id, { kind: 'feeds', toAssetId: cb14.id });
  await rel(board.id, { kind: 'feeds', toAssetId: cb15.id });
  await rel(cb14.id, { kind: 'feeds', toSpaceId: rooms[0].id });
  await rel(cb14.id, { kind: 'feeds', toSpaceId: rooms[1].id });
  await rel(cb15.id, { kind: 'feeds', toSpaceId: rooms[2].id });

  // ---- reachable and drawing ------------------------------------------
  await page.click('.nav-toggle');
  await page.waitForTimeout(400);
  const link = page.locator('.app-nav a:text-is("Equipment map")');
  ok((await link.count()) > 0, 'Equipment map is in the menu');
  await link.first().click();
  await page.waitForSelector('.equipment-map-page', { timeout: 20000 });
  await page.selectOption('.page-header-actions select', { label: name });
  await page.waitForTimeout(1800);

  const pins = page.locator('.asset-pin');
  ok((await pins.count()) === 2, `five items draw two markers (${await pins.count()})`);

  // The generator is surveyed, the riser kit is not: the shapes must differ.
  const dashed = await page.locator('.asset-pin svg rect[stroke-dasharray]').count();
  ok(dashed === 1, `one marker is drawn as an area rather than a point (${dashed})`);
  const counts = await page.locator('.asset-pin svg text').allTextContents();
  ok(counts.includes('3'), `the clustered marker carries its count (${counts.join(',')})`);

  // Equipment that cannot be drawn is said out loud.
  const unplaced = page.locator('.eqmap-unplaced');
  ok((await unplaced.count()) === 1, 'the unplaceable item is reported, not hidden');
  ok((await unplaced.innerText()).includes('P-9'), 'and named');

  // ---- a cluster lists, a single opens ---------------------------------
  const dashedPin = page.locator('.asset-pin').filter({ has: page.locator('svg rect[stroke-dasharray]') });
  await dashedPin.first().click();
  await page.waitForSelector('.eqmap-cluster', { timeout: 10000 });
  const clusterText = await page.locator('.eqmap-cluster').innerText();
  ok(clusterText.includes('Coubaril'), 'the cluster names the space it hangs off');
  ok(clusterText.includes('DB-3') && clusterText.includes('CB-14'), 'and lists what is inside it');

  await page.locator('.eqmap-cluster-btn:has-text("CB-14")').first().click();
  await page.waitForSelector('.eqmap-tabs', { timeout: 10000 });
  ok((await page.locator('.eqmap-side-head').innerText()).includes('CB-14'), 'choosing one opens it');

  // ---- the side tabs ---------------------------------------------------
  await page.locator('.eqmap-tab:has-text("Controls")').click();
  await page.waitForTimeout(400);
  let pane = await page.locator('.eqmap-pane').innerText();
  ok(/2\s+spaces affected/.test(pane), `Controls shows what it takes out (${pane.split('\n')[0]})`);
  ok(pane.includes('101') && pane.includes('102'), 'naming the rooms');
  ok(!pane.includes('103'), 'and not the room on the other breaker');

  await page.locator('.eqmap-tab:has-text("Fed by")').click();
  await page.waitForTimeout(400);
  pane = await page.locator('.eqmap-pane').innerText();
  ok(pane.includes('DB-3') && pane.includes('GEN-1'), 'Fed by shows the chain above it');

  await page.locator('.eqmap-tab:has-text("Photos")').click();
  await page.waitForTimeout(400);
  pane = await page.locator('.eqmap-pane').innerText();
  ok(pane.toLowerCase().includes('no photographs yet'), 'Photos says plainly when there are none');

  await page.locator('.eqmap-tab:has-text("Details")').click();
  await page.waitForTimeout(400);
  pane = await page.locator('.eqmap-pane').innerText();
  ok(pane.includes('Riser board'), 'Details names what contains it');
  ok(pane.toLowerCase().includes('shown where the equipment containing it sits'),
    'and is honest that the position is inherited, not surveyed');

  // Getting back to the rest of the cluster.
  ok((await page.locator('.eqmap-side-head .link-button').count()) === 1, 'a way back to the other items here');

  // ---- following the chain, with the map keeping up --------------------
  // The real flow: standing at a breaker, work back to what feeds it. The
  // generator is a few hundred metres away, so the map has to move with the panel
  // or the selected marker is off screen and the panel is talking about nothing.
  await page.locator('.eqmap-tab:has-text("Fed by")').click();
  await page.waitForTimeout(400);
  await page.locator('.eqmap-pane .link-button:has-text("GEN-1")').click();
  await page.waitForSelector('.eqmap-tabs', { timeout: 10000 });
  // The map flies rather than jumping, so give the animation time to land.
  await page.waitForTimeout(1600);
  ok((await page.locator('.eqmap-side-head').innerText()).includes('GEN-1'), 'following the chain opens the generator');

  const selectedPin = page.locator('.asset-pin svg rect[stroke="#0b4fd1"]');
  ok((await selectedPin.count()) === 1, 'its marker is highlighted');
  const canvasBox = await page.locator('.eqmap-canvas').boundingBox();
  const pinBox = await selectedPin.first().boundingBox();
  ok(
    !!pinBox && pinBox.x >= canvasBox.x - 40 && pinBox.x <= canvasBox.x + canvasBox.width + 40 &&
    pinBox.y >= canvasBox.y - 40 && pinBox.y <= canvasBox.y + canvasBox.height + 40,
    'and the map moved to it rather than leaving it off screen'
  );

  await page.locator('.eqmap-tab:has-text("Details")').click();
  await page.waitForTimeout(400);
  pane = await page.locator('.eqmap-pane').innerText();
  ok(pane.toLowerCase().includes('surveyed'), 'a surveyed position says so');
  ok(pane.includes('Overdue'), 'the lapsed generator reads as overdue on the map too');

  // ---- placing something -----------------------------------------------
  await page.locator('.eqmap-unplaced .link-button:has-text("P-9")').click();
  await page.waitForSelector('.eqmap-tabs', { timeout: 10000 });
  await page.locator('.eqmap-pane button:has-text("Place it on the map")').click();
  await page.waitForSelector('.eqmap-placing', { timeout: 10000 });
  ok(true, 'placement mode can be entered');
  const box = await page.locator('.eqmap-canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1800);
  ok((await page.locator('.eqmap-unplaced').count()) === 0, 'placing it clears the unplaced list');
  ok((await page.locator('.asset-pin').count()) === 3, `and it appears on the map (${await page.locator('.asset-pin').count()})`);

  await page.screenshot({ path: (process.env.MM_SHOTS || '/tmp') + '/equipment-map.png', fullPage: true });

  ok(errs.length === 0, `no console errors (${errs.slice(0, 2).join(' | ') || 'none'})`);
  await br.close();
  console.log(fail === 0 ? '\nAll ui-assetmap checks passed.' : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
