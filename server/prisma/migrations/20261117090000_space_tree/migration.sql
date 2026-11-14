-- Where something is, as a tree rather than a sentence.
--
-- One new table and two nullable columns. The free-text roomName on Issue and
-- Inspection is deliberately left exactly as it is: three hundred and forty rooms
-- of history were typed by hand, and a migration that guessed which string meant
-- which room would be wrong in ways nobody could audit afterwards. The two coexist
-- and the text gets matched up as somebody gets to it.

CREATE TABLE "Space" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    -- Null for a top-level block. A floor hangs off a block, a room off a floor.
    "parentId" TEXT,
    -- block | floor | space
    "kind" TEXT NOT NULL DEFAULT 'space',
    "name" TEXT NOT NULL,
    -- The short reference people actually say: "214", "P3", "DB-2".
    "code" TEXT,
    -- Whether this is a room that can be sold. Back of house is excluded from the
    -- sell-status round by not being sellable, rather than by a list of exceptions.
    "sellable" BOOLEAN NOT NULL DEFAULT false,
    "sellStatus" TEXT,
    "lat" REAL,
    "lng" REAL,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Space_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Space_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Two things of the same name under one parent is a typo, not a plan.
CREATE UNIQUE INDEX "Space_propertyId_parentId_name_key" ON "Space"("propertyId", "parentId", "name");
CREATE INDEX "Space_propertyId_kind_idx" ON "Space"("propertyId", "kind");
CREATE INDEX "Space_parentId_sortOrder_idx" ON "Space"("parentId", "sortOrder");
CREATE INDEX "Space_propertyId_sellable_sellStatus_idx" ON "Space"("propertyId", "sellable", "sellStatus");

-- Beside the free text, never instead of it.
ALTER TABLE "Issue" ADD COLUMN "spaceId" TEXT REFERENCES "Space"("id") ON DELETE SET NULL;
CREATE INDEX "Issue_spaceId_idx" ON "Issue"("spaceId");

ALTER TABLE "Inspection" ADD COLUMN "spaceId" TEXT REFERENCES "Space"("id") ON DELETE SET NULL;
CREATE INDEX "Inspection_spaceId_idx" ON "Inspection"("spaceId");
