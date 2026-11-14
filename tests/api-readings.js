// Slice 2: a number on an inspection check, with a range and a trend.
const { session } = require('./session');
let fail = 0;
let req;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

(async () => {
  ({ req } = await session());
  ok(true, 'signed in (shared session)');

  const stamp = Date.now();
  const prop = (await req('POST', '/properties', { name: 'Readings ' + stamp })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });

  // ---- the shipped templates now declare measurements -----------------
  const templates = (await req('GET', `/inspections/templates?propertyId=${prop.id}`)).body;
  const guest = templates.find(t => t.name === 'Guest room');
  ok(!!guest, 'the guest room checklist is there');

  const full = (await req('GET', `/inspections/templates/${guest.id}`)).body;
  const points = full.sections.flatMap(s => s.points.map(p => ({ ...p, section: s.name })));
  const measured = points.filter(p => p.unit);
  ok(measured.length >= 4, `it has measurement points (${measured.length})`);

  const hot = points.find(p => p.label === 'Hot water outlet temperature');
  ok(!!hot, 'including the hot water outlet temperature');
  ok(hot.unit === '°C' && hot.minOk === 50 && hot.maxOk === null,
     `with a minimum and no maximum (${hot.unit}, min ${hot.minOk}, max ${hot.maxOk})`);

  const chlorine = points.find(p => p.label === 'Free chlorine');
  ok(!!chlorine && chlorine.unit === 'mg/L', 'and free chlorine in mg/L');
  ok(chlorine.minOk === 1 && chlorine.maxOk === 3, `with a band (${chlorine.minOk}–${chlorine.maxOk})`);
  const ph = points.find(p => p.label === 'pH');
  ok(!!ph && ph.minOk === 7.2 && ph.maxOk === 7.8, `and pH (${ph?.minOk}–${ph?.maxOk})`);

  // The pool trade was wrong and is now right.
  const pool = points.filter(p => p.section === 'Private pool or hot tub');
  ok(pool.some(p => p.category === 'pool_spa'), 'the pool section now routes to the pool trade');
  ok(pool.filter(p => p.category === 'plumbing').length === 0, 'and no longer proposes a plumber for a pool pump');

  // ---- a walk carries the expected range onto its lines ---------------
  const walk = (await req('POST', '/inspections', {
    propertyId: prop.id, roomName: 'Room 214', templateId: guest.id,
  })).body;
  const hotCheck = walk.checks.find(c => c.label === 'Hot water outlet temperature');
  ok(!!hotCheck, 'the walk has the line');
  ok(hotCheck.unit === '°C' && hotCheck.minOk === 50,
     `with the expected range copied onto it (${hotCheck.unit}, min ${hotCheck.minOk})`);
  ok(hotCheck.value === null, 'and no reading yet, which is not the same as zero');

  // ---- a reading out of range flags the line by itself ----------------
  let r = await req('PUT', `/inspections/checks/${hotCheck.id}`, { value: 48 });
  ok(r.status === 200, `a reading can be recorded (${r.status})`);
  ok(r.body.value === 48, 'and is kept');
  ok(r.body.outcome === 'flagged',
     `48 against a 50 minimum flags itself without anybody pressing flag (${r.body.outcome})`);

  // ---- and a good one clears it ---------------------------------------
  r = await req('PUT', `/inspections/checks/${hotCheck.id}`, { value: 55 });
  ok(r.body.outcome === 'ok', `55 reads as fine (${r.body.outcome})`);
  ok(r.body.severity === null, 'and the severity goes with it');

  // ---- above the top of a band -----------------------------------------
  const chlCheck = walk.checks.find(c => c.label === 'Free chlorine');
  r = await req('PUT', `/inspections/checks/${chlCheck.id}`, { value: 5.2 });
  ok(r.body.outcome === 'flagged', `5.2 mg/L against a 1–3 band flags (${r.body.outcome})`);
  r = await req('PUT', `/inspections/checks/${chlCheck.id}`, { value: 0.4 });
  ok(r.body.outcome === 'flagged', 'and so does 0.4, at the other end');
  r = await req('PUT', `/inspections/checks/${chlCheck.id}`, { value: 1.8 });
  ok(r.body.outcome === 'ok', '1.8 is within the band');

  // ---- the inspector can still override --------------------------------
  r = await req('PUT', `/inspections/checks/${chlCheck.id}`, { value: 0.4, outcome: 'na' });
  ok(r.body.outcome === 'na', `an explicit outcome in the same request wins (${r.body.outcome})`);
  ok(r.body.value === 0.4, 'and the reading is still recorded');

  // ---- validation -------------------------------------------------------
  r = await req('PUT', `/inspections/checks/${chlCheck.id}`, { value: 'quite high' });
  ok(r.status === 400, `a reading has to be a number (${r.status})`);
  r = await req('PUT', `/inspections/checks/${chlCheck.id}`, { unit: 'bananas' });
  ok(r.status === 400, `and a unit has to be one of the known ones (${r.status})`);
  r = await req('PUT', `/inspections/checks/${chlCheck.id}`, { value: null });
  ok(r.status === 200 && r.body.value === null, 'a reading can be cleared back to not taken');

  // ---- a one-off measurement on a general walk -------------------------
  const general = templates.find(t => t.kind === 'general');
  const gwalk = (await req('POST', '/inspections', {
    propertyId: prop.id, roomName: 'Plant room', templateId: general.id,
  })).body;
  const slot = gwalk.checks[0];
  r = await req('PUT', `/inspections/checks/${slot.id}`, {
    label: 'Calorifier flow temperature', unit: '°C', minOk: 60, value: 54,
  });
  ok(r.status === 200, `a blank slot can be given its own measurement (${r.status})`);
  ok(r.body.unit === '°C' && r.body.minOk === 60, 'with a unit and a range of its own');
  ok(r.body.outcome === 'flagged', `and 54 against 60 flags it (${r.body.outcome})`);

  // ---- the trend, which is the point of recording numbers --------------
  await req('PUT', `/inspections/checks/${hotCheck.id}`, { value: 52 });
  await req('POST', `/inspections/${walk.id}/complete`, {});
  // A second walk a week later, so there is a series rather than a point.
  const walk2 = (await req('POST', '/inspections', {
    propertyId: prop.id, roomName: 'Room 214', templateId: guest.id,
  })).body;
  const hot2 = walk2.checks.find(c => c.label === 'Hot water outlet temperature');
  await req('PUT', `/inspections/checks/${hot2.id}`, { value: 46 });

  r = await req('GET', `/inspections/readings?propertyId=${prop.id}`);
  ok(r.status === 200, `the readings series reads (${r.status})`);
  const hotSeries = r.body.series.find(s => s.label === 'Hot water outlet temperature');
  ok(!!hotSeries, 'the hot water readings are grouped as one series');
  ok(hotSeries.count === 2, `with both walks in it (${hotSeries.count})`);
  ok(hotSeries.unit === '°C' && hotSeries.minOk === 50, 'carrying the range so a chart can draw the band');
  ok(hotSeries.min === 46 && hotSeries.max === 52, `and the spread (${hotSeries.min}–${hotSeries.max})`);
  ok(hotSeries.mean === 49, `and the mean (${hotSeries.mean})`);
  ok(hotSeries.outOfRange === 1, `one of the two failed (${hotSeries.outOfRange})`);
  ok(hotSeries.latest.value === 46 && hotSeries.latest.verdict === 'low',
     `the latest is named with which way it failed (${hotSeries.latest.value}, ${hotSeries.latest.verdict})`);
  ok(hotSeries.readings[0].value === 52 && hotSeries.readings[1].value === 46, 'in date order, oldest first');

  // A series with no range is reported, but cannot have a verdict.
  const anySeries = r.body.series.find(s => s.label === 'Calorifier flow temperature');
  ok(!!anySeries, 'the general-walk measurement has its own series');

  // Worst first, so the one to look at is at the top.
  const failing = r.body.series.filter(s => s.outOfRange > 0);
  ok(r.body.series[0].outOfRange >= (r.body.series[r.body.series.length - 1].outOfRange ?? 0),
     `the series are ordered worst first (${failing.length} with failures)`);

  // Filtering to one point gives just that one.
  r = await req('GET', `/inspections/readings?pointId=${hot.id}`);
  ok(r.body.series.length === 1 && r.body.series[0].pointId === hot.id,
     `filtering by point narrows it (${r.body.series.length})`);

  r = await req('GET', `/inspections/readings?propertyId=${prop.id}&from=2099-01-01`);
  ok(r.body.series.length === 0, 'and a date window with nothing in it gives nothing');
  r = await req('GET', `/inspections/readings?propertyId=${prop.id}&from=not-a-date`);
  ok(r.status === 400, `a bad date is refused (${r.status})`);

  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message, e.stack); process.exit(2); });
