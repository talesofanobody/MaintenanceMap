-- A walk-round of a property, recorded as it happens.
CREATE TABLE "Walkthrough" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "technicianId" TEXT,
    "walkedBy" TEXT NOT NULL,
    "areas" TEXT,
    "notes" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "lat" REAL,
    "lng" REAL,
    CONSTRAINT "Walkthrough_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Walkthrough_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Walkthrough_propertyId_startedAt_idx" ON "Walkthrough"("propertyId", "startedAt");
CREATE INDEX "Walkthrough_completedAt_idx" ON "Walkthrough"("completedAt");

-- Written by hand rather than generated, because `migrate diff` rebuilds a whole
-- table for a change like this in SQLite — copy out, drop, rename — and Issue and
-- Photo are the two tables in here it would hurt most to get wrong. A nullable
-- column with a NULL default needs no rebuild at all, so nothing is copied and
-- every existing row is left exactly where it is.
ALTER TABLE "Photo" ADD COLUMN "walkthroughId" TEXT REFERENCES "Walkthrough"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Photo_walkthroughId_idx" ON "Photo"("walkthroughId");

ALTER TABLE "Issue" ADD COLUMN "walkthroughId" TEXT REFERENCES "Walkthrough"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Issue_walkthroughId_idx" ON "Issue"("walkthroughId");
