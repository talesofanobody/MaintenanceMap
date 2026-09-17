-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "userId" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Carry every existing comment over as the first message on its issue, before the
-- column is dropped, so nothing written before the thread existed is lost.
INSERT INTO "Message" ("id", "issueId", "userId", "authorName", "body", "createdAt")
SELECT lower(hex(randomblob(16))), "id", NULL, 'imported', "comments", "createdAt"
FROM "Issue"
WHERE "comments" IS NOT NULL AND trim("comments") <> '';

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Issue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "actionNeeded" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "category" TEXT,
    "roomName" TEXT,
    "workOrderCreated" BOOLEAN NOT NULL DEFAULT false,
    "workOrderNumber" TEXT,
    "workOrderUrl" TEXT,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "closedAt" DATETIME,
    "technicianId" TEXT,
    "estimatedHours" REAL,
    "actualHours" REAL,
    "scheduledFor" TEXT,
    "dueDate" TEXT,
    "escalatedAt" DATETIME,
    "scheduleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Issue_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Issue_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Issue_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Issue" ("actionNeeded", "actualHours", "category", "closedAt", "createdAt", "description", "dueDate", "escalatedAt", "estimatedHours", "id", "lat", "lng", "priority", "propertyId", "roomName", "scheduleId", "scheduledFor", "status", "technicianId", "title", "updatedAt", "workOrderCreated", "workOrderNumber", "workOrderUrl") SELECT "actionNeeded", "actualHours", "category", "closedAt", "createdAt", "description", "dueDate", "escalatedAt", "estimatedHours", "id", "lat", "lng", "priority", "propertyId", "roomName", "scheduleId", "scheduledFor", "status", "technicianId", "title", "updatedAt", "workOrderCreated", "workOrderNumber", "workOrderUrl" FROM "Issue";
DROP TABLE "Issue";
ALTER TABLE "new_Issue" RENAME TO "Issue";
CREATE INDEX "Issue_propertyId_idx" ON "Issue"("propertyId");
CREATE INDEX "Issue_technicianId_idx" ON "Issue"("technicianId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Message_issueId_createdAt_idx" ON "Message"("issueId", "createdAt");

