-- CreateTable
CREATE TABLE "IssueAssignee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssueAssignee_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IssueAssignee_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TimeOff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "technicianId" TEXT NOT NULL,
    "startDay" TEXT NOT NULL,
    "endDay" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'vacation',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TimeOff_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "dueAt" DATETIME,
    "dayOrder" INTEGER,
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "shiftedBy" TEXT,
    "orderBeforeShift" INTEGER,
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
CREATE INDEX "IssueAssignee_technicianId_idx" ON "IssueAssignee"("technicianId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueAssignee_issueId_technicianId_key" ON "IssueAssignee"("issueId", "technicianId");

-- CreateIndex
CREATE INDEX "TimeOff_technicianId_startDay_idx" ON "TimeOff"("technicianId", "startDay");

-- CreateIndex
CREATE INDEX "TimeOff_startDay_endDay_idx" ON "TimeOff"("startDay", "endDay");


-- Every issue that already had a technician becomes a one-person crew, so the new
-- multi-assignment tables agree with the lead field from the first moment.
INSERT INTO "IssueAssignee" ("id", "issueId", "technicianId", "createdAt")
SELECT lower(hex(randomblob(16))), "id", "technicianId", CURRENT_TIMESTAMP
FROM "Issue"
WHERE "technicianId" IS NOT NULL;

-- Existing work was due by the end of its due date. Prisma stores DateTime in SQLite as
-- milliseconds since the epoch, so convert rather than writing the string.
UPDATE "Issue"
SET "dueAt" = strftime('%s', "dueDate" || ' 23:59:59') * 1000
WHERE "dueDate" IS NOT NULL AND "dueAt" IS NULL;
