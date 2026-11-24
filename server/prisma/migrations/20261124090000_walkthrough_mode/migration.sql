-- How a walk-through is being worked, and where it is.
--
-- Additive. `mode` defaults to "group", which is what every existing walk was:
-- photograph everything, sort it into issues afterwards. Nothing already recorded
-- changes meaning.
ALTER TABLE "Walkthrough" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'group';
ALTER TABLE "Walkthrough" ADD COLUMN "spaceId" TEXT REFERENCES "Space"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Walkthrough" ADD COLUMN "roomName" TEXT;
CREATE INDEX "Walkthrough_spaceId_idx" ON "Walkthrough"("spaceId");
