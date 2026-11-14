-- Slice 1b of v2: the governance around the plan.
--
-- Dependencies between whole projects, blockers as tracked impediments rather than
-- a link kind, and stakeholders with a stated role. Three new tables and nothing
-- else: no existing column is added, altered or read, so this cannot disturb data
-- that is already there.

-- A dependency between two whole projects. Kept apart from IssueLink because the
-- two graphs are read by different people and walked independently.
CREATE TABLE "ProjectLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromProjectId" TEXT NOT NULL,
    "toProjectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'precedes',
    "lagDays" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectLink_fromProjectId_fkey" FOREIGN KEY ("fromProjectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectLink_toProjectId_fkey" FOREIGN KEY ("toProjectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProjectLink_fromProjectId_toProjectId_kind_key" ON "ProjectLink"("fromProjectId", "toProjectId", "kind");
CREATE INDEX "ProjectLink_toProjectId_idx" ON "ProjectLink"("toProjectId");

-- Something in the way, with an owner and an age. Cleared rather than deleted:
-- how long work sat blocked is the most useful thing this table knows.
CREATE TABLE "Blocker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT,
    "projectId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "summary" TEXT NOT NULL,
    "ownerId" TEXT,
    "ownerName" TEXT,
    "raisedBy" TEXT,
    "raisedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" DATETIME,
    "clearedBy" TEXT,
    "resolution" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Blocker_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Blocker_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Blocker_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Blocker_issueId_idx" ON "Blocker"("issueId");
CREATE INDEX "Blocker_projectId_idx" ON "Blocker"("projectId");
CREATE INDEX "Blocker_clearedAt_idx" ON "Blocker"("clearedAt");
CREATE INDEX "Blocker_ownerId_idx" ON "Blocker"("ownerId");

-- Who has an interest, and what kind. External people are first-class: an auditor,
-- a regional engineer and a public-health lab will never have a login here.
CREATE TABLE "Stakeholder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "technicianId" TEXT,
    "name" TEXT,
    "organisation" TEXT,
    "role" TEXT NOT NULL DEFAULT 'informed',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Stakeholder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Stakeholder_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Stakeholder_projectId_idx" ON "Stakeholder"("projectId");
CREATE INDEX "Stakeholder_technicianId_idx" ON "Stakeholder"("technicianId");
