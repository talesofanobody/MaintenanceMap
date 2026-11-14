-- A number on an inspection check.
--
-- Every point was a three-way judgement: fine, flag it, not applicable. But a
-- chlorine level, an outlet temperature, a fridge temperature and a generator
-- run-hour are numbers, and for those the trend matters more than whether today's
-- reading passed. The Legionella matrix, pool chemistry, the generator tests and
-- the kitchen cold chain all want this, which is why it comes before any new
-- checklist content is written against the old shape.
--
-- Additive only: six nullable columns across two tables. Nothing existing is read
-- or rewritten, so this is safe against a populated database.

-- What a template point expects. A unit is what makes a point a measurement;
-- either end of the range may be open, since a hot-water outlet has a minimum and
-- no useful maximum while a fridge has both.
ALTER TABLE "InspectionPoint" ADD COLUMN "unit" TEXT;
ALTER TABLE "InspectionPoint" ADD COLUMN "minOk" REAL;
ALTER TABLE "InspectionPoint" ADD COLUMN "maxOk" REAL;

-- What was actually read, with the range that applied at the time. The range is
-- snapshotted for the same reason the label and hint already are: a report from six
-- months ago should show the question that was asked, not today's version of it.
ALTER TABLE "InspectionCheck" ADD COLUMN "value" REAL;
ALTER TABLE "InspectionCheck" ADD COLUMN "unit" TEXT;
ALTER TABLE "InspectionCheck" ADD COLUMN "minOk" REAL;
ALTER TABLE "InspectionCheck" ADD COLUMN "maxOk" REAL;

-- A data correction, not a schema change.
--
-- The twelve-point private pool section was categorised across plumbing, general,
-- fire_safety, hvac and electrical, and never pool_spa — so a flagged pool pump
-- proposed a plumber rather than the pool technician, the category being what
-- drives the assignment suggestion. The seed content is fixed, but the template
-- top-up only ever ADDS points: it will not change one that already exists, by
-- design, so that a point somebody deliberately edited is left alone.
--
-- That design is right and it means an install seeded before this needs the rows
-- corrected here. Narrow on purpose: only the five labels that were wrong, only
-- in a section with that name, and only where the category is still the wrong
-- value it shipped with. A point anybody has since re-categorised is untouched.
UPDATE "InspectionPoint"
SET "category" = 'pool_spa'
WHERE "sectionId" IN (SELECT "id" FROM "InspectionSection" WHERE "name" = 'Private pool or hot tub')
  AND (
    ("label" = 'Water clarity and level'   AND "category" = 'plumbing') OR
    ("label" = 'Pump and filtration'       AND "category" = 'plumbing') OR
    ("label" = 'Jets, blower and controls' AND "category" = 'plumbing') OR
    ("label" = 'Skimmer, drain and overflow' AND "category" = 'plumbing') OR
    ("label" = 'Heater and thermostat'     AND "category" = 'hvac')
  );
