"use client";
import Image from "next/image";
import { useState } from "react";
import type { HomeworkIssuePreview, HomeworkStudentPaper } from "@/contracts/homework";
import { Field } from "@/components/platform/primitives";
import { QuestionAnswers } from "@/components/platform/question-answers";
import { HomeworkForm, HomeworkPanel } from "./primitives";
import { useHomework } from "./provider";
import { PaperReading, selectedPromptText, StudentPrompt, type StudentItem } from "./prompt";
import styles from "./homework.module.css";

export function HomeworkIssue({ preview }: { preview: HomeworkIssuePreview }) {
  const { pending, stale } = useHomework();
  const [choices, setChoices] = useState<Record<string, string[]>>({}),
    [reviewed, setReviewed] = useState(false);
  const [instructions, setInstructions] = useState(""),
    [dueLocal, setDueLocal] = useState(""),
    [timezone] = useState(preview.timezone),
    [allowLate, setAllowLate] = useState(false);
  const disabled = pending || stale || !preview.canIssue;
  return (
    <HomeworkPanel
      title="发放学生作业"
      description="发放题目与发布成绩是两个独立操作。请核对每题题面和学生可见图片，原题后续修改不会改写已发放内容。"
    >
      {!!preview.blockReasons.length && (
        <div className="p-notice">
          <ul>
            {preview.blockReasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      <HomeworkForm
        allowed={!disabled}
        submitDisabled={!reviewed}
        dirty={reviewed || !!instructions || !!dueLocal || !!Object.keys(choices).length}
        label="确认发放学生作业"
        command={() => ({
          type: "homework.issue",
          assessmentId: preview.assessmentId,
          expectedRosterRevision: preview.rosterRevision,
          expectedPapers: preview.papers.map((paper) => ({
            paperId: paper.id,
            expectedUpdatedAt: paper.updatedAt,
            studentImageUrls: choices[paper.id] ?? [],
            items: paper.items.map((item) => ({
              itemId: item.id,
              studentImageUrls: choices[`${paper.id}/${item.id}`] ?? [],
            })),
          })),
          instructions,
          dueLocal,
          timezone,
          allowLate,
        })}
      >
        <Field label="学生作业说明">
          <textarea
            maxLength={10000}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </Field>
        <div className="p-form-grid">
          <Field label="作业截止日期与时间">
            <input
              type="datetime-local"
              required
              value={dueLocal}
              onChange={(event) => setDueLocal(event.target.value)}
            />
          </Field>
          <Field label="学校时区" hint="使用学校统一时区，截止时间不取设备时区。">
            <input required maxLength={80} value={timezone} readOnly />
          </Field>
        </div>
        <label>
          <input
            type="checkbox"
            checked={allowLate}
            onChange={(event) => setAllowLate(event.target.checked)}
          />{" "}
          截止后仍允许迟交，并明确标记迟交
        </label>
        {preview.papers.map((paper, paperIndex) => (
          <section className={styles.section} key={paper.id}>
            <h3>
              {paper.name} · {paper.subject}
            </h3>
            <h4>共享阅读材料与说明图片</h4>
            <p className={styles.help}>纸级阅读材料也需明确选择图片，默认不向学生开放。</p>
            <div className={styles.images}>
              {paper.allowedStudentImageUrls.map((url, imageIndex) => (
                <figure className={styles.imageChoice} key={url}>
                  <Image
                    unoptimized
                    width={400}
                    height={300}
                    loading="lazy"
                    src={url}
                    alt={`教师核对共享候选图 ${imageIndex + 1}`}
                    className={styles.image}
                  />
                  <a href={url} target="_blank" rel="noreferrer">
                    查看共享候选图 {imageIndex + 1} 原图
                  </a>
                  <label>
                    <input
                      type="checkbox"
                      checked={(choices[paper.id] ?? []).includes(url)}
                      onChange={(event) => {
                        setChoices((current) => ({
                          ...current,
                          [paper.id]: event.target.checked
                            ? [...(current[paper.id] ?? []), url]
                            : (current[paper.id] ?? []).filter((entry) => entry !== url),
                        }));
                        setReviewed(false);
                      }}
                    />{" "}
                    向学生开放共享图 {imageIndex + 1}
                  </label>
                </figure>
              ))}
            </div>
            <details>
              <summary>预览整份学生作业与阅读材料</summary>
              <IssueStudentPreview
                paper={paper}
                choices={choices}
                context={`第 ${paperIndex + 1} 份${paper.name}整份预览`}
              />
            </details>
            {paper.items.map((item, index) => {
              const key = `${paper.id}/${item.id}`,
                selected = choices[key] ?? [],
                content = item.snapshot.content;
              const weight = content.parts.reduce((sum, part) => sum + part.score, 0);
              const prompt: StudentItem = {
                id: item.id,
                position: item.position,
                score: item.score,
                section: item.section,
                type: item.snapshot.type,
                stem: selectedPromptText(content.stem, selected),
                options: content.options.map((option) => ({
                  ...option,
                  text: selectedPromptText(option.text, selected),
                })),
                parts: content.parts.map((part) => ({
                  id: part.id,
                  type: part.type,
                  stem: selectedPromptText(part.stem, selected),
                  options: part.options.map((option) => ({
                    ...option,
                    text: selectedPromptText(option.text, selected),
                  })),
                  score: weight ? (item.score * part.score) / weight : 0,
                })),
                studentImageUrls: selected,
              };
              return (
                <div className={styles.question} key={item.id}>
                  <h4>第 {index + 1} 题：选择学生可见图片</h4>
                  <p className={styles.help}>
                    默认不开放图片。请查看原图，勾选必要题干材料；参考答案、解题过程或评分图不要勾选。
                  </p>
                  <div className={styles.images}>
                    {item.allowedStudentImageUrls.map((url, imageIndex) => (
                      <figure className={styles.imageChoice} key={url}>
                        <Image
                          unoptimized
                          width={400}
                          height={300}
                          loading="lazy"
                          src={url}
                          alt={`教师核对第 ${index + 1} 题候选图 ${imageIndex + 1}`}
                          className={styles.image}
                        />
                        <a href={url} target="_blank" rel="noreferrer">
                          查看候选图 {imageIndex + 1} 原图
                        </a>
                        <label>
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={selected.includes(url)}
                            onChange={(event) => {
                              setChoices((current) => ({
                                ...current,
                                [key]: event.target.checked
                                  ? [...selected, url]
                                  : selected.filter((entry) => entry !== url),
                              }));
                              setReviewed(false);
                            }}
                          />{" "}
                          向学生开放图 {imageIndex + 1}
                          {item.suggestedStudentImageUrls.includes(url)
                            ? "（题面引用，仍须核对）"
                            : ""}
                        </label>
                      </figure>
                    ))}
                  </div>
                  {!item.allowedStudentImageUrls.length && (
                    <p className={styles.help}>本题没有可选择的图片。</p>
                  )}
                  <details>
                    <summary>预览学生第 {index + 1} 题题面</summary>
                    <StudentPrompt
                      item={prompt}
                      index={index}
                      context={`第 ${paperIndex + 1} 份${paper.name}逐题预览`}
                    />
                  </details>
                  <details>
                    <summary>教师核对第 {index + 1} 题参考答案与解析</summary>
                    <QuestionAnswers content={content} />
                  </details>
                </div>
              );
            })}
          </section>
        ))}
        <label>
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />{" "}
          我已逐题预览学生题面并核对图片用途，确认不会把参考答案图作为题干材料发放
        </label>
      </HomeworkForm>
    </HomeworkPanel>
  );
}

function IssueStudentPreview({
  paper,
  choices,
  context,
}: {
  paper: HomeworkIssuePreview["papers"][number];
  choices: Record<string, string[]>;
  context: string;
}) {
  const safe: HomeworkStudentPaper = {
    id: paper.id,
    name: paper.name,
    subject: paper.subject,
    instructions: selectedPromptText(paper.instructions, choices[paper.id] ?? []),
    textBlocks: paper.textBlocks.map((block) => ({
      ...block,
      text: selectedPromptText(block.text, choices[paper.id] ?? []),
    })),
    studentImageUrls: choices[paper.id] ?? [],
    items: paper.items.map((item) => {
      const selected = choices[`${paper.id}/${item.id}`] ?? [],
        content = item.snapshot.content,
        weight = content.parts.reduce((sum, part) => sum + part.score, 0);
      return {
        id: item.id,
        position: item.position,
        score: item.score,
        section: item.section,
        type: item.snapshot.type,
        stem: selectedPromptText(content.stem, selected),
        options: content.options.map((option) => ({
          ...option,
          text: selectedPromptText(option.text, selected),
        })),
        parts: content.parts.map((part) => ({
          id: part.id,
          type: part.type,
          stem: selectedPromptText(part.stem, selected),
          options: part.options.map((option) => ({
            ...option,
            text: selectedPromptText(option.text, selected),
          })),
          score: weight ? (item.score * part.score) / weight : 0,
        })),
        studentImageUrls: selected,
      };
    }),
  };
  return (
    <section aria-label={`${context}完整学生题面预览`}>
      <PaperReading paper={safe} context={context} />
      {safe.items.map((item, index) => (
        <div key={item.id}>
          <PaperReading paper={safe} beforeItemId={item.id} context={context} />
          <StudentPrompt item={item} index={index} context={context} />
        </div>
      ))}
    </section>
  );
}
