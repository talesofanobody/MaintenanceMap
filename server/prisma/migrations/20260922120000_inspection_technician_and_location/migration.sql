-- AlterTable
ALTER TABLE "Photo" ADD COLUMN "gpsSource" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Inspection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateName" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "inspectorId" TEXT,
    "technicianId" TEXT,
    "inspector" TEXT NOT NULL,
    "lat" REAL,
    "lng" REAL,
    "notes" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Inspection_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Inspection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InspectionTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Inspection_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Inspection" ("completedAt", "id", "inspector", "inspectorId", "notes", "propertyId", "roomName", "startedAt", "status", "templateId", "templateName") SELECT "completedAt", "id", "inspector", "inspectorId", "notes", "propertyId", "roomName", "startedAt", "status", "templateId", "templateName" FROM "Inspection";
DROP TABLE "Inspection";
ALTER TABLE "new_Inspection" RENAME TO "Inspection";
CREATE INDEX "Inspection_propertyId_startedAt_idx" ON "Inspection"("propertyId", "startedAt");
CREATE INDEX "Inspection_status_idx" ON "Inspection"("status");
CREATE INDEX "Inspection_technicianId_idx" ON "Inspection"("technicianId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- Existing walks were recorded against a login. Where that login belongs to a
-- technician, attribute the walk to them, so old reports name a person rather
-- than going blank next to the new ones.
UPDATE "Inspection"
   SET "technicianId" = (SELECT "technicianId" FROM "User" WHERE "User"."id" = "Inspection"."inspectorId")
 WHERE "inspectorId" IS NOT NULL
   AND "technicianId" IS NULL;

-- Every location on record so far came out of a photo's own EXIF.
UPDATE "Photo" SET "gpsSource" = 'exif' WHERE "hasGps" = 1 AND "gpsSource" IS NULL;
