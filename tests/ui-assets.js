// Slice 5 on screen: the register, the blast radius, and tracing a room.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const B = process.env.MM_CLIENT || 'http://localhost:5173';
const API = (process.env.MM_API || 'http://localhost:4000') + '/api';
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext();
  const page = await ctx.newPage();
  const errs = [];
  const noise = /favicon|404 \(Not Found\)|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|arcgisonline/;
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

  // ---- a site with a riser, two breakers and four rooms ----------------
  const stamp = Date.now();
  const name = 'ZZZ Plant ' + stamp;
  const prop = (await req('POST', '/properties', { name })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });

  const mkSpaces = async (body) => (await req('POST', '/spaces', { propertyId: prop.id, ...body })).body;
  const block = (await mkSpaces({ name: 'Coubaril', kind: 'block' })).spaces.find(s => s.name === 'Coubaril');
  const floor = (await mkSpaces({ parentId: block.id, name: 'Floor 1', kind: 'floor' })).spaces.find(s => s.name === 'Floor 1');
  const roomRows = await mkSpaces({ parentId: floor.id, names: '101-104', sellable: true });
  const rooms = ['101', '102', '103', '104'].map(n => roomRows.spaces.find(s => s.name === n && s.parentId === floor.id));

  const mk = async (body) => (await req('POST', '/assets', { propertyId: prop.id, ...body })).body.asset;
  const gen = await mk({ name: 'GEN-1', kind: 'generator', ref: 'GEN-1', rating: '250 kVA' });
  const dbmain = await mk({ name: 'Main board', kind: 'panel', ref: 'DB-MAIN', spaceId: block.id });
  const db3 = await mk({ name: 'Riser board', kind: 'panel', ref: 'DB-3', parentId: dbmain.id, spaceId: floor.id });
  const cb14 = await mk({ name: 'Rooms 101-102', kind: 'breaker', ref: 'CB-14', parentId: db3.id });
  const cb15 = await mk({ name: 'Room 103', kind: 'breaker', ref: 'CB-15', parentId: db3.id });
  // One unit well past its interval, so the overdue banner has something to say.
  await mk({ name: 'Lobby AHU', kind: 'ahu', ref: 'AHU-1', serviceIntervalDays: 90, lastServicedAt: '2026-02-01' });

  const rel = async (from, body) => await req('POST', `/assets/${from}/relations`, body);
  await rel(gen.id, { kind: 'feeds', toAssetId: dbmain.id });
  await rel(dbmain.id, { kind: 'feeds', toAssetId: db3.id });
  await rel(db3.id, { kind: 'feeds', toAssetId: cb14.id });
  await rel(db3.id, { kind: 'feeds', toAssetId: cb15.id });
  await rel(cb14.id, { kind: 'feeds', toSpaceId: rooms[0].id });
  await rel(cb14.id, { kind: 'feeds', toSpaceId: rooms[1].id });
  await rel(cb15.id, { kind: 'feeds', toSpaceId: rooms[2].id });
  await rel(cb14.id, { kind: 'isolates', toSpaceId: rooms[0].id });
  await rel(dbmain.id, { kind: 'isolates', toSpaceId: rooms[0].id });

  // ---- reachable from the menu ----------------------------------------
  await page.click('.nav-toggle');
  await page.waitForTimeout(400);
  // Exact text: "Equipment map" is now also in the menu, and a substring match
  // picks whichever comes first.
  const link = page.locator('.app-nav a:text-is("Equipment")');
  ok((await link.count()) > 0, 'Equipment is in the menu');
  await link.first().click();
  await page.waitForSelector('.equipment-page', { timeout: 20000 });
  await page.selectOption('.page-header-actions select', { label: name });
  await page.waitForTimeout(1200);
  ok(true, 'the page opens and the property can be chosen');

  // ---- the register ---------------------------------------------------
  const items = page.locator('.eq-item');
  ok((await items.count()) === 6, `six items listed (${await items.count()})`);
  const text = await page.locator('.eq-list').innerText();
  ok(text.includes('Distribution panel') && text.includes('Breaker'), 'grouped by kind');
  ok(text.includes('DB-3 — Riser board'), 'the reference people say is shown with the name');
  ok(text.includes('Coubaril · Floor 1'), 'and where it sits, as a path');

  // The overdue banner is the whole point of the interval living on the equipment.
  const banner = page.locator('.eq-due-banner');
  ok((await banner.count()) === 1, 'the out-of-date banner is shown');
  ok((await banner.innerText()).toLowerCase().includes('overdue'), 'and says what is overdue');

  // ---- the question this screen exists to answer ----------------------
  await page.locator('.eq-item-btn:has-text("CB-14")').first().click();
  await page.waitForSelector('.eq-blast', { timeout: 15000 });
  let blast = await page.locator('.eq-blast').innerText();
  ok(/2\s+spaces affected/.test(blast), `a breaker reports two spaces (${blast.split('\n')[1] || ''})`);
  ok(blast.includes('sellable'), 'and how many of them are sellable');
  ok(blast.includes('101') && blast.includes('102'), 'naming the rooms');
  ok(!blast.includes('103'), 'and not the room on the other breaker');

  const fedBy = await page.locator('.eq-fedby').innerText();
  ok(fedBy.includes('GEN-1') && fedBy.includes('DB-3'), 'the chain above it is listed');

  // The board further up takes out more, which is the comparison that matters.
  await page.locator('.eq-item-btn:has-text("DB-MAIN")').first().click();
  await page.waitForTimeout(900);
  blast = await page.locator('.eq-blast').innerText();
  ok(/3\s+spaces affected/.test(blast), `the main board reports three (${blast.split('\n')[1] || ''})`);
  ok(blast.includes('through 3 other item') || blast.includes('through 3 other items'),
    'and says how many boards it goes through');

  // ---- relations can be read and recorded on screen -------------------
  const relText = await page.locator('.eq-relations').innerText();
  ok(relText.includes('feeds') && relText.includes('isolates'), 'both relation kinds are shown');
  ok(relText.includes('Riser board'), 'with what they point at');

  // ---- trace a room ---------------------------------------------------
  await page.selectOption('.eq-trace-controls select', { label: 'Coubaril · Floor 1 · 101' });
  await page.waitForSelector('.eq-trace-result', { timeout: 15000 });
  const traceText = await page.locator('.eq-trace-result').innerText();
  ok(traceText.includes('CB-14'), 'the trace names the breaker that feeds the room');
  ok(traceText.includes('GEN-1'), 'and follows the chain to the generator');
  const isolateCol = await page.locator('.eq-trace-result > div').nth(1).innerText();
  const cb14At = isolateCol.indexOf('CB-14');
  const mainAt = isolateCol.indexOf('DB-MAIN');
  ok(cb14At > -1 && mainAt > -1 && cb14At < mainAt,
    'and the isolation list puts the breaker before the board that drops the block');

  // ---- logging work ---------------------------------------------------
  await page.locator('.eq-item-btn:has-text("AHU-1")').first().click();
  await page.waitForTimeout(900);
  ok((await page.locator('.eq-detail').innerText()).includes('Overdue'), 'the lapsed unit reads as overdue');
  await page.locator('.eq-services button:has-text("Log work")').click();
  await page.waitForSelector('.eq-svc-form', { timeout: 10000 });
  await page.fill('.eq-svc-form textarea', 'Coils washed, filters changed.');
  await page.locator('.eq-add-actions button:has-text("Log it")').click();
  await page.waitForTimeout(1600);
  const afterText = await page.locator('.eq-detail').innerText();
  ok(afterText.includes('Coils washed'), 'the service appears in the history');
  ok(afterText.includes('In date'), 'and the unit is in date afterwards');

  // ---- filters --------------------------------------------------------
  await page.selectOption('.eq-filters select', { label: 'Breaker' });
  await page.waitForTimeout(600);
  ok((await page.locator('.eq-item').count()) === 2, `filtering by kind leaves two (${await page.locator('.eq-item').count()})`);
  await page.selectOption('.eq-filters select', { label: 'Every kind' });
  await page.fill('.eq-filters input', 'CB-15');
  await page.waitForTimeout(600);
  ok((await page.locator('.eq-item').count()) === 1, 'and searching a reference leaves one');

  await page.screenshot({ path: (process.env.MM_SHOTS || '/tmp') + '/equipment.png', fullPage: true });

  ok(errs.length === 0, `no console errors (${errs.slice(0, 2).join(' | ') || 'none'})`);
  await br.close();
  console.log(fail === 0 ? '\nAll ui-assets checks passed.' : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
