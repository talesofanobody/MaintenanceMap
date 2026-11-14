// The tree rules: a parent is finished only when its sub-tasks are, its dates
// come from them, and the construction dependency types work end to end.
const B = (process.env.MM_API || 'http://127.0.0.1:4000') + '/api';
const { session } = require('./session');
let fail = 0;
let req;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };
(async () => {
  ({ req } = await session());
  ok(true, 'signed in (shared session)');

  const stamp = Date.now();
  const prop = (await req('POST', '/properties', { name: 'Construction ' + stamp })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });
  const proj = (await req('POST', '/projects', { name: 'New block ' + stamp, propertyId: prop.id, status: 'open' })).body;
  const mk = async (title, extra = {}) => (await req('POST', '/issues', {
    propertyId: prop.id, title, lat: 13.99, lng: -61.0, priority: 'medium', projectId: proj.id, ...extra,
  })).body;
  const get = async (id) => (await req('GET', `/issues/${id}`)).body;
  const proj_ = async () => (await req('GET', `/projects/${proj.id}`)).body;

  // ---- a three-level tree, as a real programme would be ---------------
  const programme = await mk('Substructure package');
  const piling = await mk('Piling');
  const caps = await mk('Pile caps');
  const rig = await mk('Mobilise rig', { scheduledFor: '2027-03-01', dueDate: '2027-03-05' });
  const bore = await mk('Bore and cast piles', { scheduledFor: '2027-03-08', dueDate: '2027-03-26' });
  const capPour = await mk('Pour caps', { scheduledFor: '2027-04-05', dueDate: '2027-04-16' });
  await req('PUT', `/issues/${piling.id}`, { parentId: programme.id });
  await req('PUT', `/issues/${caps.id}`, { parentId: programme.id });
  await req('PUT', `/issues/${rig.id}`, { parentId: piling.id });
  await req('PUT', `/issues/${bore.id}`, { parentId: piling.id });
  await req('PUT', `/issues/${capPour.id}`, { parentId: caps.id });
  ok(true, 'a three-level work breakdown is built');

  // ---- the rule: a parent is not finished until its sub-tasks are ------
  let r = await req('PUT', `/issues/${piling.id}`, { status: 'completed' });
  ok(r.status === 400, `a phase cannot be finished with open tasks under it (${r.status})`);
  ok(/still open/.test(r.body?.error ?? ''), `and says why: "${r.body?.error?.slice(0, 80)}…"`);
  ok(Array.isArray(r.body?.openChildren) && r.body.openChildren.length === 2,
     `naming what is outstanding (${r.body?.openChildren?.length})`);
  ok((await get(rig.id)).status === 'pending', 'and refusing did not quietly close the children');

  r = await req('PUT', `/issues/${programme.id}`, { status: 'completed' });
  ok(r.status === 400, `nor can the package above it (${r.status})`);

  // Finish the leaves, bottom up, and the phase becomes closable.
  await req('PUT', `/issues/${rig.id}`, { status: 'completed' });
  r = await req('PUT', `/issues/${piling.id}`, { status: 'completed' });
  ok(r.status === 400, 'one of two done is still not enough');
  await req('PUT', `/issues/${bore.id}`, { status: 'completed' });
  r = await req('PUT', `/issues/${piling.id}`, { status: 'completed' });
  ok(r.status === 200, `with both done the phase closes (${r.status})`);
  ok(r.body.percentComplete === 100, 'and reads as fully complete');

  // A cancelled task counts as settled, not as outstanding.
  const extra = await mk('Descoped task');
  await req('PUT', `/issues/${extra.id}`, { parentId: caps.id });
  r = await req('PUT', `/issues/${caps.id}`, { status: 'completed' });
  ok(r.status === 400, 'a descoped task still blocks until it is settled');
  await req('PUT', `/issues/${extra.id}`, { status: 'cancelled' });
  await req('PUT', `/issues/${capPour.id}`, { status: 'completed' });
  r = await req('PUT', `/issues/${caps.id}`, { status: 'completed' });
  ok(r.status === 200, `cancelling it settles it (${r.status})`);

  // ---- the mirror: reopening a task reopens the phases above it --------
  r = await req('PUT', `/issues/${programme.id}`, { status: 'completed' });
  ok(r.status === 200, 'the whole package can now be finished');
  r = await req('PUT', `/issues/${bore.id}`, { status: 'in_progress' });
  ok(r.status === 200, `a task can be reopened (${r.status})`);
  ok((await get(piling.id)).status !== 'completed', 'which reopens the phase above it');
  ok((await get(programme.id)).status !== 'completed', 'and the package above that');

  // ---- forcing it, for work descoped part-way through -----------------
  r = await req('PUT', `/issues/${piling.id}`, { status: 'completed', force: true });
  ok(r.status === 200, `force closes it over open work (${r.status})`);
  const act = (await req('GET', '/activity?limit=20')).body;
  const rows = Array.isArray(act) ? act : act?.entries ?? [];
  ok(rows.some(a => a.action === 'issue.closed_over_open_children'), 'and that is recorded as its own action');

  // ---- a parent's dates come from its children ------------------------
  await req('PUT', `/issues/${bore.id}`, { status: 'completed' });
  let p = await proj_();
  const byId = Object.fromEntries(p.issues.map(i => [i.id, i]));
  ok(byId[piling.id].rolled.isSummary === true, 'a phase is marked as a summary');
  ok(byId[piling.id].rolled.start === '2027-03-01', `starting when its first task starts (${byId[piling.id].rolled.start})`);
  ok(byId[piling.id].rolled.end === '2027-03-26', `and ending with its last (${byId[piling.id].rolled.end})`);
  ok(byId[programme.id].rolled.start === '2027-03-01' && byId[programme.id].rolled.end === '2027-04-16',
     `the package spans the grandchildren (${byId[programme.id].rolled.start} to ${byId[programme.id].rolled.end})`);
  ok(byId[rig.id].rolled.isSummary === false, 'a task is not a summary');

  // The schedule uses the rolled dates, so a phase is never on the chain.
  ok(!p.analysis.items[piling.id], 'a phase takes no part in the schedule analysis');
  ok(p.analysis.summaries.includes(piling.id), 'and is reported as a summary rather than as undated');

  // ---- per-cent complete ----------------------------------------------
  const fresh = await mk('Blockwork', { scheduledFor: '2027-05-03', dueDate: '2027-05-14' });
  r = await req('PUT', `/issues/${fresh.id}`, { percentComplete: 40 });
  ok(r.status === 200 && r.body.percentComplete === 40, `progress can be reported part-way (${r.body?.percentComplete})`);
  r = await req('PUT', `/issues/${fresh.id}`, { percentComplete: 140 });
  ok(r.status === 400, `and nonsense is refused (${r.status})`);
  r = await req('PUT', `/issues/${fresh.id}`, { percentComplete: null });
  ok(r.status === 200 && r.body.percentComplete === null, 'it can be cleared back to nobody having said');
  await req('PUT', `/issues/${fresh.id}`, { percentComplete: 50 });
  r = await req('PUT', `/issues/${fresh.id}`, { status: 'completed' });
  ok(r.body.percentComplete === 100, 'finishing a task sets it to 100 whatever was last reported');

  // ---- the construction dependency types -------------------------------
  // In a project of their own: "the longest chain" is project-wide, so unrelated
  // work elsewhere would decide it and the assertion would be about nothing.
  const cproj = (await req('POST', '/projects', { name: 'Overlapping works ' + stamp, propertyId: prop.id, status: 'open' })).body;
  const cmk = async (title, extra = {}) => (await req('POST', '/issues', {
    propertyId: prop.id, title, lat: 13.99, lng: -61.0, priority: 'medium', projectId: cproj.id, ...extra,
  })).body;
  const dig = await cmk('Excavate', { scheduledFor: '2027-06-01', dueDate: '2027-06-12' });
  const shore = await cmk('Shoring', { scheduledFor: '2027-06-03', dueDate: '2027-06-16' });
  r = await req('POST', `/issues/${dig.id}/links`, { toIssueId: shore.id, kind: 'starts_after_start', lagDays: 2 });
  ok(r.status === 201, `start-to-start is accepted (${r.status})`);
  ok(r.body.linksOut.find(l => l.kind === 'starts_after_start'), 'and stored as such');

  const pour = await cmk('Pour slab', { scheduledFor: '2027-06-17', dueDate: '2027-06-26' });
  const cure = await cmk('Cure slab', { scheduledFor: '2027-06-24', dueDate: '2027-07-03' });
  r = await req('POST', `/issues/${pour.id}/links`, { toIssueId: cure.id, kind: 'finishes_after_finish', lagDays: 7 });
  ok(r.status === 201, `finish-to-finish is accepted (${r.status})`);

  r = await req('POST', `/issues/${dig.id}/links`, { toIssueId: pour.id, kind: 'reverse_telepathy' });
  ok(r.status === 400, `an invented kind is refused (${r.status})`);

  // A loop through the new kinds must still be caught.
  r = await req('POST', `/issues/${shore.id}/links`, { toIssueId: dig.id, kind: 'starts_after_start' });
  ok(r.status === 400, `a loop through start-to-start is refused too (${r.status})`);

  const cproj_ = async () => (await req('GET', `/projects/${cproj.id}`)).body;
  let cp = await cproj_();
  ok(cp.analysis.violations.length === 0, 'the construction plan is internally consistent');
  // Pour -> cure, held apart at the finish, is the longest run here: ten days of
  // pouring, then the cure finishing a week after it.
  ok(cp.analysis.longestChain.length === 2, `the chain is a linked pair (${cp.analysis.longestChain.length})`);
  ok(cp.analysis.longestChain[0] === pour.id && cp.analysis.longestChain[1] === cure.id,
     'running through the finish-to-finish pair');
  ok(cp.analysis.longestChainDays === 17, `seventeen days, the pour plus the lag (${cp.analysis.longestChainDays})`);
  // The start-to-start pair genuinely overlaps rather than queueing.
  const digItem = cp.analysis.items[dig.id];
  const shoreItem = cp.analysis.items[shore.id];
  ok(shoreItem.earliestStart - digItem.earliestStart === 2,
     'and the start-to-start pair runs alongside, offset by its lag');
  ok(shoreItem.earliestStart <= digItem.earliestFinish, 'overlapping rather than following on');

  // Pull the shoring to the same day as the dig and it should be caught.
  await req('PUT', `/issues/${shore.id}`, { scheduledFor: '2027-06-01' });
  cp = await cproj_();
  const v = cp.analysis.violations.find(x => x.id === shore.id);
  ok(!!v && v.tooEarlyByDays === 2, `starting it without the offset is two days early (${v?.tooEarlyByDays})`);

  // A lone long task with no dependencies is still "the longest" — correct, but
  // it is not a chain, and the wording has to admit that.
  const solo = (await req('POST', '/projects', { name: 'One big task ' + stamp, propertyId: prop.id })).body;
  await req('POST', '/issues', { propertyId: prop.id, title: 'Single long pour', lat: 13.99, lng: -61.0, priority: 'medium', projectId: solo.id, scheduledFor: '2027-07-01', dueDate: '2027-07-31' });
  const sp = (await req('GET', `/projects/${solo.id}`)).body;
  ok(sp.analysis.longestChain.length === 1, 'one unlinked task is reported as the longest on its own');
  ok(sp.analysis.longestChainDays === 31, `all 31 days of it (${sp.analysis.longestChainDays})`);

  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message, e.stack); process.exit(2); });
