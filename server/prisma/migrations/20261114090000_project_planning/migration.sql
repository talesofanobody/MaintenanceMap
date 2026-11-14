-- Slice 1 of v2: turn Project into a plan and Issue into a work package.
--
-- Additive only, deliberately. Every column added here is nullable or has a
-- default, and the two new tables are new, so SQLite adds them in place without
-- rebuilding a table. Nothing existing is read, rewritten or reordered, which is
-- what makes this safe to run against a live database holding real inspections.
--
-- Notably NOT done here: making Issue.lat/lng nullable. A work item does not
-- inherently have a location and the honest model would allow none — but those are
-- NOT NULL today, so relaxing them rebuilds the largest table in the schema and
-- every client read assumes they are present. A parent issue and a milestone both
-- carry a position instead; the map is what decides not to draw a milestone.

-- Work breakdown: a parent is an ordinary issue that has children.
ALTER TABLE "Issue" ADD COLUMN "parentId" TEXT REFERENCES "Issue"("id") ON DELETE SET NULL;

-- A dateline with no duration.
ALTER TABLE "Issue" ADD COLUMN "isMilestone" BOOLEAN NOT NULL DEFAULT 0;

-- The plan as agreed, kept apart from the current dates so slippage stays visible.
ALTER TABLE "Issue" ADD COLUMN "baselineStart" TEXT;
ALTER TABLE "Issue" ADD COLUMN "baselineDue" TEXT;

CREATE INDEX "Issue_parentId_idx" ON "Issue"("parentId");

-- Project becomes a plan rather than a label.
ALTER TABLE "Project" ADD COLUMN "ownerId" TEXT REFERENCES "Technician"("id") ON DELETE SET NULL;
ALTER TABLE "Project" ADD COLUMN "plannedStart" TEXT;
ALTER TABLE "Project" ADD COLUMN "plannedEnd" TEXT;
ALTER TABLE "Project" ADD COLUMN "baselineStart" TEXT;
ALTER TABLE "Project" ADD COLUMN "baselineEnd" TEXT;
ALTER TABLE "Project" ADD COLUMN "budgetAmount" REAL;
ALTER TABLE "Project" ADD COLUMN "approvedBy" TEXT;
ALTER TABLE "Project" ADD COLUMN "approvedAt" DATETIME;

CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");

-- The dependency graph. A job can block several others and follow several others,
-- so this is edges, not an ordering column.
CREATE TABLE "IssueLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromIssueId" TEXT NOT NULL,
    "toIssueId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'precedes',
    "lagDays" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssueLink_fromIssueId_fkey" FOREIGN KEY ("fromIssueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IssueLink_toIssueId_fkey" FOREIGN KEY ("toIssueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "IssueLink_fromIssueId_toIssueId_kind_key" ON "IssueLink"("fromIssueId", "toIssueId", "kind");
CREATE INDEX "IssueLink_toIssueId_idx" ON "IssueLink"("toIssueId");

-- Quotes, so the three-quote rule is a field rather than a recollection.
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT,
    "projectId" TEXT,
    "contractorId" TEXT NOT NULL,
    "amount" REAL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "reference" TEXT,
    "notes" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" DATETIME,
    "awardedAt" DATETIME,
    "decidedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Quote_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Quote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Quote_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Quote_issueId_idx" ON "Quote"("issueId");
CREATE INDEX "Quote_projectId_idx" ON "Quote"("projectId");
CREATE INDEX "Quote_contractorId_idx" ON "Quote"("contractorId");
