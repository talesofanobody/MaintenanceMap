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

  await page.goto(B + '/');
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30000 });
  await page.fill('input[autocomplete="username"]', 'khalid');
  await page.fill('input[autocomplete="current-password"]', 'correcthorsebattery9');
  await page.click('button:has-text("Sign in")');
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
  const props = await (await page.request.fetch((process.env.MM_API || 'http://localhost:4000') + '/api/properties')).json();
  if (props[0]) {
    const issues = await (await page.request.fetch(`${process.env.MM_API || 'http://localhost:4000'}/api/issues?propertyId=${props[0].id}`)).json();
    ok(Array.isArray(issues), `the issue list still reads (${issues.length} issues)`);
    if (issues[0]) {
      const one = await (await page.request.fetch(`${process.env.MM_API || 'http://localhost:4000'}/api/issues/${issues[0].id}`)).json();
      ok(one.id === issues[0].id, 'and a single issue reads');
      ok(Array.isArray(one.linksOut) && Array.isArray(one.children) && Array.isArray(one.quotes),
         'with the new relations present and empty rather than missing');
      const before = errs.length;
      await page.goto(`${B}/#/properties/${props[0].id}?issue=${issues[0].id}`);
      await page.waitForTimeout(3500);
      ok(errs.length === before, `the issue panel opens clean${errs.length > before ? ' — ' + errs.slice(before).join(' | ') : ''}`);
    }
  }

  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} FAILED`);
  await br.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message); process.exit(2); });
