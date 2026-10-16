-- Publication snapshots predate the dedicated week anchor field. Existing rows
-- can only recover it from their owning term; all future publications store it directly.
ALTER TABLE "school_publications" ADD COLUMN "weekOneMonday" TEXT;
UPDATE "school_publications" AS publication
SET "weekOneMonday" = term."weekOneMonday"
FROM "school_terms" AS term
WHERE term."id" = publication."termId";
ALTER TABLE "school_publications" ALTER COLUMN "weekOneMonday" SET NOT NULL;
