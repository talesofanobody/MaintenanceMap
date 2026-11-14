const { PrismaClient } = require(process.env.PRISMA_CLIENT_PATH || '@prisma/client');
const p = new PrismaClient();
(async () => {
  const q = (sql, ...a) => p.$executeRawUnsafe(sql, ...a);
  // Raw SQL throughout: the generated client knows the NEW schema and would
  // reject these tables for missing columns that do not exist yet.
  await q(`INSERT INTO "Property" (id,name,centerLat,centerLng,intakeEnabled,createdAt,updatedAt)
           VALUES ('prop1','Sandals Saint Lucia La Toc',13.99,-61.00,0,datetime('now'),datetime('now'))`);
  await q(`INSERT INTO "Technician" (id,name,trade,color,active,weeklyHours,categories,createdAt,updatedAt)
           VALUES ('tech1','Darren','hvac','#2563eb',1,'[]','["hvac"]',datetime('now'),datetime('now'))`);
  await q(`INSERT INTO "Contractor" (id,name,trade,active,createdAt,updatedAt)
           VALUES ('con1','Dave','general',1,datetime('now'),datetime('now'))`);
  await q(`INSERT INTO "Project" (id,name,description,propertyId,status,createdAt,updatedAt)
           VALUES ('proj1','Project Candyshack','Mold Treatment Plan','prop1','open',datetime('now'),datetime('now'))`);
  await q(`INSERT INTO "Issue" (id,propertyId,title,priority,status,roomName,lat,lng,projectId,workOrderCreated,isEmergency,createdAt,updatedAt)
           VALUES ('iss1','prop1','Mold on bathroom ceiling','high','pending','Room 214',13.99,-61.00,'proj1',0,0,datetime('now'),datetime('now'))`);
  await q(`INSERT INTO "Issue" (id,propertyId,title,priority,status,roomName,lat,lng,workOrderCreated,workOrderNumber,isEmergency,createdAt,updatedAt)
           VALUES ('iss2','prop1','AC not cooling','medium','in_progress','Room 215',13.99,-61.00,1,'WO-8812',0,datetime('now'),datetime('now'))`);
  await q(`INSERT INTO "Cost" (id,issueId,kind,description,amount,quantity,incurredOn,createdAt)
           VALUES ('cost1','iss1','contractor','Fogging',1250.0,1,'2026-11-01',datetime('now'))`);
  console.log('seeded at old schema');
  await p.$disconnect();
})().catch(e => { console.error('SEED FAILED:', e.message); process.exit(1); });
