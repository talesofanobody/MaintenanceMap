-- CreateTable
CREATE TABLE "GuestReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lat" REAL,
    "lng" REAL,
    "reviewedAt" DATETIME,
    "reviewedById" TEXT,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "issueId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuestReport_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GuestReport_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Photo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT,
    "guestReportId" TEXT,
    "filename" TEXT NOT NULL,
    "thumbFilename" TEXT,
    "hasGps" BOOLEAN NOT NULL DEFAULT false,
    "gpsLat" REAL,
    "gpsLng" REAL,
    "takenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Photo_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Photo_guestReportId_fkey" FOREIGN KEY ("guestReportId") REFERENCES "GuestReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Photo" ("createdAt", "filename", "gpsLat", "gpsLng", "hasGps", "id", "issueId", "takenAt", "thumbFilename") SELECT "createdAt", "filename", "gpsLat", "gpsLng", "hasGps", "id", "issueId", "takenAt", "thumbFilename" FROM "Photo";
DROP TABLE "Photo";
ALTER TABLE "new_Photo" RENAME TO "Photo";
CREATE INDEX "Photo_issueId_idx" ON "Photo"("issueId");
CREATE INDEX "Photo_guestReportId_idx" ON "Photo"("guestReportId");
CREATE TABLE "new_Property" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "notes" TEXT,
    "boundary" TEXT,
    "centerLat" REAL,
    "centerLng" REAL,
    "intakeToken" TEXT,
    "intakeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Property" ("address", "boundary", "centerLat", "centerLng", "createdAt", "id", "name", "notes", "updatedAt") SELECT "address", "boundary", "centerLat", "centerLng", "createdAt", "id", "name", "notes", "updatedAt" FROM "Property";
DROP TABLE "Property";
ALTER TABLE "new_Property" RENAME TO "Property";
CREATE UNIQUE INDEX "Property_intakeToken_key" ON "Property"("intakeToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "GuestReport_issueId_key" ON "GuestReport"("issueId");

-- CreateIndex
CREATE INDEX "GuestReport_status_createdAt_idx" ON "GuestReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GuestReport_propertyId_idx" ON "GuestReport"("propertyId");

