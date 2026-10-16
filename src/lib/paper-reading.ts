import type { DocumentLayout, Paper } from "@/contracts/platform";
import { markdownImageUrls } from "./markdown-images";

/** Only reading content participates: no answers, feedback, names or unrelated metadata. */
export function paperReadingAssetUrls(paper: { instructions: string; layout: DocumentLayout }) {
  return [
    ...new Set(
      [paper.instructions, ...(paper.layout.textBlocks ?? []).map((b) => b.text)].flatMap(
        (text) => [...markdownImageUrls(text)],
      ),
    ),
  ];
}

/** The print editor anchors to original question IDs; imported papers may anchor to item IDs. */
export function paperReadingBlocks(paper: Paper, beforeItemId?: string) {
  const item = beforeItemId ? paper.items.find((entry) => entry.id === beforeItemId) : undefined;
  return (paper.layout?.textBlocks ?? []).filter((block) =>
    beforeItemId
      ? !!item && (block.beforeQuestionId === item.id || block.beforeQuestionId === item.questionId)
      : !block.beforeQuestionId ||
        !paper.items.some(
          (entry) =>
            entry.id === block.beforeQuestionId || entry.questionId === block.beforeQuestionId,
        ),
  );
}
