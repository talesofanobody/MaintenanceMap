-- Archiving: a finished walk closed off as a record, with the raw photos
-- released once nothing needs them any more.
ALTER TABLE "Inspection" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "Inspection" ADD COLUMN "summary" TEXT;

-- The type of walk, and what to put in the empty area field for it.
ALTER TABLE "InspectionTemplate" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'checklist';
ALTER TABLE "InspectionTemplate" ADD COLUMN "areaHint" TEXT;

-- A general walk covers ground rather than one room, so each finding says where
-- it is rather than inheriting the walk's area.
ALTER TABLE "InspectionCheck" ADD COLUMN "area" TEXT;

CREATE INDEX "Inspection_archivedAt_idx" ON "Inspection"("archivedAt");

-- Every column here is nullable or carries a default, so SQLite adds them in
-- place. Nothing is copied and no table is rebuilt, which is what keeps this
-- safe to run against a database with real inspections in it.
