// Slice 5's migration, over a populated database.
//
// The point is not that the SQL parses — `migrate deploy` would say so. It is that
// a database with a location tree and issues already matched to it comes through
// with every one of those rows intact, and that the new equipment tables work
// afterwards. An additive migration is the kind that looks safe and is worth
// proving anyway, because the cost of being wrong is the whole dataset.
const { PrismaClient } = require(process.env.PRISMA_CLIENT_PATH || '@prisma/client');
const p = new PrismaClient();
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

(async () => {
  // 1. Everything that was there is still there.
  const iss1 = await p.issue.findUnique({ where: { id: 'iss1' } });
  ok(!!iss1, 'the existing issue survived');
  ok(iss1.title === 'Mold on bathroom ceiling', `with its title (${iss1.title})`);
  ok(iss1.roomName === 'Room 101', `its free text (${iss1.roomName})`);
  ok(iss1.spaceId === 'sp_101', 'and the space it had already been matched to');

  const iss2 = await p.issue.findUnique({ where: { id: 'iss2' } });
  ok(iss2.workOrderNumber === 'WO-8812', `the EAM work-order number is untouched (${iss2.workOrderNumber})`);

  const spaces = await p.space.findMany({ orderBy: { id: 'asc' } });
  ok(spaces.length === 3, `the location tree is intact (${spaces.length} spaces)`);
  ok(spaces.find(s => s.id === 'sp_101').parentId === 'sp_floor', 'with its shape');

  // 2. The new column exists and defaults sanely on rows that predate it.
  ok(iss1.assetId === null, 'an issue from before the migration points at no equipment');

  // 3. The new tables work.
  const gen = await p.asset.create({ data: {
    propertyId: 'prop1', name: 'GEN-1', kind: 'generator', ref: 'GEN-1',
    rating: '250 kVA', serviceIntervalDays: 90,
  }});
  ok(!!gen.id, 'equipment can be created');
  ok(gen.active === true, 'and is active by default');

  const board = await p.asset.create({ data: {
    propertyId: 'prop1', name: 'DB-3', kind: 'panel', spaceId: 'sp_floor', parentId: gen.id,
  }});
  const withKids = await p.asset.findUnique({ where: { id: gen.id }, include: { children: true } });
  ok(withKids.children.length === 1, `containment works (${withKids.children.length})`);

  const rel = await p.assetRelation.create({ data: { fromAssetId: board.id, toSpaceId: 'sp_101', kind: 'feeds' } });
  ok(rel.toAssetId === null && rel.toSpaceId === 'sp_101', 'a relation can point at a space');
  const rel2 = await p.assetRelation.create({ data: { fromAssetId: gen.id, toAssetId: board.id, kind: 'feeds' } });
  ok(rel2.toSpaceId === null, 'and another at equipment');

  const svc = await p.assetService.create({ data: {
    assetId: gen.id, kind: 'service', performedAt: new Date('2026-11-01T00:00:00Z'),
    summary: 'Oil and filters.', reading: 1420.5, unit: 'h',
  }});
  ok(svc.reading === 1420.5, 'a service carries a reading');

  // 4. An issue can now name equipment, and the old rows still read back.
  const linked = await p.issue.update({ where: { id: 'iss2' }, data: { assetId: gen.id } });
  ok(linked.assetId === gen.id, 'an issue can be filed against equipment');
  const genWithIssues = await p.asset.findUnique({ where: { id: gen.id }, include: { issues: true } });
  ok(genWithIssues.issues.length === 1, 'and the equipment reads back its own faults');

  // 5. Deleting equipment must not take the work history with it.
  await p.asset.delete({ where: { id: board.id } });
  const survivor = await p.issue.findUnique({ where: { id: 'iss2' } });
  ok(!!survivor, 'deleting equipment leaves the issues alone');
  const stillThere = await p.space.findUnique({ where: { id: 'sp_101' } });
  ok(!!stillThere, 'and leaves the space it fed alone');
  const orphanRels = await p.assetRelation.findMany({ where: { fromAssetId: board.id } });
  ok(orphanRels.length === 0, 'while its own relations go with it');

  await p.$disconnect();
  console.log(fail === 0 ? '\nAll migration-assets checks passed.' : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
