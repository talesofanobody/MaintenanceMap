// The working calendar, end to end: opting in changes float, and opting out
// puts it back.
const B = (process.env.MM_API || 'http://127.0.0.1:4000') + '/api';
const { session } = require('./session');
let fail = 0;
let req;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };
(async () => {
  ({ req } = await session());
  ok(true, 'signed in (shared session)');

  const stamp = Date.now();
  const prop = (await req('POST', '/properties', { name: 'Calendar ' + stamp })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });
  const proj = (await req('POST', '/projects', { name: 'Calendar works ' + stamp, propertyId: prop.id, status: 'open' })).body;
  const mk = async (title, extra) => (await req('POST', '/issues', {
    propertyId: prop.id, title, lat: 13.99, lng: -61.0, priority: 'medium', projectId: proj.id, ...extra,
  })).body;
  // Friday finish, Monday start — the gap a calendar is for.
  const a = await mk('Strip out', { scheduledFor: '2027-01-04', dueDate: '2027-01-08' });
  const b = await mk('Make good', { scheduledFor: '2027-01-11', dueDate: '2027-01-15' });
  await req('POST', `/issues/${a.id}/links`, { toIssueId: b.id, kind: 'precedes' });
  const get = async () => (await req('GET', `/projects/${proj.id}`)).body;

  // ---- before any calendar: unchanged behaviour ------------------------
  let p = await get();
  ok(p.analysis.workingDays === false, 'with no calendar the analysis says so');
  ok(p.analysis.items[a.id].floatDays === 2, `and the weekend reads as two days of float (${p.analysis.items[a.id].floatDays})`);
  ok(p.analysis.longestChainDays === 10, `the chain is ten calendar days (${p.analysis.longestChainDays})`);

  // ---- opting in -------------------------------------------------------
  let r = await req('GET', `/calendars/for/${prop.id}`);
  ok(r.status === 200 && r.body.calendar === null, 'no calendar is in force to begin with');

  r = await req('POST', '/calendars', { propertyId: prop.id, name: 'Site hours' });
  ok(r.status === 201, `a calendar can be created for a property (${r.status})`);
  const cal = r.body;
  ok(JSON.parse(cal.workingDays).join(',') === 'true,true,true,true,true,true,false',
     'defaulting to a six-day week, Sunday off');

  r = await req('POST', '/calendars', { propertyId: prop.id });
  ok(r.status === 400, `a property cannot have two (${r.status})`);

  p = await get();
  ok(p.analysis.workingDays === true, 'the analysis now reports working days');
  ok(p.analysis.items[a.id].floatDays === 1,
     `and the same gap is one working day, not two (${p.analysis.items[a.id].floatDays})`);
  ok(p.analysis.items[a.id].earliestStartDate === '2027-01-04',
     `with the dates still reported as dates (${p.analysis.items[a.id].earliestStartDate})`);

  // ---- a five-day week removes the slack entirely ----------------------
  r = await req('PUT', `/calendars/${cal.id}`, { workingDays: [true, true, true, true, true, false, false] });
  ok(r.status === 200, `the week can be changed (${r.status})`);
  p = await get();
  ok(p.analysis.items[a.id].floatDays === 0,
     `on a five-day week there is no slack at all (${p.analysis.items[a.id].floatDays})`);
  ok(p.analysis.criticalPath.length === 2, 'so the whole chain is critical, which counting every day hid');

  r = await req('PUT', `/calendars/${cal.id}`, { workingDays: [false, false, false, false, false, false, false] });
  ok(r.status === 400, `a week with no working days is refused (${r.status})`);
  r = await req('PUT', `/calendars/${cal.id}`, { workingDays: [true, true, true] });
  ok(r.status === 400, `and so is one that is not seven long (${r.status})`);

  // ---- exceptions, both ways -------------------------------------------
  await req('PUT', `/calendars/${cal.id}`, { workingDays: [true, true, true, true, true, true, false] });
  r = await req('POST', `/calendars/${cal.id}/exceptions`, { day: '2027-01-09', working: false, reason: 'Public holiday' });
  ok(r.status === 201, `a holiday can be added (${r.status})`);
  ok(r.body.exceptions.length === 1 && r.body.exceptions[0].working === false, 'as a non-working day');
  p = await get();
  ok(p.analysis.items[a.id].floatDays === 0,
     `losing the Saturday removes the last of the slack (${p.analysis.items[a.id].floatDays})`);

  r = await req('POST', `/calendars/${cal.id}/exceptions`, { day: '2027-01-10', working: true, reason: 'Catch-up Sunday' });
  ok(r.status === 201, 'and a worked Sunday can be added');
  ok(r.body.exceptions.length === 2, `both are kept (${r.body.exceptions.length})`);
  p = await get();
  ok(p.analysis.items[a.id].floatDays === 1,
     `which gives the day back (${p.analysis.items[a.id].floatDays})`);

  // Setting the same day again replaces rather than duplicating.
  r = await req('POST', `/calendars/${cal.id}/exceptions`, { day: '2027-01-10', working: false, reason: 'Called off' });
  ok(r.status === 201 && r.body.exceptions.length === 2, 'setting the same day again replaces it');
  ok(r.body.exceptions.find(e => e.day === '2027-01-10').working === false, 'with the new answer');

  r = await req('POST', `/calendars/${cal.id}/exceptions`, { day: 'next tuesday' });
  ok(r.status === 400, `a date has to be a date (${r.status})`);
  r = await req('POST', `/calendars/${cal.id}/exceptions`, { day: '2027-02-30' });
  ok(r.status === 400, `and a real one (${r.status})`);

  const sunday = (await req('GET', `/calendars/for/${prop.id}`)).body.calendar.exceptions.find(e => e.day === '2027-01-10');
  r = await req('DELETE', `/calendars/${cal.id}/exceptions/${sunday.id}`);
  ok(r.status === 200 && r.body.exceptions.length === 1, 'an exception can be removed');

  // ---- the fallback ----------------------------------------------------
  const other = (await req('POST', '/properties', { name: 'No calendar ' + stamp })).body;
  r = await req('GET', `/calendars/for/${other.id}`);
  ok(r.body.calendar === null, 'a second property has none of its own');
  r = await req('POST', '/calendars', { name: 'Group default', workingDays: [true, true, true, true, true, false, false] });
  ok(r.status === 201, `a fallback calendar can be created (${r.status})`);
  r = await req('GET', `/calendars/for/${other.id}`);
  ok(r.body.calendar !== null && r.body.inherited === true, 'and the second property inherits it');
  r = await req('GET', `/calendars/for/${prop.id}`);
  ok(r.body.inherited === false, 'while the first keeps its own');
  r = await req('POST', '/calendars', { name: 'Another default' });
  ok(r.status === 400, `there can only be one fallback (${r.status})`);

  // ---- opting back out -------------------------------------------------
  r = await req('DELETE', `/calendars/${cal.id}`);
  ok(r.status === 204, `a calendar can be removed (${r.status})`);
  p = await get();
  ok(p.analysis.workingDays === true, 'the property then falls back to the group calendar');
  const fb = (await req('GET', '/calendars')).body.find(c => c.propertyId === null);
  await req('DELETE', `/calendars/${fb.id}`);
  p = await get();
  ok(p.analysis.workingDays === false, 'and with no calendar anywhere it counts every day again');
  ok(p.analysis.items[a.id].floatDays === 2, `putting the two days of float back (${p.analysis.items[a.id].floatDays})`);

  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message, e.stack); process.exit(2); });
