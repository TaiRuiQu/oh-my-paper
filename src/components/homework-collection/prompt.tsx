"use client";
import type { HomeworkStudentPaper } from "@/contracts/homework";
import { MarkdownText } from "@/components/markdown-text";
import { QuestionMaterialGallery } from "@/components/platform/question-materials";
import styles from "./homework.module.css";
import { galleryImagesOutsideMarkdown } from "@/lib/markdown-images";

export type StudentItem = HomeworkStudentPaper["items"][number];
/** Teacher publication preview uses the same media choice as the student projection. */
export function selectedPromptText(text: string, selected: string[]) {
  return text.replace(
    /!?\[([^\]]*)\]\((\/api\/platform\/assets\/[a-f0-9-]{36})\)/g,
    (match, alt: string, url: string) =>
      selected.includes(url) ? match : `${alt || "图片"}（未向学生开放）`,
  );
}
export function StudentPrompt({
  item,
  index,
  context = "",
}: {
  item: StudentItem;
  index: number;
  context?: string;
}) {
  return (
    <section className={styles.question} aria-label={`${context}第 ${index + 1} 题题面`}>
      <h3>
        第 {index + 1} 题 · {item.score} 分
      </h3>
      <MarkdownText text={item.stem} />
      {item.options.map((option) => (
        <div key={option.label}>
          <strong>{option.label}.</strong>
          <MarkdownText text={option.text} />
        </div>
      ))}
      <QuestionMaterialGallery
        images={galleryImagesOutsideMarkdown(item.studentImageUrls, [
          item.stem,
          ...item.options.map((option) => option.text),
          ...item.parts.flatMap((part) => [
            part.stem,
            ...part.options.map((option) => option.text),
          ]),
        ])}
        label={`${context}第 ${index + 1} 题题面图像材料`}
      />
      {item.parts.map((part, partIndex) => (
        <section key={part.id} className={styles.part}>
          <h4>
            第 {partIndex + 1} 小问 · {part.score} 分
          </h4>
          <MarkdownText text={part.stem} />
          {part.options.map((option) => (
            <div key={option.label}>
              <strong>{option.label}.</strong>
              <MarkdownText text={option.text} />
            </div>
          ))}
        </section>
      ))}
    </section>
  );
}

export function PaperReading({
  paper,
  beforeItemId,
  context = paper.name,
}: {
  paper: HomeworkStudentPaper;
  beforeItemId?: string;
  context?: string;
}) {
  const blocks = paper.textBlocks.filter((block) =>
    beforeItemId
      ? block.beforeQuestionId === beforeItemId
      : !block.beforeQuestionId || !paper.items.some((item) => item.id === block.beforeQuestionId),
  );
  return (
    <>
      {!beforeItemId && (
        <section aria-label={`${context}作业说明与共享材料`}>
          <MarkdownText text={paper.instructions} />
          <QuestionMaterialGallery
            images={galleryImagesOutsideMarkdown(paper.studentImageUrls, [
              paper.instructions,
              ...paper.textBlocks.map((block) => block.text),
            ])}
            label={`${context}纸级共享图像材料`}
          />
        </section>
      )}
      {blocks.map((block) => (
        <section
          className={styles.question}
          aria-label={`${context}第 ${paper.textBlocks.findIndex((entry) => entry.id === block.id) + 1} 段共享阅读材料`}
          key={block.id}
        >
          <MarkdownText text={block.text} />
        </section>
      ))}
    </>
  );
}
