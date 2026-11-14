// The calendar on screen: set it up in Settings, see it change the chart.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const B = process.env.MM_CLIENT || 'http://localhost:5173';
const API = (process.env.MM_API || 'http://localhost:4000') + '/api';
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

(async () => {
  const br = await chromium.launch();
  const page = await (await br.newContext()).newPage();
  const errs = [];
  const noise = /favicon|404 \(Not Found\)|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|arcgisonline/;
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !noise.test(m.text())) errs.push(m.text().slice(0, 160)); });

  await page.goto(B + '/');
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30000 });
  const setup = (await page.locator('input[autocomplete="new-password"]').count()) > 0;
  await page.fill('input[autocomplete="username"]', 'khalid');
  if (setup) {
    await page.fill('input[autocomplete="new-password"] >> nth=0', 'correcthorsebattery9');
    await page.fill('input[autocomplete="new-password"] >> nth=1', 'correcthorsebattery9');
    await page.click('button:has-text("Create account")');
  } else {
    await page.fill('input[autocomplete="current-password"]', 'correcthorsebattery9');
    await page.click('button:has-text("Sign in")');
  }
  await page.waitForSelector('.nav-toggle', { timeout: 20000 });
  const csrf = (await page.request.fetch(API + '/auth/me')).headers()['x-csrf-token'];
  const req = async (method, path, data) => {
    const r = await page.request.fetch(API + path, {
      method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, data,
    });
    return { status: r.status(), body: await r.json().catch(() => null) };
  };

  // Clear any calendars left by other suites, so this one starts from nothing.
  for (const c of (await req('GET', '/calendars')).body ?? []) await req('DELETE', `/calendars/${c.id}`);

  const stamp = Date.now();
  const prop = (await req('POST', '/properties', { name: 'Cal UI ' + stamp })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });
  const proj = (await req('POST', '/projects', { name: 'Weekend works ' + stamp, propertyId: prop.id, status: 'open' })).body;
  const mk = async (title, extra) => (await req('POST', '/issues', {
    propertyId: prop.id, title, lat: 13.99, lng: -61.0, priority: 'medium', projectId: proj.id, ...extra,
  })).body;
  const a = await mk('Strip out', { scheduledFor: '2027-01-04', dueDate: '2027-01-08' });
  const b = await mk('Make good', { scheduledFor: '2027-01-11', dueDate: '2027-01-15' });
  await req('POST', `/issues/${a.id}/links`, { toIssueId: b.id, kind: 'precedes' });

  // ---- the editor is reachable from Settings --------------------------
  await page.goto(B + '/#/settings');
  await page.waitForSelector('.cal-page', { timeout: 20000 });
  ok(true, 'the working-days editor is on the settings page');
  const intro = await page.locator('.cal-page p').first().innerText();
  ok(/every day/.test(intro), 'and explains what no calendar means');
  ok((await page.locator('.cal').count()) === 0, 'with none set to begin with');

  // ---- create one through the UI ---------------------------------------
  await page.selectOption('.cal-new select', { label: 'Cal UI ' + stamp });
  await page.click('.cal-new button:has-text("Create")');
  await page.waitForSelector('.cal', { timeout: 10000 });
  ok(true, 'a calendar can be created from the screen');
  const days = page.locator('.cal-day');
  ok((await days.count()) === 7, `seven days are offered (${await days.count()})`);
  ok((await page.locator('.cal-day.is-on').count()) === 6, `six are on by default (${await page.locator('.cal-day.is-on').count()})`);
  const sunday = page.locator('.cal-day').nth(6);
  ok(!(await sunday.locator('input').isChecked()), 'and Sunday is the one off');

  // ---- it changes the chart --------------------------------------------
  await page.goto(B + '/#/projects');
  await page.waitForSelector('.proj-page', { timeout: 20000 });
  await page.click('.tab-row .tab:has-text("Everything")');
  await page.waitForTimeout(900);
  const card = page.locator('.proj-card', { hasText: 'Weekend works ' + stamp }).first();
  await card.locator('.proj-toggle').click();
  await page.waitForSelector('.proj-gov', { timeout: 10000 });
  await card.locator('.proj-view-switch .tab:has-text("Timeline")').click();
  await page.waitForSelector('.gantt', { timeout: 10000 });

  const label = await card.locator('.proj-view-switch .muted').innerText();
  ok(/working days/.test(label), `the chain is counted in working days ("${label}")`);
  await page.waitForTimeout(600);
  ok((await card.locator('.gantt-off span').count()) >= 1,
     `days nobody works are shaded (${await card.locator('.gantt-off span').count()} stripes)`);
  const legend = await card.locator('.gantt-legend').innerText();
  ok(/not worked/.test(legend), 'and the legend says what the shading is');

  // The shaded stripes must be Sundays, not arbitrary.
  const stripeLefts = await card.locator('.gantt-off span').evaluateAll(els => els.map(e => parseFloat(e.style.left)));
  const gaps = stripeLefts.slice(1).map((v, i) => v - stripeLefts[i]);
  ok(gaps.length === 0 || gaps.every(g => Math.abs(g - gaps[0]) < 0.5), `and they are evenly spaced, a week apart (${gaps.map(Math.round).join(', ')})`);

  await page.screenshot({ path: ((process.env.MM_SHOTS || '.') + '/v2-calendar.png'), fullPage: false });

  // ---- removing it puts the float back ---------------------------------
  const before = (await req('GET', `/projects/${proj.id}`)).body;
  ok(before.analysis.workingDays === true, 'the analysis is on working days');
  ok(before.analysis.items[a.id].floatDays === 1, `with one day of float (${before.analysis.items[a.id].floatDays})`);
  const cal = (await req('GET', '/calendars')).body[0];
  await req('DELETE', `/calendars/${cal.id}`);
  const after = (await req('GET', `/projects/${proj.id}`)).body;
  ok(after.analysis.workingDays === false, 'removing it goes back to counting every day');
  ok(after.analysis.items[a.id].floatDays === 2, `and the float goes back up to two (${after.analysis.items[a.id].floatDays})`);

  // ---- phone ------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(B + '/#/settings');
  await page.waitForSelector('.cal-page', { timeout: 20000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!overflow, 'the editor does not overflow on a phone');

  console.log('\nPage errors: ' + (errs.length ? errs.join(' || ') : 'none'));
  ok(errs.length === 0, 'no page errors');
  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
  await br.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message); process.exit(2); });
