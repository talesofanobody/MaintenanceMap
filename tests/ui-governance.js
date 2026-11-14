// Slice 1b on screen: the Gantt, blockers, stakeholders, project dependencies.
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

  // ---- build a plan worth drawing ------------------------------------
  const stamp = Date.now();
  const prop = (await req('POST', '/properties', { name: 'Gantt fixture ' + stamp })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });
  const tech = (await req('POST', '/technicians', { name: 'Darren G' + stamp, trade: 'hvac' })).body;
  const other = (await req('POST', '/projects', { name: 'Baseline survey ' + stamp, propertyId: prop.id })).body;
  const proj = (await req('POST', '/projects', {
    name: 'Candyshack ' + stamp, propertyId: prop.id, ownerId: tech.id,
    plannedStart: '2027-01-04', plannedEnd: '2027-02-26', status: 'open',
  })).body;

  const mk = async (title, extra) => (await req('POST', '/issues', {
    propertyId: prop.id, title, lat: 13.99, lng: -61.0, priority: 'medium', projectId: proj.id, ...extra,
  })).body;

  const phase = await mk('Phase 1 — Coubaril', { scheduledFor: '2027-01-04', dueDate: '2027-02-05' });
  const fog = await mk('Fog rooms 101-110', { scheduledFor: '2027-01-04', dueDate: '2027-01-08' });
  const paint = await mk('Repaint rooms 101-110', { scheduledFor: '2027-01-11', dueDate: '2027-01-22' });
  const ms = await mk('Chemicals delivered', { scheduledFor: '2026-12-21', dueDate: '2026-12-21' });
  await req('PUT', `/issues/${fog.id}`, { parentId: phase.id });
  await req('PUT', `/issues/${paint.id}`, { parentId: phase.id });
  await req('PUT', `/issues/${ms.id}`, { isMilestone: true, baselineDue: '2026-12-14' });
  await req('POST', `/issues/${fog.id}/links`, { toIssueId: paint.id, kind: 'precedes', lagDays: 1 });
  await req('POST', `/projects/${proj.id}/baseline`);
  // Move one job after baselining, so the agreed bar and the current one differ.
  await req('PUT', `/issues/${paint.id}`, { scheduledFor: '2027-01-18', dueDate: '2027-01-29' });
  // Something in the way, and somebody involved.
  await req('POST', '/blockers', { issueId: fog.id, kind: 'parts', summary: 'No fogging machine on site', ownerId: tech.id });
  await req('POST', '/blockers', { projectId: proj.id, kind: 'approval', summary: 'Spend not approved', ownerName: 'Fred' });
  await req('POST', `/projects/${proj.id}/stakeholders`, { technicianId: tech.id, role: 'accountable' });
  await req('POST', `/projects/${proj.id}/stakeholders`, { name: 'Fred', organisation: 'Head office', role: 'sponsor' });
  await req('POST', `/projects/${other.id}/links`, { toProjectId: proj.id, kind: 'precedes' });

  // ---- open it --------------------------------------------------------
  await page.goto(B + '/#/projects');
  await page.waitForSelector('.proj-page', { timeout: 20000 });
  await page.click('.tab-row .tab:has-text("Everything")');
  await page.waitForTimeout(900);
  const card = page.locator('.proj-card', { hasText: 'Candyshack ' + stamp }).first();
  ok((await card.count()) > 0, 'the project is listed');

  // Blocked count visible without expanding.
  const meta = await card.locator('.proj-meta').innerText();
  ok(/2 blocked/.test(meta), `the blocked count shows on the closed card ("${meta.replace(/\n/g, ' ')}")`);

  await card.locator('.proj-toggle').click();
  await page.waitForSelector('.proj-gov', { timeout: 10000 });

  // ---- blockers -------------------------------------------------------
  const openBlockers = card.locator('.blocker.is-open');
  ok((await openBlockers.count()) === 2, `both blockers are listed (${await openBlockers.count()})`);
  const bText = await openBlockers.first().innerText();
  ok(/parts|approval/i.test(bText), `with their kind ("${bText.split('\n')[0]}")`);
  ok(/machine|approved/i.test(await card.locator('.blocker-list').innerText()), 'and what is actually in the way');
  const chip = await card.locator('.proj-gov-block', { hasText: 'In the way' }).locator('.chip').first().innerText();
  ok(/2 open/.test(chip), `the chip counts them ("${chip}")`);

  // Clearing one, through the UI.
  page.once('dialog', d => d.accept('Hired one from Castries'));
  await card.locator('.blocker.is-open button:has-text("Cleared")').first().click();
  await page.waitForTimeout(1500);
  ok((await card.locator('.blocker.is-open').count()) === 1, 'clearing one leaves the other');
  ok((await card.locator('.blocker-more').count()) === 1, 'and the cleared one is still kept, not deleted');

  // ---- stakeholders ---------------------------------------------------
  const stakes = card.locator('.stake');
  ok((await stakes.count()) === 2, `two stakeholders (${await stakes.count()})`);
  const sText = await card.locator('.stake-list').innerText();
  ok(/Fred/.test(sText) && /Head office/.test(sText), 'including one who will never have a login');
  ok((await card.locator('.stake select').count()) === 2, 'each with its role editable in place');

  // ---- project dependency ---------------------------------------------
  const deps = await card.locator('.dep-list').innerText();
  ok(/Baseline survey/.test(deps), `the project it waits on is shown ("${deps.replace(/\n/g, ' ')}")`);
  ok(/after/i.test(deps), 'and in which direction');

  // ---- the Gantt ------------------------------------------------------
  await card.locator('.proj-view-switch .tab:has-text("Timeline")').click();
  await page.waitForSelector('.gantt', { timeout: 10000 });
  ok(true, 'the timeline opens');

  const bars = card.locator('.gantt-bar');
  ok((await bars.count()) >= 3, `bars are drawn (${await bars.count()})`);
  // A bar must have real width, not collapse to nothing.
  const widths = [];
  for (let i = 0; i < await bars.count(); i++) widths.push(await bars.nth(i).evaluate(el => el.getBoundingClientRect().width));
  ok(widths.every(w => w > 2), `each bar has width (${widths.map(w => Math.round(w)).join(', ')})`);
  // And they must sit at different offsets — a chart where everything starts at
  // the same x has not actually used the dates.
  const lefts = [];
  for (let i = 0; i < await bars.count(); i++) lefts.push(await bars.nth(i).evaluate(el => Math.round(el.getBoundingClientRect().left)));
  ok(new Set(lefts).size > 1, `and they are positioned by date (${lefts.join(', ')})`);

  ok((await card.locator('.gantt-ms').count()) === 1, 'the milestone is a diamond, not a bar');
  ok((await card.locator('.gantt-base').count()) >= 1, 'the agreed plan is ghosted behind where it moved');
  ok((await card.locator('.gantt-arrow').count()) >= 1, 'the dependency is drawn as an arrow');
  ok((await card.locator('.gantt-blocked').count()) >= 1, 'a blocked job is marked on its bar');
  ok((await card.locator('.gantt-month').count()) >= 2, `months are labelled (${await card.locator('.gantt-month').count()})`);

  // The longest chain should be picked out.
  ok((await card.locator('.gantt-bar.is-chain').count()) >= 2, `the longest chain is highlighted (${await card.locator('.gantt-bar.is-chain').count()} bars)`);

  // Now break the plan and check the chart says so.
  await req('PUT', `/issues/${paint.id}`, { scheduledFor: '2027-01-05', dueDate: '2027-01-16' });
  await page.reload();
  await page.waitForSelector('.proj-page', { timeout: 20000 });
  await page.click('.tab-row .tab:has-text("Everything")');
  await page.waitForTimeout(900);
  const card2 = page.locator('.proj-card', { hasText: 'Candyshack ' + stamp }).first();
  const meta2 = await card2.locator('.proj-meta').innerText();
  ok(/contradicts itself/.test(meta2), 'a self-contradicting plan is flagged on the card');
  await card2.locator('.proj-toggle').click();
  await page.waitForSelector('.proj-gov', { timeout: 10000 });
  await card2.locator('.proj-view-switch .tab:has-text("Timeline")').click();
  await page.waitForSelector('.gantt', { timeout: 10000 });
  const note = await card2.locator('.gantt-notes').innerText();
  ok(/cannot start before/.test(note), `and spelled out under the chart ("${note.slice(0, 90)}…")`);
  ok((await card2.locator('.gantt-bar.is-violated').count()) >= 1, 'with the offending bar marked');

  await page.screenshot({ path: ((process.env.MM_SHOTS || '.') + '/v2-gantt.png'), fullPage: false });

  // ---- phone ----------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!overflow, 'the page does not overflow sideways on a phone');
  ok(await card2.locator('.gantt-scroll').evaluate(el => el.scrollWidth > el.clientWidth),
     'the chart itself scrolls rather than squashing');
  await page.screenshot({ path: ((process.env.MM_SHOTS || '.') + '/v2-gantt-mobile.png'), fullPage: false });

  console.log('\nPage errors: ' + (errs.length ? errs.join(' || ') : 'none'));
  ok(errs.length === 0, 'no page errors');
  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
  await br.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message); process.exit(2); });
