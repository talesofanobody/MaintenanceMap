// Slice 1b: dependencies between projects, blockers, stakeholders, and the
// schedule analysis behind the Gantt.
const B = (process.env.MM_API || 'http://127.0.0.1:4000') + '/api';
let fail = 0, cookie = '', csrf = '';
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

async function req(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const r = await fetch(B + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const t = r.headers.get('x-csrf-token'); if (t) csrf = t;
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, body: json };
}

(async () => {
  let me = await req('GET', '/auth/me');
  if (me.status !== 200 || !me.body?.user) {
    let r = await req('POST', '/auth/setup', { username: 'khalid', password: 'correcthorsebattery9' });
    if (r.status !== 201 && r.status !== 200) r = await req('POST', '/auth/login', { username: 'khalid', password: 'correcthorsebattery9' });
    ok(r.status === 200 || r.status === 201, `signed in (${r.status})`);
  }
  await req('GET', '/auth/me');

  const prop = (await req('POST', '/properties', { name: 'La Toc governance ' + Date.now() })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });
  const darren = (await req('POST', '/technicians', { name: 'Darren', trade: 'hvac' })).body;
  const mkIssue = async (title, extra = {}) =>
    (await req('POST', '/issues', { propertyId: prop.id, title, lat: 13.99, lng: -61.0, priority: 'medium', ...extra })).body;

  // ---- dependencies between whole projects ----------------------------
  const survey = (await req('POST', '/projects', { name: 'Mold baseline survey', propertyId: prop.id, plannedStart: '2026-12-14', plannedEnd: '2026-12-20' })).body;
  const treat = (await req('POST', '/projects', { name: 'Mold treatment', propertyId: prop.id, plannedStart: '2027-01-04', plannedEnd: '2027-02-28' })).body;
  let r = await req('POST', `/projects/${survey.id}/links`, { toProjectId: treat.id, kind: 'precedes' });
  ok(r.status === 201, `one project can precede another (${r.status})`);
  ok(r.body.linksOut.length === 1 && r.body.linksOut[0].to.name === 'Mold treatment',
     `and names what follows (${r.body.linksOut[0]?.to?.name})`);
  const back = (await req('GET', `/projects/${treat.id}`)).body;
  ok(back.linksIn.length === 1 && back.linksIn[0].from.name === 'Mold baseline survey',
     'readable from the other end');

  r = await req('POST', `/projects/${treat.id}/links`, { toProjectId: survey.id, kind: 'precedes' });
  ok(r.status === 400 && /wait for each other/.test(r.body?.error ?? ''), `the reverse would deadlock (${r.status})`);
  r = await req('POST', `/projects/${survey.id}/links`, { toProjectId: survey.id });
  ok(r.status === 400, `a project cannot depend on itself (${r.status})`);
  r = await req('POST', `/projects/${survey.id}/links`, { toProjectId: treat.id, kind: 'precedes' });
  ok(r.status === 400, `nor be linked twice the same way (${r.status})`);
  r = await req('POST', `/projects/${survey.id}/links`, { toProjectId: treat.id, kind: 'relates' });
  ok(r.status === 201, 'but a second link of a different kind is fine');

  // ---- stakeholders ----------------------------------------------------
  r = await req('POST', `/projects/${treat.id}/stakeholders`, { technicianId: darren.id, role: 'accountable' });
  ok(r.status === 201, `somebody from the team can be a stakeholder (${r.status})`);
  r = await req('POST', `/projects/${treat.id}/stakeholders`, { name: 'Fred', role: 'approver', organisation: 'Head office' });
  ok(r.status === 201, 'and so can somebody who will never have a login');
  r = await req('POST', `/projects/${treat.id}/stakeholders`, { name: 'CARPHA', role: 'consulted', organisation: 'Public health lab' });
  ok(r.status === 201, 'including an outside organisation');
  r = await req('POST', `/projects/${treat.id}/stakeholders`, { role: 'informed' });
  ok(r.status === 400, `a stakeholder needs a person or a name (${r.status})`);
  r = await req('POST', `/projects/${treat.id}/stakeholders`, { name: 'Nobody', role: 'chief-wizard' });
  ok(r.status === 400, `and a role from the list (${r.status})`);

  let proj = (await req('GET', `/projects/${treat.id}`)).body;
  ok(proj.stakeholders.length === 3, `three stakeholders recorded (${proj.stakeholders.length})`);
  const roles = proj.stakeholders.map(s => s.role).sort().join(',');
  ok(roles === 'accountable,approver,consulted', `with their roles (${roles})`);
  const fred = proj.stakeholders.find(s => s.name === 'Fred');
  r = await req('PUT', `/projects/${treat.id}/stakeholders/${fred.id}`, { role: 'sponsor' });
  ok(r.status === 200, 'a role can be corrected');
  ok(r.body.stakeholders.find(s => s.name === 'Fred').role === 'sponsor', 'and it sticks');

  // ---- blockers: not the same thing as a dependency --------------------
  const job = await mkIssue('Fog rooms 101-110', { projectId: treat.id, scheduledFor: '2027-01-04', dueDate: '2027-01-08' });
  r = await req('POST', '/blockers', { issueId: job.id, kind: 'parts', summary: 'No fogging machine on site', ownerId: darren.id });
  ok(r.status === 201, `a blocker can be raised on a job (${r.status})`);
  const b1 = r.body;
  ok(b1.owner?.name === 'Darren', `with somebody chasing it (${b1.owner?.name})`);
  ok(b1.raisedBy === 'khalid', `and who raised it (${b1.raisedBy})`);
  ok(b1.clearedAt === null, 'open to begin with');

  r = await req('POST', '/blockers', { projectId: treat.id, kind: 'approval', summary: 'Spend not approved', ownerName: 'Fred' });
  ok(r.status === 201, 'and on a whole project');
  const b2 = r.body;
  ok(b2.ownerName === 'Fred' && b2.ownerId === null, 'owned by somebody outside the roster');

  r = await req('POST', '/blockers', { issueId: job.id, summary: 'x', kind: 'nonsense' });
  ok(r.status === 400, `an invented kind is refused (${r.status})`);
  r = await req('POST', '/blockers', { issueId: job.id, kind: 'parts' });
  ok(r.status === 400, `and it has to say what is in the way (${r.status})`);
  r = await req('POST', '/blockers', { issueId: job.id, projectId: treat.id, summary: 'both' });
  ok(r.status === 400, `a blocker blocks one thing, not two (${r.status})`);

  // The project rolls up blockers on its own work, not just its own.
  proj = (await req('GET', `/projects/${treat.id}`)).body;
  ok(proj.openBlockers === 2, `the project counts both its own and its jobs' (${proj.openBlockers})`);
  ok(proj.blockerState.open === 2 && proj.blockerState.cleared === 0, 'and reports the state');
  ok(proj.blockerState.oldestOpenDays === 0, `with the age of the oldest (${proj.blockerState.oldestOpenDays})`);

  // ---- clearing records the resolution and the time taken --------------
  r = await req('POST', `/blockers/${b1.id}/clear`, { resolution: 'Hired one from Castries' });
  ok(r.status === 200 && r.body.clearedAt !== null, `a blocker can be cleared (${r.status})`);
  ok(r.body.resolution === 'Hired one from Castries', 'with what was actually done');
  ok(r.body.clearedBy === 'khalid', `and by whom (${r.body.clearedBy})`);
  r = await req('POST', `/blockers/${b1.id}/clear`, {});
  ok(r.status === 400, `clearing it twice is refused (${r.status})`);
  r = await req('PUT', `/blockers/${b1.id}`, { summary: 'rewritten' });
  ok(r.status === 400, `and a cleared blocker is not edited (${r.status})`);
  r = await req('DELETE', `/blockers/${b1.id}`);
  ok(r.status === 400, `nor deleted — it is the record of the wait (${r.status})`);

  r = await req('POST', `/blockers/${b1.id}/clear`, { cleared: false });
  ok(r.status === 200 && r.body.clearedAt === null, 'it can be reopened if the fix did not hold');
  await req('POST', `/blockers/${b1.id}/clear`, { resolution: 'Bought one' });

  // An open blocker raised in error can go.
  const spurious = (await req('POST', '/blockers', { issueId: job.id, summary: 'Raised by mistake' })).body;
  r = await req('DELETE', `/blockers/${spurious.id}`);
  ok(r.status === 204, `an open blocker raised in error can be removed (${r.status})`);

  const list = (await req('GET', `/blockers?issueId=${job.id}`)).body;
  ok(list.state.cleared === 1, `the cleared one is still counted (${list.state.cleared})`);
  const openList = (await req('GET', `/blockers?issueId=${job.id}&open=1`)).body;
  ok(openList.blockers.length === 0, `and filtering to open gives none (${openList.blockers.length})`);

  // ---- the schedule analysis the chart draws ---------------------------
  const a = await mkIssue('Strip and prep', { projectId: treat.id, scheduledFor: '2027-01-11', dueDate: '2027-01-15' });
  const bb = await mkIssue('Repaint', { projectId: treat.id, scheduledFor: '2027-01-18', dueDate: '2027-01-22' });
  const ms = await mkIssue('Chemicals delivered', { projectId: treat.id, scheduledFor: '2026-12-21', dueDate: '2026-12-21' });
  await req('PUT', `/issues/${ms.id}`, { isMilestone: true });
  await req('POST', `/issues/${a.id}/links`, { toIssueId: bb.id, kind: 'precedes', lagDays: 1 });

  proj = (await req('GET', `/projects/${treat.id}`)).body;
  ok(!!proj.analysis, 'the project carries a schedule analysis');
  ok(proj.analysis.cyclic === false, 'with no loops');
  ok(proj.analysis.projectStart === '2026-12-21', `starting at the earliest dated item (${proj.analysis.projectStart})`);
  ok(proj.analysis.longestChain.length === 2, `the longest chain is the linked pair (${proj.analysis.longestChain.length})`);
  ok(proj.analysis.longestChainDays === 11, `eleven days counting the lag (${proj.analysis.longestChainDays})`);
  ok(Object.keys(proj.analysis.items).length >= 4, `every dated item is analysed (${Object.keys(proj.analysis.items).length})`);
  ok(proj.analysis.violations.length === 0, 'and the plan does not contradict itself');

  // Now make it contradict itself and check it is caught.
  await req('PUT', `/issues/${bb.id}`, { scheduledFor: '2027-01-12', dueDate: '2027-01-16' });
  proj = (await req('GET', `/projects/${treat.id}`)).body;
  ok(proj.analysis.violations.length === 1, `an impossible plan is flagged (${proj.analysis.violations.length})`);
  ok(proj.analysis.violations[0].id === bb.id, 'naming the job that cannot start when planned');
  ok(proj.analysis.violations[0].tooEarlyByDays === 5,
     `and by how many days (${proj.analysis.violations[0].tooEarlyByDays})`);

  // An undated job is reported, not silently dropped.
  const undated = await mkIssue('Snagging, date to be set', { projectId: treat.id });
  proj = (await req('GET', `/projects/${treat.id}`)).body;
  ok(proj.analysis.unscheduled.includes(undated.id), 'an undated job is named as unscheduled');

  // ---- the progress curve comes from real close dates -------------------
  await req('PUT', `/issues/${a.id}`, { status: 'completed' });
  proj = (await req('GET', `/projects/${treat.id}`)).body;
  ok(Array.isArray(proj.curve), 'the project carries a progress curve');
  ok(proj.curve.length === 1, `one point once one job has closed (${proj.curve.length})`);
  ok(proj.curve[0].done === 1, `recording one done (${proj.curve[0].done})`);

  // ---- deleting a project takes its governance with it ------------------
  r = await req('DELETE', `/projects/${survey.id}`);
  ok(r.status === 204, `a project can be deleted (${r.status})`);
  const after = (await req('GET', `/projects/${treat.id}`)).body;
  ok(after.linksIn.length === 0, 'and its links go with it rather than dangling');
  ok(after.stakeholders.length === 3, 'while the other project keeps its stakeholders');

  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message, e.stack); process.exit(2); });
