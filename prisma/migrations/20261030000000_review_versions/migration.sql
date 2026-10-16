ALTER TABLE "reviews" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "review_events" ADD COLUMN "version" INTEGER;

-- Give each accepted historical write its own monotonic version, including revisions.
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "submissionId", "itemId", "round" ORDER BY "createdAt", "id"
  )::INTEGER AS "version"
  FROM "review_events"
)
UPDATE "review_events" AS event SET "version" = numbered."version"
FROM numbered WHERE event."id" = numbered."id";

UPDATE "reviews" AS review SET "version" = GREATEST(1, (
  SELECT COALESCE(MAX(event."version"), 0) FROM "review_events" AS event
  WHERE event."submissionId" = review."submissionId"
    AND event."itemId" = review."itemId" AND event."round" = review."round"
));

ALTER TABLE "review_events" ALTER COLUMN "version" SET NOT NULL;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_version_check" CHECK ("version" > 0);
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_version_check" CHECK ("version" > 0);
CREATE UNIQUE INDEX "review_events_submissionId_itemId_round_version_key"
  ON "review_events"("submissionId", "itemId", "round", "version");
