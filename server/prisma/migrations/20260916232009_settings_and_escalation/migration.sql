-- AlterTable
ALTER TABLE "Issue" ADD COLUMN "escalatedAt" DATETIME;

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "json" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
