-- Equipment, what it does to other things, and what has been done to it.
--
-- Three new tables and one nullable column. The point of this table set is the
-- middle one: every other part of the app helps record a problem, and this is the
-- part that helps act on one. Which breaker isolates room 214. Which valve shuts
-- this pipe without dropping the block. What else goes dark if I open this.

CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "spaceId" TEXT,
    -- Containment, not supply: a breaker lives inside a panel. What it FEEDS is a
    -- relation, which is a different thing, and the distinction is why both exist.
    "parentId" TEXT,
    "kind" TEXT NOT NULL,
    "ref" TEXT,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    -- Free text: a rating is "80A" for a breaker and "250 kVA" for a generator.
    "rating" TEXT,
    "installedAt" DATETIME,
    "lat" REAL,
    "lng" REAL,
    -- The 90-day air-conditioning standard lives here, on the equipment, which is
    -- what makes "everything overdue" a query rather than a spreadsheet.
    "serviceIntervalDays" INTEGER,
    "lastServicedAt" DATETIME,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Asset_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Asset_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Asset_propertyId_kind_idx" ON "Asset"("propertyId", "kind");
CREATE INDEX "Asset_spaceId_idx" ON "Asset"("spaceId");
CREATE INDEX "Asset_parentId_idx" ON "Asset"("parentId");
CREATE INDEX "Asset_propertyId_lastServicedAt_idx" ON "Asset"("propertyId", "lastServicedAt");

-- A directed graph, deliberately not a tree. One room is fed by a breaker and
-- served by a valve and conditioned by an air handler, each with its own upstream,
-- and the question people ask is the inverse: what feeds this room.
CREATE TABLE "AssetRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromAssetId" TEXT NOT NULL,
    -- Exactly one target: a breaker feeds a sub-panel (asset) and room 214 (space).
    "toAssetId" TEXT,
    "toSpaceId" TEXT,
    -- feeds | isolates | serves | drains | vents
    "kind" TEXT NOT NULL DEFAULT 'feeds',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetRelation_fromAssetId_fkey" FOREIGN KEY ("fromAssetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssetRelation_toAssetId_fkey" FOREIGN KEY ("toAssetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssetRelation_toSpaceId_fkey" FOREIGN KEY ("toSpaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AssetRelation_fromAssetId_idx" ON "AssetRelation"("fromAssetId");
CREATE INDEX "AssetRelation_toAssetId_idx" ON "AssetRelation"("toAssetId");
CREATE INDEX "AssetRelation_toSpaceId_idx" ON "AssetRelation"("toSpaceId");

-- A service or a test. Separate from any fault that prompted it: the weekly
-- generator no-load test is not a fault and does not belong in a fault log, but
-- the record of it is exactly what an insurer asks for.
CREATE TABLE "AssetService" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'service',
    "performedAt" DATETIME NOT NULL,
    "performedBy" TEXT,
    "summary" TEXT NOT NULL,
    -- Anything measured while doing it: run hours, a load reading, an insulation value.
    "reading" REAL,
    "unit" TEXT,
    "passed" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetService_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AssetService_assetId_performedAt_idx" ON "AssetService"("assetId", "performedAt");

-- A finding can name the thing that is faulty, where it is equipment rather than
-- a place. A pump has a service history; "the plant room" does not.
ALTER TABLE "Issue" ADD COLUMN "assetId" TEXT REFERENCES "Asset"("id") ON DELETE SET NULL;
CREATE INDEX "Issue_assetId_idx" ON "Issue"("assetId");
