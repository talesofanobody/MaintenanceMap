const { PrismaClient } = require(process.env.PRISMA_CLIENT_PATH || '@prisma/client');
const p = new PrismaClient();
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };
(async () => {
  // 1. The old rows survived, read through the NEW typed client.
  const iss1 = await p.issue.findUnique({ where: { id: 'iss1' }, include: { costs: true, project: true } });
  ok(!!iss1, 'the existing issue is still there');
  ok(iss1.title === 'Mold on bathroom ceiling', `with its title (${iss1.title})`);
  ok(iss1.roomName === 'Room 214', `its area (${iss1.roomName})`);
  ok(iss1.lat === 13.99 && iss1.lng === -61.00, 'its position');
  ok(iss1.costs.length === 1 && iss1.costs[0].amount === 1250, `and its cost (${iss1.costs[0]?.amount})`);
  ok(iss1.project?.name === 'Project Candyshack', `still linked to its project (${iss1.project?.name})`);

  const iss2 = await p.issue.findUnique({ where: { id: 'iss2' } });
  ok(iss2.workOrderNumber === 'WO-8812', `the EAM work-order number is untouched (${iss2.workOrderNumber})`);

  // 2. The new columns exist and default sanely on rows that predate them.
  ok(iss1.parentId === null, 'an existing issue has no parent');
  ok(iss1.isMilestone === false, 'and is not a milestone');
  ok(iss1.baselineStart === null && iss1.baselineDue === null, 'and has no baseline yet');

  const proj = await p.project.findUnique({ where: { id: 'proj1' } });
  ok(proj.name === 'Project Candyshack', 'the existing project survived');
  ok(proj.ownerId === null && proj.budgetAmount === null, 'with the new plan fields empty');
  ok(proj.approvedAt === null, 'and unapproved');

  // 3. Hierarchy works, including the self-reference.
  const phase = await p.issue.create({ data: {
    propertyId: 'prop1', title: 'Phase 1 — Coubaril block', lat: 13.99, lng: -61.0,
    projectId: 'proj1', priority: 'medium',
  }});
  await p.issue.update({ where: { id: 'iss1' }, data: { parentId: phase.id } });
  const withKids = await p.issue.findUnique({ where: { id: phase.id }, include: { children: true } });
  ok(withKids.children.length === 1 && withKids.children[0].id === 'iss1', `a child hangs off a parent (${withKids.children.length})`);

  // 4. A milestone.
  const ms = await p.issue.create({ data: {
    propertyId: 'prop1', title: 'Chemicals delivered', lat: 13.99, lng: -61.0,
    isMilestone: true, parentId: phase.id, baselineDue: '2026-12-14', dueDate: '2026-12-21',
  }});
  ok(ms.isMilestone === true, 'a milestone can be created');
  ok(ms.baselineDue === '2026-12-14' && ms.dueDate === '2026-12-21',
     `with the plan and the current date both kept (${ms.baselineDue} planned, ${ms.dueDate} now)`);

  // 5. The dependency graph.
  await p.issueLink.create({ data: { fromIssueId: ms.id, toIssueId: 'iss1', kind: 'precedes', lagDays: 1 } });
  const out = await p.issue.findUnique({ where: { id: ms.id }, include: { linksOut: true } });
  const inn = await p.issue.findUnique({ where: { id: 'iss1' }, include: { linksIn: true } });
  ok(out.linksOut.length === 1 && out.linksOut[0].lagDays === 1, 'a precedes link with lag is stored');
  ok(inn.linksIn.length === 1, 'and is readable from the other end');
  let dup = false;
  try { await p.issueLink.create({ data: { fromIssueId: ms.id, toIssueId: 'iss1', kind: 'precedes' } }); }
  catch { dup = true; }
  ok(dup, 'the same link cannot be added twice');

  // 6. Quotes, and the three-quote rule as a countable thing.
  for (const [n, amt] of [['Q1', 4200], ['Q2', 3875], ['Q3', 5100]]) {
    await p.quote.create({ data: { issueId: 'iss1', contractorId: 'con1', amount: amt, reference: n, status: 'received' } });
  }
  const quoted = await p.issue.findUnique({ where: { id: 'iss1' }, include: { quotes: true } });
  ok(quoted.quotes.length === 3, `three quotes sit on the job (${quoted.quotes.length})`);
  ok(quoted.quotes.filter(q => q.status === 'received').length === 3, 'all received');

  // A contractor with a quote cannot be deleted out from under it.
  let restricted = false;
  try { await p.contractor.delete({ where: { id: 'con1' } }); } catch { restricted = true; }
  ok(restricted, 'a contractor holding a quote cannot be deleted');

  // 7. Deleting a parent must not take its children with it.
  await p.issue.delete({ where: { id: phase.id } });
  const orphan = await p.issue.findUnique({ where: { id: 'iss1' } });
  ok(!!orphan, 'deleting a parent leaves the child in place');
  ok(orphan.parentId === null, 'with its parent reference cleared, not dangling');

  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
  await p.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message); process.exit(2); });
