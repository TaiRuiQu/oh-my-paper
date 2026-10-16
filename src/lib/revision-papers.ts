import type { BankQuestion, WrongQuestion } from "@/contracts/platform";
import type { RevisionSource } from "@/contracts/revision-papers";

export const revisionSourceKey = (source: RevisionSource) =>
  JSON.stringify([source.assessmentId, source.itemId]);
export const questionKnowledgeTags = (q: BankQuestion) => [
  ...new Set([...q.knowledgeTags, ...q.content.parts.flatMap((p) => p.knowledgeTags)]),
];
export function revisionContent(
  content: BankQuestion["content"],
  imageCopies: Map<string, string>,
): BankQuestion["content"] {
  // Inline Markdown material references must follow the same authorized copies as content.images.
  return JSON.parse(JSON.stringify(content), (_key, value: unknown) =>
    typeof value === "string"
      ? [...imageCopies].reduce((text, [from, to]) => text.replaceAll(from, to), value)
      : value,
  );
}
export const wrongKnowledgeTags = (wrong: WrongQuestion) =>
  wrong.question.type === "MIXED" && wrong.wrongPartIds?.length
    ? [
        ...new Set(
          wrong.question.content.parts
            .filter((p) => wrong.wrongPartIds!.includes(p.id))
            .flatMap((p) =>
              p.knowledgeTags.length ? p.knowledgeTags : wrong.question.knowledgeTags,
            ),
        ),
      ]
    : questionKnowledgeTags(wrong.question);

// Use content as well as the source ID: edits to a bank question must not erase older versions.
export const replayQuestionKey = (wrong: WrongQuestion) =>
  JSON.stringify([wrong.question.id, wrong.question.type, wrong.question.content, wrong.maximum]);
export function uniqueReplayQuestions(wrong: WrongQuestion[]) {
  const seen = new Set<string>();
  return wrong.filter((entry) => {
    const key = replayQuestionKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export const revisionPaperHref = (id: string) =>
  `/workspace/revision-papers/${encodeURIComponent(id)}`;
