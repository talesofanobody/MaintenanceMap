-- AlterTable
ALTER TABLE "Issue" ADD COLUMN "category" TEXT;
ALTER TABLE "Issue" ADD COLUMN "roomName" TEXT;

-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN "category" TEXT;
ALTER TABLE "Schedule" ADD COLUMN "roomName" TEXT;

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#475569',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "IssueTag" (
    "issueId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("issueId", "tagId"),
    CONSTRAINT "IssueTag_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IssueTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Technician" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "trade" TEXT,
    "phone" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "weeklyHours" TEXT NOT NULL DEFAULT '[{"start":"08:00","end":"16:00"},{"start":"08:00","end":"16:00"},{"start":"08:00","end":"16:00"},{"start":"08:00","end":"16:00"},{"start":"08:00","end":"16:00"},null,null]',
    "categories" TEXT NOT NULL DEFAULT '[]',
    "hourlyRate" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Technician" ("active", "color", "createdAt", "hourlyRate", "id", "name", "notes", "phone", "trade", "updatedAt", "weeklyHours") SELECT "active", "color", "createdAt", "hourlyRate", "id", "name", "notes", "phone", "trade", "updatedAt", "weeklyHours" FROM "Technician";
DROP TABLE "Technician";
ALTER TABLE "new_Technician" RENAME TO "Technician";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "IssueTag_tagId_idx" ON "IssueTag"("tagId");

