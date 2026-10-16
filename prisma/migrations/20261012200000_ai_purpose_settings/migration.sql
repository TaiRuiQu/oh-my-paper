-- Preserve the current model for existing installations, then configure each purpose independently.
INSERT INTO "ai_settings" ("id", "modelId", "reasoningEffort")
SELECT purpose.id, current."modelId", current."reasoningEffort"
FROM "ai_settings" AS current
CROSS JOIN (VALUES ('answer'), ('grading')) AS purpose(id)
WHERE current."id" = 'exam'
ON CONFLICT ("id") DO NOTHING;
