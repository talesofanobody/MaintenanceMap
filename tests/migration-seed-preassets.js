// Fill a database at the PRE-ASSETS schema with the rows that matter.
//
// Raw SQL throughout: the generated client knows the new schema and would reject
// these tables for columns that do not exist yet.
const { PrismaClient } = require(process.env.PRISMA_CLIENT_PATH || '@prisma/client');
const p = new PrismaClient();
(async () => {
  const q = (sql) => p.$executeRawUnsafe(sql);
  await q(`INSERT INTO "Property" (id,name,centerLat,centerLng,intakeEnabled,createdAt,updatedAt)
           VALUES ('prop1','Sandals Saint Lucia La Toc',13.99,-61.00,0,datetime('now'),datetime('now'))`);

  // A location tree, because assets hang off it and the migration must not disturb it.
  await q(`INSERT INTO "Space" (id,propertyId,kind,name,sellable,sortOrder,active,createdAt,updatedAt)
           VALUES ('sp_block','prop1','block','Coubaril',0,0,1,datetime('now'),datetime('now'))`);
  await q(`INSERT INTO "Space" (id,propertyId,parentId,kind,name,sellable,sortOrder,active,createdAt,updatedAt)
           VALUES ('sp_floor','prop1','sp_block','floor','Floor 1',0,0,1,datetime('now'),datetime('now'))`);
  await q(`INSERT INTO "Space" (id,propertyId,parentId,kind,name,code,sellable,sortOrder,active,createdAt,updatedAt)
           VALUES ('sp_101','prop1','sp_floor','space','101','101',1,0,1,datetime('now'),datetime('now'))`);

  // Work already on the books, one of it already matched to the tree.
  await q(`INSERT INTO "Issue" (id,propertyId,title,priority,status,roomName,spaceId,lat,lng,workOrderCreated,isEmergency,createdAt,updatedAt)
           VALUES ('iss1','prop1','Mold on bathroom ceiling','high','pending','Room 101','sp_101',13.99,-61.00,0,0,datetime('now'),datetime('now'))`);
  await q(`INSERT INTO "Issue" (id,propertyId,title,priority,status,roomName,lat,lng,workOrderCreated,workOrderNumber,isEmergency,createdAt,updatedAt)
           VALUES ('iss2','prop1','AC not cooling','medium','in_progress','Room 215',13.99,-61.00,1,'WO-8812',0,datetime('now'),datetime('now'))`);

  console.log('seeded at the pre-assets schema');
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
