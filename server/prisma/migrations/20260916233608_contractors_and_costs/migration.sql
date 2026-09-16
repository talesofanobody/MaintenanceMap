-- AlterTable
ALTER TABLE "Technician" ADD COLUMN "hourlyRate" REAL;

-- CreateTable
CREATE TABLE "Contractor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "trade" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Cost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'parts',
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "contractorId" TEXT,
    "invoiceRef" TEXT,
    "incurredOn" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Cost_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Cost_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Cost_issueId_idx" ON "Cost"("issueId");

-- CreateIndex
CREATE INDEX "Cost_contractorId_idx" ON "Cost"("contractorId");
