"use client";
import type { Paper } from "@/contracts/platform";
import { MarkdownText } from "@/components/markdown-text";
import { paperReadingBlocks } from "@/lib/paper-reading";

export function PaperSharedReading({
  paper,
  beforeItemId,
  context,
}: {
  paper: Paper;
  beforeItemId?: string;
  context: string;
}) {
  const blocks = paperReadingBlocks(paper, beforeItemId);
  const instructions = !beforeItemId ? (paper.instructions ?? "") : "";
  if (!instructions.trim() && !blocks.length) return null;
  return (
    <section className="p-panel-content" aria-label={`${context}说明与共享阅读材料`}>
      {instructions.trim() && (
        <section aria-label={`${context}试卷说明`}>
          <MarkdownText text={instructions} />
        </section>
      )}
      {blocks.map((block) => (
        <section
          className="p-answers"
          key={block.id}
          aria-label={`${context}共享阅读材料${(paper.layout.textBlocks ?? []).findIndex((b) => b.id === block.id) + 1}`}
        >
          <MarkdownText text={block.text} />
        </section>
      ))}
    </section>
  );
}
