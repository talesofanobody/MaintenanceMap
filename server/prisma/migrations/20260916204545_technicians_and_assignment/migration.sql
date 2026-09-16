-- CreateTable
CREATE TABLE "Technician" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "trade" TEXT,
    "phone" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "weeklyHours" TEXT NOT NULL DEFAULT '[8,8,8,8,8,0,0]',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Issue_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Issue_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Issue" ("actionNeeded", "closedAt", "comments", "createdAt", "description", "id", "lat", "lng", "priority", "propertyId", "status", "title", "updatedAt", "workOrderCreated", "workOrderNumber", "workOrderUrl") SELECT "actionNeeded", "closedAt", "comments", "createdAt", "description", "id", "lat", "lng", "priority", "propertyId", "status", "title", "updatedAt", "workOrderCreated", "workOrderNumber", "workOrderUrl" FROM "Issue";
DROP TABLE "Issue";
ALTER TABLE "new_Issue" RENAME TO "Issue";
CREATE INDEX "Issue_propertyId_idx" ON "Issue"("propertyId");
CREATE INDEX "Issue_technicianId_idx" ON "Issue"("technicianId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
