// Slice 3 on screen: enter a round, see it convert, see it add up.
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
  const [cname, cvalue] = cookie.split('=');
  await ctx.addCookies([{ name: cname, value: cvalue, domain: 'localhost', path: '/' }]);
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
  const prop = (await req('POST', '/properties', { name: 'ZZ Utility UI ' + stamp })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });
  const main = (await req('POST', '/utilities/meters', {
    propertyId: prop.id, name: 'Main meter', kind: 'electricity', entryMode: 'direct', unit: 'kWh',
  })).body;
  const propane = (await req('POST', '/utilities/meters', {
    propertyId: prop.id, name: 'Propane bulk 1', kind: 'propane', entryMode: 'percentage',
    unit: 'litre', capacityLitres: 4000,
  })).body;

  // ---- reachable from the menu -----------------------------------------
  await page.click('.nav-toggle');
  await page.waitForTimeout(400);
  const link = page.locator('.app-nav a:has-text("Utilities")');
  ok((await link.count()) > 0, 'Utilities is in the menu');
  await link.first().click();
  await page.waitForSelector('.util-page', { timeout: 20000 });
  ok(true, 'and the page opens from it');

  // The 05:00 day rule is stated, because nobody guesses it.
  const intro = await page.locator('.page-header p').first().innerText();
  ok(/05:00/.test(intro) && /day before/.test(intro), `the day boundary is spelled out ("${intro.slice(0, 70)}…")`);

  // ---- choose the property and find the round ---------------------------
  await page.selectOption('.page-header-actions select', { label: 'ZZ Utility UI ' + stamp });
  await page.waitForTimeout(1200);
  const rows = page.locator('.util-row');
  ok((await rows.count()) === 2, `both meters are on the round (${await rows.count()})`);
  const slots = page.locator('.util-slot');
  ok((await slots.count()) === 4, `each with two rounds (${await slots.count()})`);

  // The input must not make a phone zoom.
  const fs = await slots.first().locator('input').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  ok(fs >= 16, `the boxes do not zoom a phone on focus (${fs}px)`);

  // ---- enter the electricity round --------------------------------------
  const mainRow = page.locator('.util-row', { hasText: 'Main meter' }).first();
  await mainRow.locator('input').nth(1).fill('1000'); // 05:00
  await mainRow.locator('input').nth(1).blur();
  await page.waitForTimeout(1500);
  const saved = (await req('GET', `/utilities/readings?propertyId=${prop.id}`)).body;
  const mainReadings = saved.rows.find(r => r.meter.id === main.id).readings;
  ok(!!mainReadings['0500'] && mainReadings['0500'].rawValue === 1000,
     `typing a reading saves it (${mainReadings['0500']?.rawValue})`);

  // ---- a tank shows its conversion beside what was typed ----------------
  const tankRow = page.locator('.util-row', { hasText: 'Propane' }).first();
  await tankRow.locator('input').nth(1).fill('47');
  await tankRow.locator('input').nth(1).blur();
  await page.waitForTimeout(1600);
  const converted = await tankRow.locator('.util-converted').first().innerText();
  ok(/1,?880/.test(converted), `47 per cent is shown as 1,880 litres beside it ("${converted}")`);

  const tankSaved = (await req('GET', `/utilities/readings?propertyId=${prop.id}`)).body
    .rows.find(r => r.meter.id === propane.id).readings['0500'];
  ok(tankSaved.rawValue === 47 && tankSaved.value === 1880, 'with both the raw and converted figures kept');

  // ---- a week of readings, then the nutshell ---------------------------
  // Dates relative to today, because a reading in the future is correctly
  // excluded from the summary — and a hardcoded fixture quietly becomes one.
  const ago = (n) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const series = [
    [ago(5), '0500', 1000], [ago(5), '0200', 1090],
    [ago(4), '0500', 1100], [ago(4), '0200', 1185],
    [ago(3), '0500', 1200], [ago(3), '0200', 1290],
    [ago(2), '0500', 1300],
  ];
  for (const [d, slot, raw] of series) {
    await req('POST', '/utilities/readings', { meterPointId: main.id, slot, rawValue: raw, readingDay: d });
  }
  await page.reload();
  await page.waitForSelector('.util-page', { timeout: 20000 });
  await page.selectOption('.page-header-actions select', { label: 'ZZ Utility UI ' + stamp });
  await page.waitForTimeout(1600);

  const cards = page.locator('.util-card');
  ok((await cards.count()) >= 1, `the nutshell shows a card per utility (${await cards.count()})`);
  const elecCard = page.locator('.util-card', { hasText: 'Electricity' }).first();
  const figures = await elecCard.locator('.util-figures').innerText();
  ok(/WEEK|Week/i.test(figures) && /MONTH|Month/i.test(figures) && /YEAR|Year/i.test(figures),
     'with week, month and year to date');

  // The chart draws, and draws a line rather than nothing.
  const charts = page.locator('.util-chart');
  ok((await charts.count()) >= 1, `a chart per meter with history (${await charts.count()})`);
  const svgs = charts.first().locator('svg');
  ok((await svgs.count()) === 2, `used per day and overnight separately (${await svgs.count()})`);
  const pathLen = await svgs.first().locator('polyline, path').first().evaluate(el => el.getAttribute('points')?.length ?? el.getAttribute('d')?.length ?? 0);
  ok(pathLen > 10, `with a real line on it (${pathLen} chars of geometry)`);

  // ---- an invoice, and the cost per unit it implies ---------------------
  // Two consecutive months ending before today, so both are real periods.
  const monthStart = (back) => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - back);
    return d.toISOString().slice(0, 10);
  };
  const monthEnd = (back) => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - back + 1);
    d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
  };
  await req('POST', '/utilities/invoices', {
    propertyId: prop.id, kind: 'electricity', periodStart: monthStart(3), periodEnd: monthEnd(3),
    amount: 120000, quantity: 300000, unit: 'kWh',
  });
  await req('POST', '/utilities/invoices', {
    propertyId: prop.id, kind: 'electricity', periodStart: monthStart(2), periodEnd: monthEnd(2),
    amount: 156000, quantity: 300000, unit: 'kWh',
  });
  await page.reload();
  await page.waitForSelector('.util-page', { timeout: 20000 });
  await page.selectOption('.page-header-actions select', { label: 'ZZ Utility UI ' + stamp });
  await page.waitForTimeout(1600);

  const invoiceList = await page.locator('.util-invoice-list').innerText();
  ok(/0\.52/.test(invoiceList), `cost per unit is shown, derived from the bill ("${invoiceList.match(/0\.\d+/g)?.join(', ')}")`);
  ok(/\+30%/.test(invoiceList), 'and the thirty per cent rise is computed rather than claimed');
  const card = await elecCard.innerText();
  ok(/per kWh/.test(card), 'the nutshell card carries the unit cost too');

  await page.screenshot({ path: ((process.env.MM_SHOTS || '.') + '/v2-utilities.png'), fullPage: false });

  // ---- phone --------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!overflow, 'the page does not overflow sideways on a phone');
  await page.screenshot({ path: ((process.env.MM_SHOTS || '.') + '/v2-utilities-mobile.png'), fullPage: false });

  console.log('\nPage errors: ' + (errs.length ? errs.join(' || ') : 'none'));
  ok(errs.length === 0, 'no page errors');
  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
  await br.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message); process.exit(2); });
