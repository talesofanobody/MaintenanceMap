const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const B = process.env.MM_CLIENT || 'http://localhost:5173';
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

(async () => {
  const br = await chromium.launch();
  const page = await (await br.newContext()).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

  // --- sign in ---------------------------------------------------------
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
  const meRes = await page.request.fetch((process.env.MM_API || 'http://localhost:4000') + '/api/auth/me');
  const csrf = meRes.headers()['x-csrf-token'];
  ok(!!csrf, 'signed in');

  // --- can a person actually REACH the projects page from the menu? -----
  await page.click('.nav-toggle');
  await page.waitForTimeout(400);
  const projLink = page.locator('.app-nav a:has-text("Projects")');
  ok((await projLink.count()) > 0, 'Projects is in the menu');
  await projLink.first().click();
  await page.waitForSelector('.proj-page', { timeout: 20000 });
  ok(true, 'the projects page opens from the menu');

  // The tabs should offer the new stages.
  const tabs = await page.locator('.tab-row .tab').allInnerTexts();
  ok(tabs.includes('Planning') && tabs.includes('On hold'), `the new stages are tabs (${tabs.join(', ')})`);

  // --- find the project the API test created -----------------------------
  await page.click('.tab-row .tab:has-text("Everything")');
  await page.waitForTimeout(800);
  const card = page.locator('.proj-card', { hasText: 'Project Candyshack' }).first();
  ok((await card.count()) > 0, 'the project is listed');

  // --- expand it: the plan panel must be there --------------------------
  await card.locator('.proj-toggle').click();
  await page.waitForSelector('.proj-plan', { timeout: 10000 });
  ok(true, 'expanding shows the plan panel');

  // Owner and stage are editable in place.
  const ownerVal = await card.locator('.proj-plan-grid select').first().inputValue();
  ok(ownerVal !== '', 'the owner is set and shown');
  const stageText = await card.locator('.proj-plan-grid select').nth(1).inputValue();
  ok(['planning','open','on_hold','done','cancelled'].includes(stageText), `the stage is a choice (${stageText})`);

  // Money, four figures.
  const figures = await card.locator('.proj-money-figures span').allInnerTexts();
  ok(figures.length === 4, `four money figures (${figures.length})`);
  const joined = figures.join(' | ');
  ok(/approved/i.test(joined) && /committed/i.test(joined) && /spent/i.test(joined) && /left/i.test(joined),
     `labelled approved/committed/spent/left`);
  ok(/50,000|50000/.test(joined), `the approved budget shows (${joined.replace(/\n/g,' ')})`);

  // Slippage is stated in words, not left to arithmetic.
  const planRow = await card.locator('.proj-plan-row').innerText();
  ok(/later than agreed|on plan|earlier than agreed/.test(planRow), `slippage is spelled out ("${planRow.split('\n')[0]}")`);

  // The three-quote chip.
  const chip = await card.locator('.proj-quotes-head .chip').innerText();
  ok(/of 3/.test(chip), `the quote rule is a visible chip ("${chip}")`);

  // --- the work breakdown is a tree, not a flat list ---------------------
  // Build a parent/child pair through the API, since the API suite deletes its
  // own phase as its last act and would leave nothing nested to look at.
  const api = async (method, path, body) => {
    const r = await page.request.fetch((process.env.MM_API || 'http://localhost:4000') + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      data: body,
    });
    return { status: r.status(), body: await r.json().catch(() => null) };
  };
  const projId = await card.getAttribute('data-project-id');
  const list = (await api('GET', '/projects?status=')).body;
  const target = list.find(p => p.name === 'Project Candyshack');
  const kids = target.issues.filter(i => !i.isMilestone);
  if (kids.length >= 2) {
    await api('PUT', `/issues/${kids[1].id}`, { parentId: kids[0].id });
  }
  await page.reload();
  await page.waitForSelector('.proj-page', { timeout: 20000 });
  await page.click('.tab-row .tab:has-text("Everything")');
  await page.waitForTimeout(800);
  const card2 = page.locator('.proj-card', { hasText: 'Project Candyshack' }).first();
  await card2.locator('.proj-toggle').click();
  await page.waitForSelector('.proj-plan', { timeout: 10000 });

  const rows = card2.locator('.proj-issue');
  const n = await rows.count();
  ok(n >= 2, `the work is listed (${n} rows)`);
  const pads = [];
  for (let i = 0; i < n; i++) pads.push(await rows.nth(i).evaluate(el => parseInt(getComputedStyle(el).paddingLeft)));
  ok(new Set(pads).size > 1, `and indented by hierarchy (paddings: ${pads.join(', ')})`);

  // A milestone reads differently from a job.
  const ms = card2.locator('.proj-issue.is-milestone');
  ok((await ms.count()) >= 1, 'the milestone is marked');
  ok((await ms.first().locator('.proj-milestone-mark').count()) === 1, 'with its own glyph');

  // --- a real edit through the UI, saved and reflected ------------------
  const before = await card2.locator('.proj-plan-grid input[type="date"]').nth(1).inputValue();
  // Pick a date that differs from whatever is there, so the test does not depend
  // on the state a previous run left behind.
  const moved = before === '2027-03-31' ? '2027-04-30' : '2027-03-31';
  await card2.locator('.proj-plan-grid input[type="date"]').nth(1).fill(moved);
  await card2.locator('.proj-plan-grid input[type="date"]').nth(1).blur();
  await page.waitForTimeout(1200);
  const afterRow = await card2.locator('.proj-plan-row').innerText();
  ok(/later than agreed/.test(afterRow), `moving the end date shows the slip ("${afterRow.split('\n')[0]}")`);
  ok(before !== moved, `and it was a genuine change (${before} -> ${moved})`);

  // --- mobile: the panel must not overflow ------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!overflow, 'no horizontal overflow on a phone');
  await page.screenshot({ path: ((process.env.MM_SHOTS || '.') + '/v2-plan-mobile.png'), fullPage: false });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: ((process.env.MM_SHOTS || '.') + '/v2-plan.png'), fullPage: false });

  console.log('\nPage errors: ' + (errors.length ? errors.join(' || ') : 'none'));
  ok(errors.length === 0, 'no page errors');
  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
  await br.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message); process.exit(2); });
