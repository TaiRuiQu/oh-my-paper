-- Persist independent mixed-question subpart scores for accurate knowledge analytics.
ALTER TABLE "reviews" ADD COLUMN "partScores" JSONB NOT NULL DEFAULT '[]'::JSONB;
