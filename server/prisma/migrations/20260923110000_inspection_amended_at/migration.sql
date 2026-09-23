-- When a finished inspection was last reopened to correct something.
-- Appending a nullable column needs no table rebuild.
ALTER TABLE "Inspection" ADD COLUMN "amendedAt" DATETIME;
