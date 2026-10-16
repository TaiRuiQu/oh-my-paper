ALTER TABLE "papers" ADD COLUMN "readingAssetUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "papers_readingAssetUrls_idx" ON "papers" USING GIN ("readingAssetUrls");

-- Existing reading text was not ownership-validated. Preserve only exact private
-- references owned by that paper's author; never trust a legacy third-party URL.
-- Future paper.save writes use the Markdown AST and validate every selected asset.
WITH reading_text AS (
  SELECT p.id, p."ownerId", p.instructions AS text FROM papers p
  UNION ALL
  SELECT p.id, p."ownerId", block->>'text' AS text
  FROM papers p
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p.layout->'textBlocks') = 'array'
      THEN p.layout->'textBlocks' ELSE '[]'::jsonb END
  ) AS block
), references_owned AS (
  SELECT DISTINCT r.id, '/api/platform/assets/' || a.id AS url
  FROM reading_text r
  CROSS JOIN LATERAL regexp_matches(
    r.text,
    $pattern$(?:^|[\s([<"'])(/api/platform/assets/[a-f0-9-]{36})(?=$|[\s)\]>"'])$pattern$,
    'g'
  ) AS matched
  JOIN platform_assets a ON '/api/platform/assets/' || a.id = matched[1]
    AND a."ownerId" = r."ownerId"
), manifests AS (
  SELECT id, array_agg(url ORDER BY url) AS urls FROM references_owned GROUP BY id
)
UPDATE papers p SET "readingAssetUrls" = m.urls FROM manifests m WHERE p.id = m.id;
