-- Daily utility readings, and the invoices that price them.
--
-- Three new tables, nothing existing touched.
--
-- The shape follows the rules the department already works to rather than
-- inventing any: readings at 02:00 and 05:00, a day that runs 05:00 to 05:00, site
-- electricity as the sum of the meters that roll up, propane and diesel entered as
-- a percentage of a tank, and a water tank entered as a height that is a fraction
-- of its maximum. Each of those is a column here because each of them is a thing
-- somebody will get wrong otherwise.

CREATE TABLE "MeterPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    -- direct | percentage | tank_height
    "entryMode" TEXT NOT NULL DEFAULT 'direct',
    -- The unit the stored value is in. Never assumed, which is what stops the
    -- litres-or-gallons question from being a global one.
    "unit" TEXT NOT NULL,
    "capacityLitres" REAL,
    "tankMaxHeightMm" REAL,
    "includeInSiteTotal" BOOLEAN NOT NULL DEFAULT true,
    -- A running total that only climbs, versus a level that goes up and down.
    -- Consumption is a difference for the first and a drop for the second.
    "cumulative" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MeterPoint_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MeterPoint_propertyId_kind_idx" ON "MeterPoint"("propertyId", "kind");

CREATE TABLE "Reading" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meterPointId" TEXT NOT NULL,
    "takenAt" DATETIME NOT NULL,
    -- "0200" or "0500". Stored, not derived: a round taken late is still that round.
    "slot" TEXT NOT NULL,
    -- The 05:00-to-05:00 day, worked out on write. A reading at 02:00 belongs to
    -- the day that began at 05:00 the morning before.
    "readingDay" TEXT NOT NULL,
    -- What was read, and the same thing converted. Both, always, so a conversion
    -- can be checked or corrected without losing what somebody wrote down.
    "rawValue" REAL NOT NULL,
    "value" REAL NOT NULL,
    "takenBy" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reading_meterPointId_fkey" FOREIGN KEY ("meterPointId") REFERENCES "MeterPoint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One reading per point per round per day: a second one is a correction to the
-- first, not another data point.
CREATE UNIQUE INDEX "Reading_meterPointId_readingDay_slot_key" ON "Reading"("meterPointId", "readingDay", "slot");
CREATE INDEX "Reading_meterPointId_readingDay_idx" ON "Reading"("meterPointId", "readingDay");
CREATE INDEX "Reading_readingDay_idx" ON "Reading"("readingDay");

CREATE TABLE "UtilityInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "quantity" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UtilityInvoice_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UtilityInvoice_propertyId_kind_periodStart_periodEnd_key" ON "UtilityInvoice"("propertyId", "kind", "periodStart", "periodEnd");
CREATE INDEX "UtilityInvoice_propertyId_kind_periodStart_idx" ON "UtilityInvoice"("propertyId", "kind", "periodStart");
