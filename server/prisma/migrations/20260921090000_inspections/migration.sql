-- CreateTable
CREATE TABLE "InspectionTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "propertyId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InspectionSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InspectionSection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InspectionTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InspectionPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hint" TEXT,
    "category" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InspectionPoint_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "InspectionSection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateName" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "inspectorId" TEXT,
    "inspector" TEXT NOT NULL,
    "notes" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Inspection_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Inspection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InspectionTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InspectionCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inspectionId" TEXT NOT NULL,
    "pointId" TEXT,
    "section" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hint" TEXT,
    "category" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'ok',
    "severity" TEXT,
    "note" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "issueId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InspectionCheck_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InspectionCheck_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "propertyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
    "projectId" TEXT,
    "scheduleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Issue_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Issue_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Issue_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Issue" ("actionNeeded", "actualHours", "category", "closedAt", "createdAt", "dayOrder", "description", "dueAt", "dueDate", "escalatedAt", "estimatedHours", "id", "isEmergency", "lat", "lng", "orderBeforeShift", "priority", "propertyId", "roomName", "scheduleId", "scheduledFor", "shiftedBy", "status", "technicianId", "title", "updatedAt", "workOrderCreated", "workOrderNumber", "workOrderUrl") SELECT "actionNeeded", "actualHours", "category", "closedAt", "createdAt", "dayOrder", "description", "dueAt", "dueDate", "escalatedAt", "estimatedHours", "id", "isEmergency", "lat", "lng", "orderBeforeShift", "priority", "propertyId", "roomName", "scheduleId", "scheduledFor", "shiftedBy", "status", "technicianId", "title", "updatedAt", "workOrderCreated", "workOrderNumber", "workOrderUrl" FROM "Issue";
DROP TABLE "Issue";
ALTER TABLE "new_Issue" RENAME TO "Issue";
CREATE INDEX "Issue_propertyId_idx" ON "Issue"("propertyId");
CREATE INDEX "Issue_technicianId_idx" ON "Issue"("technicianId");
CREATE INDEX "Issue_projectId_idx" ON "Issue"("projectId");
CREATE TABLE "new_Photo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT,
    "guestReportId" TEXT,
    "checkId" TEXT,
    "filename" TEXT NOT NULL,
    "thumbFilename" TEXT,
    "hasGps" BOOLEAN NOT NULL DEFAULT false,
    "gpsLat" REAL,
    "gpsLng" REAL,
    "takenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Photo_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Photo_guestReportId_fkey" FOREIGN KEY ("guestReportId") REFERENCES "GuestReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Photo_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "InspectionCheck" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Photo" ("createdAt", "filename", "gpsLat", "gpsLng", "guestReportId", "hasGps", "id", "issueId", "takenAt", "thumbFilename") SELECT "createdAt", "filename", "gpsLat", "gpsLng", "guestReportId", "hasGps", "id", "issueId", "takenAt", "thumbFilename" FROM "Photo";
DROP TABLE "Photo";
ALTER TABLE "new_Photo" RENAME TO "Photo";
CREATE INDEX "Photo_issueId_idx" ON "Photo"("issueId");
CREATE INDEX "Photo_guestReportId_idx" ON "Photo"("guestReportId");
CREATE INDEX "Photo_checkId_idx" ON "Photo"("checkId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "InspectionTemplate_active_sortOrder_idx" ON "InspectionTemplate"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "InspectionSection_templateId_position_idx" ON "InspectionSection"("templateId", "position");

-- CreateIndex
CREATE INDEX "InspectionPoint_sectionId_position_idx" ON "InspectionPoint"("sectionId", "position");

-- CreateIndex
CREATE INDEX "Inspection_propertyId_startedAt_idx" ON "Inspection"("propertyId", "startedAt");

-- CreateIndex
CREATE INDEX "Inspection_status_idx" ON "Inspection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionCheck_issueId_key" ON "InspectionCheck"("issueId");

-- CreateIndex
CREATE INDEX "InspectionCheck_inspectionId_position_idx" ON "InspectionCheck"("inspectionId", "position");

-- CreateIndex
CREATE INDEX "InspectionCheck_outcome_idx" ON "InspectionCheck"("outcome");

-- CreateIndex
CREATE INDEX "Project_status_createdAt_idx" ON "Project"("status", "createdAt");

