-- The week anchor is defined by the publication's own civil start date.
-- Correct the preceding historical backfill, which used a possibly edited term.
-- timestamp without time zone deliberately avoids the database session timezone.
UPDATE "school_publications"
SET "weekOneMonday" = to_char(date_trunc('week', "startDate"::date::timestamp), 'YYYY-MM-DD')
WHERE "weekOneMonday" <> to_char(date_trunc('week', "startDate"::date::timestamp), 'YYYY-MM-DD');
