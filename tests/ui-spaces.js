// Slice 4 on screen: build a tree from a range, and reconcile the free text.
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

  const stamp = Date.now();
  const prop = (await req('POST', '/properties', { name: 'ZZZ Places ' + stamp })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });
  // Some history with free text, so there is something to reconcile.
  await req('POST', '/issues', { propertyId: prop.id, title: 'Mould', lat: 13.99, lng: -61, priority: 'medium', roomName: 'Room 101' });
  await req('POST', '/issues', { propertyId: prop.id, title: 'Tap', lat: 13.99, lng: -61, priority: 'low', roomName: 'Room 101' });
  await req('POST', '/issues', { propertyId: prop.id, title: 'Light', lat: 13.99, lng: -61, priority: 'low', roomName: 'Pool deck' });

  // ---- reachable from the menu -----------------------------------------
  await page.click('.nav-toggle');
  await page.waitForTimeout(400);
  const link = page.locator('.app-nav a:has-text("Places")');
  ok((await link.count()) > 0, 'Places is in the menu');
  await link.first().click();
  await page.waitForSelector('.places-page', { timeout: 20000 });
  await page.selectOption('.page-header-actions select', { label: 'ZZZ Places ' + stamp });
  await page.waitForTimeout(1200);
  ok(true, 'the page opens and the property can be chosen');

  // The promise that nothing is rewritten is stated.
  const intro = await page.locator('.page-header p').first().innerText();
  ok(/nothing is rewritten/.test(intro), `the page says the text is kept ("${intro.slice(-40)}")`);

  // ---- build a block, a floor, then forty rooms from a range -----------
  await page.click('.places-tree button:has-text("Add a block")');
  await page.fill('.places-add input', 'Coubaril');
  await page.click('.places-add button:has-text("Add")');
  await page.waitForTimeout(1300);
  ok((await page.locator('.space-row.kind-block').count()) === 1, 'a block appears in the tree');

  await page.click('.space-row button:has-text("Add inside")');
  await page.fill('.places-add input', 'Floor 1');
  await page.selectOption('.places-add select', 'floor');
  await page.click('.places-add button:has-text("Add")');
  await page.waitForTimeout(1300);
  ok((await page.locator('.space-row.kind-floor').count()) === 1, 'and a floor under it');

  // The range: the thing that makes 340 rooms possible.
  const floorRow = page.locator('.space-row.kind-floor').first();
  await floorRow.locator('button:has-text("Add inside")').click();
  await page.fill('.places-add input', '101-140');
  await page.locator('.places-check input').check();
  await page.click('.places-add button:has-text("Add")');
  await page.waitForTimeout(2500);
  const noteText = await page.locator('.banner-ok').innerText().catch(() => '');
  ok(/Added 40/.test(noteText), `forty rooms from one spec ("${noteText}")`);
  ok((await page.locator('.space-row').count()) === 42, `the tree now has 42 rows (${await page.locator('.space-row').count()})`);

  // ---- collapsing keeps it readable ------------------------------------
  await floorRow.locator('.space-caret').click();
  await page.waitForTimeout(400);
  ok((await page.locator('.space-row').count()) === 2, `collapsing the floor hides its rooms (${await page.locator('.space-row').count()})`);
  await floorRow.locator('.space-caret').click();
  await page.waitForTimeout(400);

  // ---- the sell-status round -------------------------------------------
  const chips = await page.locator('.places-sell').innerText();
  ok(/40 sellable|40 not looked at/.test(chips.replace(/\n/g, ' ')), `the round counts the rooms ("${chips.replace(/\n/g, ' ')}")`);
  ok(/not looked at/.test(chips), 'and keeps unlooked-at separate from sellable');

  const room = page.locator('.space-row', { hasText: '101' }).first();
  await room.locator('.space-sell').selectOption('red');
  await page.waitForTimeout(1300);
  const after = await page.locator('.places-sell').innerText();
  ok(/1 out of order/.test(after.replace(/\n/g, ' ')), `marking one out of order shows in the round ("${after.replace(/\n/g, ' ').slice(0, 70)}")`);

  // ---- reconciling the free text ---------------------------------------
  await page.reload();
  await page.waitForSelector('.places-page', { timeout: 20000 });
  await page.selectOption('.page-header-actions select', { label: 'ZZZ Places ' + stamp });
  await page.waitForTimeout(1400);

  const recHead = await page.locator('.places-reconcile').innerText();
  ok(/not yet matched/.test(recHead), 'the unmatched names are surfaced');
  ok(/unambiguous/.test(recHead), `with how many are certain ("${recHead.split('\n').find(l => /unambiguous/.test(l))}")`);

  await page.click('.places-reconcile button:has-text("Show them")');
  await page.waitForTimeout(500);
  const rows = page.locator('.rec-list li');
  ok((await rows.count()) === 2, `two distinct names to match (${await rows.count()})`);
  const first = await rows.first().innerText();
  ok(/Room 101/.test(first) && /2 jobs/.test(first), `the busiest name is first, with its count ("${first.replace(/\n/g, ' ')}")`);

  // Apply the certain ones.
  await page.click('.places-reconcile button:has-text("Match the")');
  await page.waitForTimeout(2000);
  const done = await page.locator('.banner-ok').innerText().catch(() => '');
  ok(/Matched 1 name/.test(done), `the unambiguous one is applied ("${done}")`);
  ok(/2 jobs/.test(done), 'covering both rows that used it');
  ok(/left for a person/.test(done), 'and says what is left');

  // The job points at the space but keeps what was typed.
  const issues = (await req('GET', `/issues?propertyId=${prop.id}`)).body.items;
  const mould = issues.find(i => i.title === 'Mould');
  ok(mould.spaceId !== null, 'the job now points at a space');
  ok(mould.roomName === 'Room 101', 'and still carries the text somebody typed');
  const pool = issues.find(i => i.title === 'Light');
  ok(pool.spaceId === null, '"Pool deck" has nothing in the tree, so it stays unmatched');

  await page.screenshot({ path: ((process.env.MM_SHOTS || '.') + '/v2-places.png'), fullPage: false });

  // ---- phone -------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!overflow, 'the tree does not overflow sideways on a phone');

  console.log('\nPage errors: ' + (errs.length ? errs.join(' || ') : 'none'));
  ok(errs.length === 0, 'no page errors');
  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
  await br.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message); process.exit(2); });
