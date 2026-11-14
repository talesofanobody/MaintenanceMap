const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const B = process.env.MM_CLIENT || 'http://localhost:5173';
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };
(async () => {
  const br = await chromium.launch();
  const page = await (await br.newContext()).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  // Map tiles come from an external origin that this sandbox's proxy does not
  // reach. That is the environment, not the app, so it is not a failure here.
  const envNoise = /favicon|404 \(Not Found\)|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|arcgisonline/;
  page.on('console', m => { if (m.type() === 'error' && !envNoise.test(m.text())) errs.push(m.text().slice(0,160)); });
  page.on('requestfailed', r => { if (!envNoise.test(r.url())) errs.push('REQFAIL ' + r.url().slice(0,80)); });

  // Reuse the shared session rather than signing in again: a full run of the
  // suites otherwise trips the login limiter, which is the limiter working.
  const { session } = require('./session');
  const { cookie } = await session();
  const [name, value] = cookie.split('=');
  await page.context().addCookies([{ name, value, domain: 'localhost', path: '/' }]);
  await page.goto(B + '/');
  await page.waitForSelector('.nav-toggle', { timeout: 20000 });

  // Every page reachable from the drawer, looking only for breakage.
  const routes = [
    ['/', '.page, .dash'],
    ['/inspections', '.insp-list-page'],
    ['/walkthrough', '.page'],
    ['/projects', '.proj-page'],
    ['/scheduler', '.page'],
    ['/requests', '.page'],
    ['/properties', '.page'],
    ['/utilities', '.page'],
    ['/places', '.places-page'],
    ['/equipment', '.equipment-page'],
    ['/equipment-map', '.equipment-map-page'],
    ['/crew-map', '.page'],
    ['/schedules', '.page'],
    ['/technicians', '.page'],
    ['/dashboards', '.page, .dash'],
    ['/reports', '.page'],
    ['/activity', '.page'],
    ['/access', '.page'],
    ['/settings', '.page'],
  ];
  for (const [path, sel] of routes) {
    const before = errs.length;
    await page.goto(B + '/#' + path);
    try {
      await page.waitForSelector(sel, { timeout: 12000 });
      ok(errs.length === before, `${path} renders${errs.length > before ? ' — ' + errs.slice(before).join(' | ') : ''}`);
    } catch {
      ok(false, `${path} did not render`);
    }
  }

  // An issue panel, which is the read that now carries the new relations.
  //
  // With its own fixture rather than whatever happens to be first in the list:
  // picking properties[0] meant that once other suites had created properties,
  // this quietly found one with no issues and skipped three of its four checks.
  // A test that skips silently is worse than one that fails.
  const API = process.env.MM_API || 'http://localhost:4000';
  const csrf = (await page.request.fetch(API + '/api/auth/me')).headers()['x-csrf-token'];
  const post = async (path, data) => {
    const r = await page.request.fetch(API + '/api' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, data,
    });
    return r.json();
  };
  const prop = await post('/properties', { name: 'Smoke ' + Date.now() });
  const issue = await post('/issues', {
    propertyId: prop.id, title: 'Smoke test issue', lat: 13.99, lng: -61.0, priority: 'medium',
  });
  ok(!!issue.id, 'a fixture issue is created');

  // The list is paged now: items plus the true total, rather than a bare array.
  const list = await (await page.request.fetch(`${API}/api/issues?propertyId=${prop.id}`)).json();
  ok(Array.isArray(list.items) && list.items.length === 1, `the issue list reads it back (${list.items?.length})`);
  ok(list.total === 1 && list.hasMore === false, `with the total and no more to come (${list.total})`);

  const one = await (await page.request.fetch(`${API}/api/issues/${issue.id}`)).json();
  ok(one.id === issue.id, 'and a single issue reads');
  ok(Array.isArray(one.linksOut) && Array.isArray(one.children) && Array.isArray(one.quotes) && Array.isArray(one.blockers),
     'with the new relations present and empty rather than missing');

  const before = errs.length;
  await page.goto(`${B}/#/properties/${prop.id}?issue=${issue.id}`);
  await page.waitForTimeout(3500);
  ok(errs.length === before, `the issue panel opens clean${errs.length > before ? ' — ' + errs.slice(before).join(' | ') : ''}`);

  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} FAILED`);
  await br.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message); process.exit(2); });
