// The walk-through asks how you want to work, then behaves accordingly.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const B = process.env.MM_CLIENT || 'http://localhost:5173';
const API = (process.env.MM_API || 'http://localhost:4000') + '/api';
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1280, height: 1000 } });
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
  const name = 'ZZZ Walk ' + stamp;
  const prop = (await req('POST', '/properties', { name })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });
  const block = (await req('POST', '/spaces', { propertyId: prop.id, name: 'Coubaril', kind: 'block' })).body
    .spaces.find(x => x.name === 'Coubaril');
  await req('POST', '/spaces', { propertyId: prop.id, parentId: block.id, names: '101-102', sellable: true });

  // ---- the choice comes first -----------------------------------------
  await page.goto(B + '/#/walkthrough');
  await page.waitForSelector('.walk-pick', { timeout: 20000 });
  const modes = page.locator('.walk-mode');
  ok((await modes.count()) === 2, `two ways to work are offered (${await modes.count()})`);
  const pickText = await page.locator('.walk-pick').innerText();
  ok(/photograph first/i.test(pickText), 'one is photograph first, sort afterwards');
  ok(/one issue at a time/i.test(pickText), 'the other is one issue at a time');

  // Nothing starts until a choice is made.
  const startBtn = page.locator('.walk-start button:has-text("Start")');
  ok(await startBtn.isDisabled(), 'starting is held back until one is chosen');

  // Location is only asked for the route that uses it.
  ok((await page.locator('.walk-start-form label:has-text("Location")').count()) === 0,
    'the location is not asked for before a choice is made');

  // ---- the photograph-first route is unchanged ------------------------
  await modes.first().click();
  await page.waitForTimeout(300);
  ok(!(await startBtn.isDisabled()), 'choosing one lets the walk start');
  ok((await page.locator('.walk-start-form label:has-text("Location")').count()) === 0,
    'photograph-first asks for no location, as before');
  ok((await startBtn.innerText()).toLowerCase().includes('start walking'), 'and the button says start walking');

  // ---- the one-issue-at-a-time route asks where you are ---------------
  await modes.nth(1).click();
  await page.waitForTimeout(400);
  ok((await page.locator('.walk-start-form label:has-text("Location")').count()) === 1,
    'one-issue-at-a-time asks for a location');
  ok((await startBtn.innerText()).toLowerCase().includes('start logging'), 'and the button says start logging');

  await page.selectOption('.walk-start-form select >> nth=0', { label: name });
  await page.waitForTimeout(700);
  await page.selectOption('.walk-start-form label:has-text("Location") select', { label: 'Coubaril · 101' });
  await startBtn.click();

  // ---- the boxes ------------------------------------------------------
  await page.waitForSelector('.direct-walk', { timeout: 20000 });
  ok(true, 'it opens straight into the boxes');
  ok((await page.locator('.walk-capture').count()) === 0,
    'with no pile of photos to sort, because there will not be one');
  ok((await page.locator('.direct-box').count()) === 10, `ten blank boxes (${await page.locator('.direct-box').count()})`);
  ok((await page.locator('.direct-place').innerText()).includes('Coubaril · 101'),
    'and it says where you are');

  // A name alone is enough.
  const first = page.locator('.direct-box').first();
  ok(await first.locator('button:has-text("Log it")').isDisabled(), 'an empty box logs nothing');
  await first.locator('.direct-title').fill('Corridor light out');
  await page.waitForTimeout(200);
  ok(!(await first.locator('button:has-text("Log it")').isDisabled()), 'a name is enough to log it');
  await first.locator('button:has-text("Log it")').click();
  await page.waitForTimeout(1500);
  ok((await page.locator('.direct-box-done').count()) === 1, 'the box shows it is logged');
  ok((await page.locator('.direct-box-done').innerText()).includes('Corridor light out'), 'naming what it became');

  // Enter logs it too, because a thumb on a phone should not hunt for a button.
  const second = page.locator('.direct-box').nth(1);
  await second.locator('.direct-title').fill('Tap drips');
  await second.locator('.direct-title').press('Enter');
  await page.waitForTimeout(1500);
  ok((await page.locator('.direct-box-done').count()) === 2, 'pressing Enter logs one as well');

  // ---- ten more -------------------------------------------------------
  await page.locator('.direct-more button:has-text("Add 10 more")').click();
  await page.waitForTimeout(400);
  ok((await page.locator('.direct-box').count()) === 20, `ten more boxes appear (${await page.locator('.direct-box').count()})`);
  ok((await page.locator('.direct-box-done').count()) === 2, 'and the logged ones stay logged');

  // ---- moving to the next room ----------------------------------------
  await page.selectOption('.direct-place select', { label: 'Coubaril · 102' });
  await page.waitForTimeout(1500);
  const third = page.locator('.direct-box').filter({ hasNot: page.locator('.direct-done') }).first();
  await third.locator('.direct-title').fill('Blind broken');
  await third.locator('button:has-text("Log it")').click();
  await page.waitForTimeout(1500);

  const walks = (await req('GET', `/walkthroughs?propertyId=${prop.id}`)).body;
  const walk = (await req('GET', `/walkthroughs/${walks[0].id}`)).body;
  ok(walk.mode === 'direct', 'the walk records how it is being worked');
  ok(walk.issues.length === 3, `three issues logged (${walk.issues.length})`);
  const byTitle = Object.fromEntries(walk.issues.map(i => [i.title, i]));
  ok(byTitle['Corridor light out'].roomName === '101', 'the first two are filed against room 101');
  ok(byTitle['Blind broken'].roomName === '102', 'and the one after the move against 102');

  // ---- picking it back up lands in the same screen ---------------------
  await page.goto(B + '/#/walkthrough');
  await page.waitForSelector('.walk-pick', { timeout: 20000 });
  const card = page.locator('.insp-card', { hasText: name });
  ok((await card.innerText()).includes('one issue at a time'), 'the resume card says which kind it is');
  await card.locator('a:has-text("Carry on")').click();
  await page.waitForSelector('.direct-walk', { timeout: 20000 });
  ok(true, 'and carrying on opens the boxes, not the grouping screen');
  ok((await page.locator('.direct-place').innerText()).includes('Coubaril · 102'),
    'still at the room it was left in');

  await page.screenshot({ path: (process.env.MM_SHOTS || '/tmp') + '/walk-direct.png', fullPage: true });

  ok(errs.length === 0, `no console errors (${errs.slice(0, 2).join(' | ') || 'none'})`);
  await br.close();
  console.log(fail === 0 ? '\nAll ui-walkmode checks passed.' : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
