-- Which revision of the built-in checklist a template has had applied.
--
-- Written by hand rather than taken from `migrate diff`, which wanted to rebuild
-- the whole table: create new, copy every row across, drop, rename. SQLite does
-- need that for most changes, but not for appending a column with a default, and
-- a rebuild is the only kind of migration that can lose data if it is interrupted.
-- One ALTER has nothing to interrupt.
ALTER TABLE "InspectionTemplate" ADD COLUMN "seedVersion" INTEGER NOT NULL DEFAULT 0;
