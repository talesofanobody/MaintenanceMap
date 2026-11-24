// Fill a database at the schema just before walk-through modes.
const { PrismaClient } = require(process.env.PRISMA_CLIENT_PATH || '@prisma/client');
const p = new PrismaClient();
(async () => {
  const q = (sql) => p.$executeRawUnsafe(sql);
  await q(`INSERT INTO "Property" (id,name,centerLat,centerLng,intakeEnabled,createdAt,updatedAt)
           VALUES ('prop1','Sandals Saint Lucia La Toc',13.99,-61.00,0,datetime('now'),datetime('now'))`);
  await q(`INSERT INTO "Space" (id,propertyId,kind,name,code,sellable,sortOrder,active,createdAt,updatedAt)
           VALUES ('sp_101','prop1','space','101','101',1,0,1,datetime('now'),datetime('now'))`);

  // A walk already finished, and one still open — both from before the choice existed.
  await q(`INSERT INTO "Walkthrough" (id,propertyId,walkedBy,areas,startedAt,completedAt,lat,lng)
           VALUES ('walk_done','prop1','Darren','Floors 12-14',datetime('now','-2 days'),datetime('now','-2 days'),13.99,-61.0)`);
  await q(`INSERT INTO "Walkthrough" (id,propertyId,walkedBy,startedAt,lat,lng)
           VALUES ('walk_open','prop1','Khalid',datetime('now','-1 hours'),13.99,-61.0)`);

  // An ungrouped photo sitting on the open walk, and an issue made from the other.
  await q(`INSERT INTO "Photo" (id,walkthroughId,filename,hasGps,createdAt)
           VALUES ('ph1','walk_open','shot1.jpg',0,datetime('now'))`);
  await q(`INSERT INTO "Issue" (id,propertyId,walkthroughId,title,priority,status,roomName,lat,lng,workOrderCreated,isEmergency,createdAt,updatedAt)
           VALUES ('iss1','prop1','walk_done','Cracked tile','medium','pending','Room 101',13.99,-61.0,0,0,datetime('now'),datetime('now'))`);

  console.log('seeded at the pre-walk-mode schema');
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
