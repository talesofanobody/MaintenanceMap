-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "actionNeeded" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "technicianId" TEXT,
    "estimatedHours" REAL,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "every" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'months',
    "leadDays" INTEGER NOT NULL DEFAULT 7,
    "nextDue" TEXT NOT NULL,
    "checklist" TEXT NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastCreatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Schedule_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Schedule_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" DATETIME,
    "doneBy" TEXT,
    CONSTRAINT "ChecklistItem_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "workOrderCreated" BOOLEAN NOT NULL DEFAULT false,
    "workOrderNumber" TEXT,
    "workOrderUrl" TEXT,
    "comments" TEXT,
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
INSERT INTO "new_Issue" ("actionNeeded", "actualHours", "closedAt", "comments", "createdAt", "description", "dueDate", "escalatedAt", "estimatedHours", "id", "lat", "lng", "priority", "propertyId", "scheduledFor", "status", "technicianId", "title", "updatedAt", "workOrderCreated", "workOrderNumber", "workOrderUrl") SELECT "actionNeeded", "actualHours", "closedAt", "comments", "createdAt", "description", "dueDate", "escalatedAt", "estimatedHours", "id", "lat", "lng", "priority", "propertyId", "scheduledFor", "status", "technicianId", "title", "updatedAt", "workOrderCreated", "workOrderNumber", "workOrderUrl" FROM "Issue";
DROP TABLE "Issue";
ALTER TABLE "new_Issue" RENAME TO "Issue";
CREATE INDEX "Issue_propertyId_idx" ON "Issue"("propertyId");
CREATE INDEX "Issue_technicianId_idx" ON "Issue"("technicianId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Schedule_propertyId_idx" ON "Schedule"("propertyId");

-- CreateIndex
CREATE INDEX "ChecklistItem_issueId_idx" ON "ChecklistItem"("issueId");
