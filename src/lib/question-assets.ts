/** Exact private asset references in question content, never URLs from unrelated metadata. */
export function questionAssetUrls(content: unknown): string[] {
  if (!content || typeof content !== "object" || Array.isArray(content)) return [];
  const record = content as Record<string, unknown>;
  const urls = new Set<string>();
  const exact = /^\/api\/platform\/assets\/[a-f0-9-]{36}$/;
  for (const image of Array.isArray(record.images) ? record.images : [])
    if (typeof image === "string" && exact.test(image)) urls.add(image);
  const text = (value: unknown) => {
    if (typeof value !== "string") return;
    // Require URL token boundaries: external origins, paths, query strings, fragments,
    // encoded traversal and longer identifiers never become private asset grants.
    for (const match of value.matchAll(
      /(?:^|[\s([<"'])((?:\/api\/platform\/assets\/)[a-f0-9-]{36})(?=$|[\s)\]>"'])/g,
    ))
      urls.add(match[1]);
  };
  for (const key of ["stem", "explanation", "rubric"]) text(record[key]);
  for (const answer of Array.isArray(record.answers) ? record.answers : []) text(answer);
  for (const option of Array.isArray(record.options) ? record.options : []) {
    if (option && typeof option === "object") text((option as Record<string, unknown>).text);
  }
  for (const part of Array.isArray(record.parts) ? record.parts : []) {
    // Subquestions have the same text fields, but cannot contain nested subquestions.
    if (!part || typeof part !== "object" || Array.isArray(part)) continue;
    const { parts: _nested, ...fields } = part as Record<string, unknown>;
    void _nested;
    for (const url of questionAssetUrls(fields)) urls.add(url);
  }
  return [...urls];
}

/** Persist only after every returned reference has passed assertAssets. */
export function normalizeQuestionAssets<T extends { images: string[] }>(content: T): T {
  return { ...content, images: [...new Set([...content.images, ...questionAssetUrls(content)])] };
}
