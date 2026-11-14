const B = (process.env.MM_API || 'http://127.0.0.1:4000') + '/api';
let fail = 0, cookie = '', csrf = '';
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

async function req(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const r = await fetch(B + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const t = r.headers.get('x-csrf-token');
  if (t) csrf = t;
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, body: json };
}

(async () => {
  // --- sign in (first run creates the admin) ---------------------------
  let me = await req('GET', '/auth/me');
  if (me.status !== 200 || !me.body?.user) {
    let r = await req('POST', '/auth/setup', { username: 'khalid', password: 'correcthorsebattery9' });
    if (r.status !== 201 && r.status !== 200) {
      r = await req('POST', '/auth/login', { username: 'khalid', password: 'correcthorsebattery9' });
    }
    ok(r.status === 200 || r.status === 201, `signed in (${r.status})`);
  }
  await req('GET', '/auth/me');

  // --- fixtures --------------------------------------------------------
  const prop = (await req('POST', '/properties', { name: 'Sandals Saint Lucia La Toc' })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });
  const tech = (await req('POST', '/technicians', { name: 'Darren', trade: 'hvac' })).body;
  const c1 = (await req('POST', '/contractors', { name: 'Dave' })).body;
  const c2 = (await req('POST', '/contractors', { name: 'Island Mechanical' })).body;
  const c3 = (await req('POST', '/contractors', { name: 'Castries Cooling' })).body;
  ok(!!prop?.id && !!tech?.id && !!c1?.id, 'fixtures created');

  const mkIssue = async (title, extra = {}) =>
    (await req('POST', '/issues', { propertyId: prop.id, title, lat: 13.99, lng: -61.0, priority: 'medium', ...extra })).body;

  // --- a project as a plan --------------------------------------------
  let proj = (await req('POST', '/projects', {
    name: 'Project Candyshack', description: 'Mold Treatment Plan', propertyId: prop.id,
    ownerId: tech.id, plannedStart: '2026-12-14', plannedEnd: '2027-01-30', status: 'planning',
  })).body;
  ok(proj.status === 'planning', `a project can start in planning (${proj.status})`);
  ok(proj.owner?.name === 'Darren', `with an owner (${proj.owner?.name})`);
  ok(proj.schedule.plannedEnd === '2027-01-30', `and planned dates (${proj.schedule.plannedEnd})`);
  ok(proj.schedule.baselined === false, 'not yet baselined');
  ok(proj.approved === false, 'and not yet approved');

  // --- work breakdown --------------------------------------------------
  const phase = await mkIssue('Phase 1 — Coubaril block', { projectId: proj.id });
  const a = await mkIssue('Fog rooms 101-110', { projectId: proj.id, scheduledFor: '2027-01-05', dueDate: '2027-01-09' });
  const b = await mkIssue('Repaint rooms 101-110', { projectId: proj.id, scheduledFor: '2027-01-10', dueDate: '2027-01-16' });
  let r = await req('PUT', `/issues/${a.id}`, { parentId: phase.id });
  ok(r.status === 200 && r.body.parent?.id === phase.id, `a job can go under a phase (${r.status})`);
  await req('PUT', `/issues/${b.id}`, { parentId: phase.id });

  // cycles refused
  r = await req('PUT', `/issues/${phase.id}`, { parentId: a.id });
  ok(r.status === 400, `a parent cannot be put under its own child (${r.status})`);
  r = await req('PUT', `/issues/${a.id}`, { parentId: a.id });
  ok(r.status === 400, `nor under itself (${r.status})`);

  // --- a milestone ------------------------------------------------------
  const ms = await mkIssue('Chemicals delivered', { projectId: proj.id, dueDate: '2026-12-21' });
  r = await req('PUT', `/issues/${ms.id}`, { isMilestone: true, baselineDue: '2026-12-14' });
  ok(r.status === 200 && r.body.isMilestone === true, 'a job can be marked a milestone');
  ok(r.body.baselineDue === '2026-12-14' && r.body.dueDate === '2026-12-21',
     `with the plan and the slip both visible (${r.body.baselineDue} planned, ${r.body.dueDate} now)`);

  // --- dependencies -----------------------------------------------------
  r = await req('POST', `/issues/${a.id}/links`, { toIssueId: b.id, kind: 'precedes', lagDays: 1 });
  ok(r.status === 201, `fogging precedes painting, with a day to dry (${r.status})`);
  ok(r.body.linksOut?.length === 1 && r.body.linksOut[0].lagDays === 1, 'the lag is stored');
  r = await req('POST', `/issues/${b.id}/links`, { toIssueId: a.id, kind: 'precedes' });
  ok(r.status === 400, `the reverse would deadlock and is refused (${r.status})`);
  ok(/wait for each other/.test(r.body?.error ?? ''), `and says why: "${r.body?.error}"`);
  r = await req('POST', `/issues/${b.id}/links`, { toIssueId: a.id, kind: 'relates' });
  ok(r.status === 201, 'but they may relate to each other both ways');
  r = await req('POST', `/issues/${a.id}/links`, { toIssueId: b.id, kind: 'precedes' });
  ok(r.status === 400, `the same link twice is refused (${r.status})`);

  // --- rollup: progress over leaves ------------------------------------
  await req('PUT', `/issues/${a.id}`, { status: 'completed' });
  proj = (await req('GET', `/projects/${proj.id}`)).body;
  ok(proj.counts.total === 4, `four items on the project (${proj.counts.total})`);
  ok(proj.counts.leaves === 2, `two of them real work (${proj.counts.leaves})`);
  ok(proj.counts.progress === 50, `so 50 per cent, not 25 (${proj.counts.progress})`);
  ok(proj.counts.milestones === 1 && proj.counts.milestonesHit === 0, `milestones counted apart (${proj.counts.milestonesHit}/${proj.counts.milestones})`);

  // --- budget and approval ---------------------------------------------
  r = await req('POST', `/projects/${proj.id}/approve`, { budgetAmount: 50000 });
  ok(r.status === 200 && r.body.approved === true, `the project can be approved (${r.status})`);
  ok(r.body.approvedBy === 'khalid', `by name (${r.body.approvedBy})`);
  ok(r.body.budget.approved === 50000, `with a budget (${r.body.budget.approved})`);

  await req('POST', `/issues/${a.id}/costs`, { kind: 'contractor', description: 'Fogging', amount: 1250, incurredOn: '2027-01-06' });
  proj = (await req('GET', `/projects/${proj.id}`)).body;
  ok(proj.budget.actual === 1250, `spend rolls up from the jobs (${proj.budget.actual})`);
  ok(proj.budget.remaining === 48750, `and remaining follows (${proj.budget.remaining})`);

  // --- baseline ---------------------------------------------------------
  r = await req('POST', `/projects/${proj.id}/baseline`);
  ok(r.status === 200 && r.body.schedule.baselined === true, `the plan can be frozen (${r.status})`);
  ok(r.body.schedule.baselineEnd === '2027-01-30', `at the planned end (${r.body.schedule.baselineEnd})`);
  ok(r.body.schedule.slippageDays === 0, `with no slippage yet (${r.body.schedule.slippageDays})`);
  // Now move the plan and watch the slip appear.
  await req('PUT', `/projects/${proj.id}`, { plannedEnd: '2027-02-13' });
  proj = (await req('GET', `/projects/${proj.id}`)).body;
  ok(proj.schedule.slippageDays === 14, `moving the end shows 14 days of slip (${proj.schedule.slippageDays})`);
  ok(proj.schedule.baselineEnd === '2027-01-30', 'while the baseline stays where it was');
  r = await req('POST', `/projects/${proj.id}/baseline`);
  ok(r.status === 400, `re-baselining needs confirming (${r.status})`);
  r = await req('POST', `/projects/${proj.id}/baseline`, { force: true });
  ok(r.status === 200 && r.body.schedule.slippageDays === 0, 'and with force it re-freezes');
  // The baseline must not be settable through an ordinary edit.
  r = await req('PUT', `/projects/${proj.id}`, { baselineEnd: '2099-01-01' });
  proj = (await req('GET', `/projects/${proj.id}`)).body;
  ok(proj.schedule.baselineEnd !== '2099-01-01', 'a plain edit cannot rewrite the baseline');

  // --- the three-quote rule ---------------------------------------------
  const q1 = (await req('POST', '/quotes', { issueId: b.id, contractorId: c1.id, amount: 4200, status: 'received' })).body;
  let qs = (await req('GET', `/quotes?issueId=${b.id}`)).body;
  ok(qs.state.received === 1 && qs.state.satisfied === false, `one quote does not satisfy the rule (${qs.state.outstanding} outstanding)`);

  r = await req('POST', '/quotes', { issueId: b.id, contractorId: c2.id, status: 'requested' });
  qs = (await req('GET', `/quotes?issueId=${b.id}`)).body;
  ok(qs.state.received === 1, 'a request that has not come back does not count as an answer');

  r = await req('POST', '/quotes', { issueId: b.id, contractorId: c2.id, amount: 'not-a-number', status: 'received' });
  ok(r.status === 400, `a received quote must carry a real amount (${r.status})`);

  // Award on one quote: allowed, but it tells you it is below the rule.
  r = await req('POST', `/quotes/${q1.id}/award`);
  ok(r.status === 200 && r.body.belowRule === true, `awarding on one quote warns rather than blocks (${r.status})`);
  ok(/rule asks for 3/.test(r.body.warning ?? ''), `and says so: "${r.body.warning}"`);

  // c2's quote was only ever requested; make it an answer so three genuinely exist.
  const pending = qs.quotes.find(q => q.status === 'requested');
  r = await req('PUT', `/quotes/${pending.id}`, { status: 'received', amount: 4600 });
  ok(r.status === 200 && r.body.status === 'received', `an outstanding request can be filled in (${r.status})`);
  r = await req('PUT', `/quotes/${pending.id}`, { status: 'received', amount: null });
  ok(r.status === 400, `but not left without an amount (${r.status})`);

  const q3 = (await req('POST', '/quotes', { issueId: b.id, contractorId: c3.id, amount: 3875, status: 'received' })).body;
  qs = (await req('GET', `/quotes?issueId=${b.id}`)).body;
  ok(qs.state.received === 3, `three answers in (${qs.state.received})`);
  ok(qs.state.satisfied === true, 'the rule is satisfied');

  // Awarding the cheaper one moves the award across, leaving exactly one.
  r = await req('POST', `/quotes/${q3.id}/award`);
  ok(r.status === 200 && r.body.belowRule === false, 'awarding with three in place does not warn');
  ok(r.body.state.awarded === 1, `and only one quote is awarded (${r.body.state.awarded})`);
  ok(r.body.quotes.find(q => q.id === q1.id).status === 'received', 'the previous award stepped down');

  // An awarded quote is a record, not a draft.
  r = await req('DELETE', `/quotes/${q3.id}`);
  ok(r.status === 400, `an awarded quote cannot be deleted (${r.status})`);
  r = await req('PUT', `/quotes/${q3.id}`, { amount: 1 });
  ok(r.status === 400, `nor edited (${r.status})`);

  // Committed money shows on the project without double-counting the spend.
  const pq = (await req('POST', '/quotes', { projectId: proj.id, contractorId: c1.id, amount: 12000, status: 'received' })).body;
  await req('POST', `/quotes/${pq.id}/award`);
  proj = (await req('GET', `/projects/${proj.id}`)).body;
  ok(proj.budget.committed === 12000, `an awarded project quote is committed (${proj.budget.committed})`);
  ok(proj.budget.actual === 1250, `spend is still its own figure (${proj.budget.actual})`);
  ok(proj.budget.remaining === 38000, `and remaining takes the larger, not the sum (${proj.budget.remaining})`);

  // --- the EAM is still the record of work orders -----------------------
  r = await req('PUT', `/issues/${b.id}`, { workOrderCreated: true, workOrderNumber: 'WO-9001', workOrderUrl: 'eam.sandals.com/wo/9001' });
  ok(r.status === 200 && r.body.workOrderNumber === 'WO-9001', `a job still carries its EAM work order (${r.body.workOrderNumber})`);
  ok(/^https?:\/\//.test(r.body.workOrderUrl), `with the link normalised (${r.body.workOrderUrl})`);

  // --- deleting a parent must not delete the work -----------------------
  r = await req('DELETE', `/issues/${phase.id}`);
  ok(r.status === 204, `a phase can be deleted (${r.status})`);
  const stillThere = await req('GET', `/issues/${b.id}`);
  ok(stillThere.status === 200, 'and its children survive');
  ok(stillThere.body.parent === null, 'with the parent link cleared');

  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message, e.stack); process.exit(2); });
