// The tree on screen: rolled-up phase dates, progress, and the refusal to finish
// a phase whose sub-tasks are open.
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

  // A three-level construction programme with overlapping work.
  const stamp = Date.now();
  const prop = (await req('POST', '/properties', { name: 'Tree UI ' + stamp })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });
  const proj = (await req('POST', '/projects', { name: 'Substructure ' + stamp, propertyId: prop.id, status: 'open' })).body;
  const mk = async (title, extra = {}) => (await req('POST', '/issues', {
    propertyId: prop.id, title, lat: 13.99, lng: -61.0, priority: 'medium', projectId: proj.id, ...extra,
  })).body;

  const pkg = await mk('Piling package');
  const dig = await mk('Excavate', { scheduledFor: '2027-03-01', dueDate: '2027-03-12' });
  const shore = await mk('Shoring', { scheduledFor: '2027-03-03', dueDate: '2027-03-16' });
  await req('PUT', `/issues/${dig.id}`, { parentId: pkg.id });
  await req('PUT', `/issues/${shore.id}`, { parentId: pkg.id });
  await req('POST', `/issues/${dig.id}/links`, { toIssueId: shore.id, kind: 'starts_after_start', lagDays: 2 });
  await req('PUT', `/issues/${dig.id}`, { percentComplete: 75 });

  await page.goto(B + '/#/projects');
  await page.waitForSelector('.proj-page', { timeout: 20000 });
  await page.click('.tab-row .tab:has-text("Everything")');
  await page.waitForTimeout(900);
  const card = page.locator('.proj-card', { hasText: 'Substructure ' + stamp }).first();
  await card.locator('.proj-toggle').click();
  await page.waitForSelector('.proj-gov', { timeout: 10000 });

  // ---- the phase shows its children's dates, not its own ---------------
  const pkgRow = card.locator('.proj-issue', { hasText: 'Piling package' }).first();
  const pkgText = await pkgRow.innerText();
  ok(/2027-03-01 to 2027-03-16/.test(pkgText), `the phase spans its children ("${pkgText.replace(/\n/g, ' ').slice(0, 110)}")`);
  ok(/2 open beneath/.test(pkgText), 'and says what is outstanding under it');

  // Progress, weighted: 75% of 12 days plus 0% of 14 = about 35%.
  const m = pkgText.match(/(\d+)%/);
  ok(!!m && Number(m[1]) > 20 && Number(m[1]) < 50, `weighted progress is shown (${m?.[1]}%)`);

  const digText = await card.locator('.proj-issue', { hasText: 'Excavate' }).first().innerText();
  ok(/75%/.test(digText), `a task shows its own reported progress ("${digText.replace(/\n/g, ' ').slice(0, 80)}")`);

  // ---- the refusal, through the UI --------------------------------------
  const before = (await req('GET', `/issues/${pkg.id}`)).body.status;
  const refused = await req('PUT', `/issues/${pkg.id}`, { status: 'completed' });
  ok(refused.status === 400, `finishing the phase is refused while tasks are open (${refused.status})`);
  ok(/still open/.test(refused.body?.error ?? ''), 'with a reason a person can act on');
  ok((await req('GET', `/issues/${pkg.id}`)).body.status === before, 'and nothing changed');

  // ---- the chart ---------------------------------------------------------
  await card.locator('.proj-view-switch .tab:has-text("Timeline")').click();
  await page.waitForSelector('.gantt', { timeout: 10000 });
  ok((await card.locator('.gantt-bar.is-summary').count()) === 1, 'the phase is drawn as a bracket, not a bar');
  const summaryW = await card.locator('.gantt-bar.is-summary').evaluate(el => el.getBoundingClientRect().width);
  const digW = await card.locator('.gantt-bar').nth(1).evaluate(el => el.getBoundingClientRect().width);
  ok(summaryW > digW, `and spans wider than any one task (${Math.round(summaryW)} vs ${Math.round(digW)})`);
  ok((await card.locator('.gantt-fill').count()) >= 1, 'reported progress fills part of a bar');
  ok((await card.locator('.gantt-arrow').count()) >= 1, 'the start-to-start link is drawn');

  // The overlapping pair must actually overlap on screen.
  const bars = card.locator('.gantt-bar:not(.is-summary)');
  const boxes = [];
  for (let i = 0; i < await bars.count(); i++) boxes.push(await bars.nth(i).boundingBox());
  const overlap = boxes.length >= 2 && boxes[0].x + boxes[0].width > boxes[1].x && boxes[1].x > boxes[0].x;
  ok(overlap, 'and the two run alongside each other rather than queueing');

  const label = await card.locator('.proj-view-switch .muted').innerText();
  ok(/longest (chain|task)/.test(label), `the chain is labelled honestly ("${label}")`);

  await page.screenshot({ path: ((process.env.MM_SHOTS || '.') + '/v2-tree.png'), fullPage: false });

  console.log('\nPage errors: ' + (errs.length ? errs.join(' || ') : 'none'));
  ok(errs.length === 0, 'no page errors');
  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
  await br.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message); process.exit(2); });
