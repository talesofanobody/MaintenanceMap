// A reading on the walk itself: typed by a thumb, flagging the line by itself.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const B = process.env.MM_CLIENT || 'http://localhost:5173';
const API = (process.env.MM_API || 'http://localhost:4000') + '/api';
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

(async () => {
  const br = await chromium.launch();
  // A phone, because this is the screen that is used on one.
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  const noise = /favicon|404 \(Not Found\)|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|arcgisonline/;
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !noise.test(m.text())) errs.push(m.text().slice(0, 160)); });

  const { session } = require('./session');
  const { cookie } = await session();
  const [name, value] = cookie.split('=');
  await ctx.addCookies([{ name, value, domain: 'localhost', path: '/' }]);
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
  const prop = (await req('POST', '/properties', { name: 'Reading UI ' + stamp })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });
  const templates = (await req('GET', `/inspections/templates?propertyId=${prop.id}`)).body;
  const guest = templates.find(t => t.name === 'Guest room');
  const walk = (await req('POST', '/inspections', { propertyId: prop.id, roomName: 'Room 214', templateId: guest.id })).body;

  await page.goto(`${B}/#/inspections/${walk.id}`);
  await page.waitForSelector('.insp-row', { timeout: 20000 });
  ok(true, 'the walk opens');

  // ---- the measurement line has an input -------------------------------
  const readings = page.locator('.insp-reading');
  const n = await readings.count();
  ok(n >= 4, `the measurement lines have a reading box (${n})`);

  // Find the hot water one and read its stated range.
  const hotLine = page.locator('.insp-reading').filter({ has: page.locator('input[aria-label*="Hot water"]') }).first();
  ok((await hotLine.count()) > 0, 'including the hot water outlet temperature');
  const rangeText = await hotLine.locator('label span.muted').innerText();
  ok(/50/.test(rangeText) && /above/.test(rangeText), `with its range spelled out ("${rangeText}")`);
  const unitText = await hotLine.locator('em').innerText();
  ok(unitText === '°C', `and its unit beside the box (${unitText})`);

  // ---- typing a bad number flags the line, with no extra tap -----------
  const input = hotLine.locator('input');
  // A 16px font keeps iOS from zooming the page when the box is focused.
  const fontSize = await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  ok(fontSize >= 16, `the box does not make a phone zoom on focus (${fontSize}px)`);

  await input.fill('48');
  await input.blur();
  await page.waitForTimeout(1500);
  const verdict = await hotLine.locator('.insp-reading-verdict').innerText();
  ok(/below 50/.test(verdict), `48 is called out as below the minimum ("${verdict}")`);

  const check = (await req('GET', `/inspections/${walk.id}`)).body.checks.find(c => c.label === 'Hot water outlet temperature');
  ok(check.value === 48, `the reading is saved (${check.value})`);
  ok(check.outcome === 'flagged', `and the line flagged itself (${check.outcome})`);

  // The outcome buttons should show it as flagged, without anybody pressing one.
  const row = page.locator('.insp-row').filter({ hasText: 'Hot water outlet temperature' }).first();
  const pressed = await row.locator('.insp-outcome.selected').first().innerText();
  ok(/flag/i.test(pressed), `the flag button shows as chosen ("${pressed}")`);

  // ---- a good reading clears it ----------------------------------------
  await input.fill('55');
  await input.blur();
  await page.waitForTimeout(1500);
  const okVerdict = await hotLine.locator('.insp-reading-verdict').innerText();
  ok(/within range/.test(okVerdict), `55 reads as within range ("${okVerdict}")`);
  const check2 = (await req('GET', `/inspections/${walk.id}`)).body.checks.find(c => c.label === 'Hot water outlet temperature');
  ok(check2.outcome === 'ok', `and the line goes back to fine (${check2.outcome})`);

  // ---- a banded reading, both ends --------------------------------------
  const chl = page.locator('.insp-reading').filter({ has: page.locator('input[aria-label*="Free chlorine"]') }).first();
  const band = await chl.locator('label span.muted').innerText();
  ok(/1–3/.test(band), `the chlorine band is shown as a range ("${band}")`);
  await chl.locator('input').fill('5.2');
  await chl.locator('input').blur();
  await page.waitForTimeout(1500);
  ok(/above 3/.test(await chl.locator('.insp-reading-verdict').innerText()), 'over the top of the band says above');
  await chl.locator('input').fill('0.4');
  await chl.locator('input').blur();
  await page.waitForTimeout(1500);
  ok(/below 1/.test(await chl.locator('.insp-reading-verdict').innerText()), 'and under the bottom says below');

  // ---- a judgement line has no reading box ------------------------------
  const plainRow = page.locator('.insp-row').filter({ hasText: 'WC flush and cistern' }).first();
  ok((await plainRow.locator('.insp-reading').count()) === 0, 'a judgement line is left alone, with no box on it');

  // ---- the phone does not overflow ---------------------------------------
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!overflow, 'the walk does not overflow sideways on a phone');
  await page.screenshot({ path: ((process.env.MM_SHOTS || '.') + '/v2-readings.png'), fullPage: false });

  console.log('\nPage errors: ' + (errs.length ? errs.join(' || ') : 'none'));
  ok(errs.length === 0, 'no page errors');
  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
  await br.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message); process.exit(2); });
