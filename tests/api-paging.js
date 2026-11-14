// Slice 0: the list endpoints no longer hand back everything at once.
const { session } = require('./session');
let fail = 0;
let req;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

(async () => {
  ({ req } = await session());
  ok(true, 'signed in (shared session)');

  const stamp = Date.now();
  const prop = (await req('POST', '/properties', { name: 'Paging ' + stamp })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });

  // Enough to cross the default page, which is the only way to test a page.
  const WANT = 230;
  process.stdout.write(`  creating ${WANT} issues…`);
  for (let i = 0; i < WANT; i++) {
    await req('POST', '/issues', {
      propertyId: prop.id, title: `Snag ${String(i + 1).padStart(3, '0')}`,
      lat: 13.99, lng: -61.0, priority: 'medium',
    });
  }
  console.log(' done');

  // ---- the shape carries the total -------------------------------------
  let r = await req('GET', `/issues?propertyId=${prop.id}`);
  ok(r.status === 200, `the list reads (${r.status})`);
  ok(Array.isArray(r.body.items), 'and returns items rather than a bare array');
  ok(r.body.total === WANT, `with the true total alongside (${r.body.total})`);
  ok(r.body.items.length === 200, `a default page is 200, not all of them (${r.body.items.length})`);
  ok(r.body.hasMore === true, 'and it says there are more');
  ok(r.body.limit === 200 && r.body.offset === 0, `reporting the window it used (${r.body.limit}/${r.body.offset})`);

  // ---- paging through reaches everything, once each --------------------
  const seen = new Set();
  let offset = 0;
  let pages = 0;
  for (;;) {
    const page = (await req('GET', `/issues?propertyId=${prop.id}&limit=100&offset=${offset}`)).body;
    pages += 1;
    for (const it of page.items) seen.add(it.id);
    offset += page.items.length;
    if (!page.hasMore || !page.items.length || pages > 10) break;
  }
  ok(pages === 3, `paging at 100 takes three pages (${pages})`);
  ok(seen.size === WANT, `and reaches every issue exactly once (${seen.size})`);

  // ---- the ceiling cannot be raised by asking ---------------------------
  r = await req('GET', `/issues?propertyId=${prop.id}&limit=99999`);
  ok(r.body.items.length <= 1000, `a huge limit is clamped (${r.body.items.length})`);
  ok(r.body.limit === 1000, `to the ceiling, and says so (${r.body.limit})`);

  r = await req('GET', `/issues?propertyId=${prop.id}&limit=0`);
  ok(r.body.limit === 200, `a nonsense limit falls back to the default (${r.body.limit})`);
  r = await req('GET', `/issues?propertyId=${prop.id}&limit=-5`);
  ok(r.body.limit === 200, 'and so does a negative one');
  r = await req('GET', `/issues?propertyId=${prop.id}&limit=abc`);
  ok(r.body.limit === 200, 'and so does a word');
  r = await req('GET', `/issues?propertyId=${prop.id}&offset=-10`);
  ok(r.body.offset === 0, `a negative offset is treated as the start (${r.body.offset})`);

  // ---- past the end is empty, not an error ------------------------------
  r = await req('GET', `/issues?propertyId=${prop.id}&offset=${WANT + 50}`);
  ok(r.status === 200 && r.body.items.length === 0, 'reading past the end is empty rather than an error');
  ok(r.body.total === WANT, 'and still reports the total');
  ok(r.body.hasMore === false, 'with nothing more to come');

  // ---- the filters still work, and the total follows them --------------
  const first = (await req('GET', `/issues?propertyId=${prop.id}&limit=1`)).body.items[0];
  await req('PUT', `/issues/${first.id}`, { status: 'completed' });
  r = await req('GET', `/issues?propertyId=${prop.id}&open=1`);
  ok(r.body.total === WANT - 1, `filtering to open narrows the total too (${r.body.total})`);

  // ---- a payload a browser can actually take ---------------------------
  const sized = await fetch(
    (process.env.MM_API || 'http://127.0.0.1:4000') + `/api/issues?propertyId=${prop.id}`,
    { headers: { Cookie: (await session()).cookie } }
  );
  const bytes = (await sized.text()).length;
  ok(bytes < 4_000_000, `a default page is a sane size (${Math.round(bytes / 1024)}KB)`);

  // ---- the dashboard degrades rather than melting ----------------------
  r = await req('GET', '/dashboard');
  ok(r.status === 200, `the dashboard still reads with the volume (${r.status})`);
  ok(Array.isArray(r.body.issues) && r.body.issues.length <= 1500,
     `and is capped rather than unbounded (${r.body.issues?.length})`);

  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message, e.stack); process.exit(2); });
