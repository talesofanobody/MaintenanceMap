// Walk-through modes, over a populated database.
//
// Every walk recorded before this migration was worked one way: photograph
// everything, sort it afterwards. The column has to say so, because a walk that
// came back reading "direct" would open the wrong screen and lose the pile of
// photos somebody is halfway through sorting.
const { PrismaClient } = require(process.env.PRISMA_CLIENT_PATH || '@prisma/client');
const p = new PrismaClient();
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

(async () => {
  // 1. The old rows survived.
  const done = await p.walkthrough.findUnique({ where: { id: 'walk_done' }, include: { issues: true } });
  ok(!!done, 'the finished walk is still there');
  ok(done.walkedBy === 'Darren', `with who walked it (${done.walkedBy})`);
  ok(done.areas === 'Floors 12-14', 'and what was covered');
  ok(!!done.completedAt, 'still finished');
  ok(done.issues.length === 1 && done.issues[0].title === 'Cracked tile', 'and the issue it produced');

  const open = await p.walkthrough.findUnique({ where: { id: 'walk_open' }, include: { photos: true } });
  ok(!!open && !open.completedAt, 'the open walk is still open');
  ok(open.photos.length === 1, 'with its unsorted photo still on it');

  // 2. Both read as the way they were actually worked.
  ok(done.mode === 'group', `an existing walk reads as photograph-first (${done.mode})`);
  ok(open.mode === 'group', 'including one somebody is halfway through');
  ok(open.spaceId === null && open.roomName === null, 'and carries no location, which it never had');

  // 3. The new mode works.
  const direct = await p.walkthrough.create({
    data: { propertyId: 'prop1', walkedBy: 'Khalid', mode: 'direct', spaceId: 'sp_101', roomName: '101' },
  });
  ok(direct.mode === 'direct', 'a walk can be worked one issue at a time');
  ok(direct.spaceId === 'sp_101', 'with a location on it');

  const logged = await p.issue.create({
    data: {
      propertyId: 'prop1', walkthroughId: direct.id, title: 'Corridor light out',
      spaceId: 'sp_101', roomName: '101', lat: 13.99, lng: -61.0, priority: 'medium',
    },
  });
  ok(logged.walkthroughId === direct.id, 'and issues logged against it');
  ok(logged.spaceId === 'sp_101', 'filed to the location');

  // 4. Deleting a space must not take the walk or the work with it.
  await p.space.delete({ where: { id: 'sp_101' } });
  const after = await p.walkthrough.findUnique({ where: { id: direct.id } });
  ok(!!after, 'deleting a space leaves the walk alone');
  ok(after.spaceId === null, 'with its location cleared rather than dangling');
  ok(after.roomName === '101', 'and the name somebody wrote still readable');

  await p.$disconnect();
  console.log(fail === 0 ? '\nAll migration-walkmode checks passed.' : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
