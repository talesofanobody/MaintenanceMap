-- Photos of equipment.
--
-- Additive and nullable, so no table rebuild and every existing photo keeps the
-- owner it already had. Photo is already polymorphic over issue, guest report,
-- check and walk-through, with at most one set; equipment is one more of the same
-- and follows the same cascade, so deleting a piece of equipment takes its own
-- photographs with it and leaves everything else alone.
ALTER TABLE "Photo" ADD COLUMN "assetId" TEXT REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Photo_assetId_idx" ON "Photo"("assetId");
