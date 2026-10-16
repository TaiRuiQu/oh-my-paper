"use client";
import type {
  PracticeAttemptDetail,
  PracticeEvaluation,
  PracticeEvaluationInput,
  PracticeJudgment,
  PracticeReference,
  PracticeStudentPaper,
  PracticeItemEligibility,
} from "@/contracts/practice";
import { MarkdownText } from "@/components/markdown-text";
import { QuestionMaterialGallery } from "@/components/platform/question-materials";
import { Field } from "@/components/platform/primitives";
import { formatSchoolDateTime } from "@/lib/date-time";
import { galleryImagesOutsideMarkdown } from "@/lib/markdown-images";
import { PracticePaper } from "./paper";
import styles from "./practice.module.css";
export const judgmentLabels: Record<PracticeJudgment, string> = {
  CORRECT: "正确",
  PARTIAL: "部分正确",
  INCORRECT: "需要订正",
  UNSURE: "待核验",
  SKIPPED: "看不清或暂时跳过",
};
export const evaluationLabels = {
  SELF: "本人自评（不计教师确认）",
  AI_CANDIDATE: "AI反馈候选（待人工核验）",
  TEACHER_CONFIRMED: "教师已核验",
};
export const eligibilityLabels = {
  UNEXPOSED_IN_SYSTEM: "系统尚未提供参考",
  REPEAT: "原题复现或再次练习",
  ANSWER_AVAILABLE: "系统已提供参考",
  UNKNOWN: "历史参考情况无法确认",
};
export function PracticeEligibility({ items }: { items: PracticeItemEligibility[] }) {
  return (
    <div className={styles.stack}>
      {items.map((entry, index) => (
        <p key={entry.itemId} className={styles.help}>
          第 {index + 1} 题：{eligibilityLabels[entry.eligibility]}
          {entry.reasons.length ? ` · ${entry.reasons.join("；")}` : ""}
        </p>
      ))}
      <p className={styles.help}>
        “系统尚未提供参考”仅描述平台记录；复现、看过参考、自评和AI候选不等于独立掌握证据。
      </p>
    </div>
  );
}
export function PracticeReferenceReading({
  reference,
  papers,
  context,
  audience,
}: {
  reference: PracticeReference;
  papers: PracticeStudentPaper[];
  context: string;
  audience: "TEACHER" | "STUDENT";
}) {
  const items = papers.flatMap((paper) => paper.items);
  return (
    <section aria-label={`${context}${audience === "TEACHER" ? "教师核验用参考" : "已开放参考"}`}>
      <h3>
        {audience === "TEACHER"
          ? "教师核验用参考（不代表学生已查看）"
          : "已明确开放的参考答案与解析"}
      </h3>
      <p className={styles.help}>
        {audience === "TEACHER"
          ? "以下内容供教师核验，不能据此认定学生已查看参考或参考已向学生开放。"
          : "以下为当前已开放的参考；各次提交时的参考情况以该次提交记录为准。"}
      </p>
      {reference.items.map((entry) => {
        const position = items.findIndex((item) => item.id === entry.itemId);
        return (
          <article className={styles.question} key={entry.itemId}>
            <h4>第 {position + 1} 题参考</h4>
            <MarkdownText text={entry.answers.join("；") || "暂无参考答案"} />
            <MarkdownText text={entry.explanation} />
            <MarkdownText text={entry.rubric} />
            <QuestionMaterialGallery
              images={galleryImagesOutsideMarkdown(entry.images, [
                entry.answers.join("；"),
                entry.explanation,
                entry.rubric,
                ...entry.parts.flatMap((part) => [
                  part.answers.join("；"),
                  part.explanation,
                  part.rubric,
                ]),
              ])}
              label={`${context}第 ${position + 1} 题参考图像材料`}
            />
            {entry.parts.map((part, index) => (
              <section key={part.partId}>
                <h4>第 {index + 1} 小问</h4>
                <MarkdownText text={part.answers.join("；")} />
                <MarkdownText text={part.explanation} />
                <MarkdownText text={part.rubric} />
              </section>
            ))}
          </article>
        );
      })}
    </section>
  );
}
export function PracticeEvaluationReading({
  evaluation,
  papers,
  attemptSequence,
  reviewPending = false,
  timezone,
}: {
  evaluation: PracticeEvaluation;
  papers: PracticeStudentPaper[];
  attemptSequence: number;
  reviewPending?: boolean;
  timezone: string;
}) {
  const items = papers.flatMap((paper) => paper.items);
  return (
    <article className={styles.section}>
      <h3>
        第 {attemptSequence} 次提交 · {evaluationLabels[evaluation.source]} · 记录版本 v
        {evaluation.version}
        {reviewPending && evaluation.source === "TEACHER_CONFIRMED" ? " · 复核前版本" : ""}
      </h3>
      {reviewPending && evaluation.source === "TEACHER_CONFIRMED" && (
        <p className={styles.help}>此为申请复核前的确认记录；本次核验请求尚待教师处理。</p>
      )}
      <p className={styles.help}>
        {evaluation.actorName} · {formatSchoolDateTime(evaluation.createdAt, timezone)}
      </p>
      <MarkdownText text={evaluation.evaluation.summary} />
      {evaluation.evaluation.items.map((entry) => {
        const item = items.find((candidate) => candidate.id === entry.itemId);
        return (
          <section key={entry.itemId}>
            <h4>
              第 {items.findIndex((candidate) => candidate.id === entry.itemId) + 1} 题 ·{" "}
              {judgmentLabels[entry.judgment]}
            </h4>
            <MarkdownText text={entry.feedback} />
            {entry.parts.map((part) => (
              <div className={styles.part} key={part.partId}>
                <strong>
                  第{" "}
                  {(item?.parts.findIndex((candidate) => candidate.id === part.partId) ?? -1) + 1}{" "}
                  小问 · {judgmentLabels[part.judgment]}
                </strong>
                <MarkdownText text={part.feedback} />
              </div>
            ))}
          </section>
        );
      })}
      {evaluation.source !== "TEACHER_CONFIRMED" && (
        <p className={styles.help}>此记录单独保留，不冒充教师确认或正式成绩。</p>
      )}
    </article>
  );
}
export function PracticeAttemptReading({
  detail,
  context,
}: {
  detail: PracticeAttemptDetail;
  context: string;
}) {
  const items = detail.papers.flatMap((paper) => paper.items);
  return (
    <section aria-label={`${context}提交内容`}>
      <p>
        第 {detail.attempt.sequence} 次提交 ·{" "}
        {formatSchoolDateTime(detail.attempt.submittedAt, detail.timezone)}
      </p>
      <p className={styles.help}>以下参考情况是本次提交时的记录，不代表学生当前是否已查看参考。</p>
      <PracticeEligibility items={detail.attempt.eligibility} />
      {detail.papers.map((paper, index) => (
        <PracticePaper key={paper.id} paper={paper} context={`${context}第 ${index + 1} 份`} />
      ))}
      {detail.answers.map((answer) => {
        const index = items.findIndex((item) => item.id === answer.itemId);
        return (
          <article key={answer.itemId} className={styles.question}>
            <h4>第 {index + 1} 题本轮作答</h4>
            <p className={styles.answer}>{answer.text || "未填写文字"}</p>
            <QuestionMaterialGallery
              images={answer.images}
              label={`${context}第 ${index + 1} 题作答图片`}
            />
          </article>
        );
      })}
      {detail.evaluations.map((evaluation) => (
        <PracticeEvaluationReading
          key={evaluation.id}
          evaluation={evaluation}
          papers={detail.papers}
          attemptSequence={detail.attempt.sequence}
          timezone={detail.timezone}
          reviewPending={
            detail.session.status === "SUBMITTED" &&
            detail.session.currentAttemptId === detail.attempt.id &&
            !!detail.session.reviewRequestedAt
          }
        />
      ))}
      {detail.reference && (
        <PracticeReferenceReading
          reference={detail.reference}
          papers={detail.papers}
          context={context}
          audience={detail.actor.role === "STUDENT" ? "STUDENT" : "TEACHER"}
        />
      )}
    </section>
  );
}
export function initialEvaluation(papers: PracticeStudentPaper[]): PracticeEvaluationInput {
  return {
    summary: "",
    items: papers.flatMap((paper) =>
      paper.items.map((item) => ({
        itemId: item.id,
        judgment: "UNSURE" as const,
        feedback: "",
        parts: item.parts.map((part) => ({
          partId: part.id,
          judgment: "UNSURE" as const,
          feedback: "",
        })),
      })),
    ),
  };
}
export function PracticeEvaluationEditor({
  papers,
  value,
  onChange,
}: {
  papers: PracticeStudentPaper[];
  value: PracticeEvaluationInput;
  onChange: (value: PracticeEvaluationInput) => void;
}) {
  const items = papers.flatMap((paper) => paper.items);
  return (
    <>
      <Field label="核对总说明">
        <textarea
          maxLength={10000}
          value={value.summary}
          onChange={(event) => onChange({ ...value, summary: event.target.value })}
        />
      </Field>
      {value.items.map((entry, index) => {
        const item = items.find((candidate) => candidate.id === entry.itemId);
        return (
          <section key={entry.itemId}>
            <Field label={`第 ${index + 1} 题核对结果`}>
              <select
                value={entry.judgment}
                onChange={(event) =>
                  onChange({
                    ...value,
                    items: value.items.map((candidate) =>
                      candidate.itemId === entry.itemId
                        ? { ...candidate, judgment: event.target.value as PracticeJudgment }
                        : candidate,
                    ),
                  })
                }
              >
                {Object.entries(judgmentLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={`第 ${index + 1} 题核对说明`}
              hint="待核验或跳过必须说明原因；不填零分代替看不清。"
            >
              <textarea
                required={entry.judgment === "UNSURE" || entry.judgment === "SKIPPED"}
                maxLength={10000}
                value={entry.feedback}
                onChange={(event) =>
                  onChange({
                    ...value,
                    items: value.items.map((candidate) =>
                      candidate.itemId === entry.itemId
                        ? { ...candidate, feedback: event.target.value }
                        : candidate,
                    ),
                  })
                }
              />
            </Field>
            {entry.parts.map((part, partIndex) => (
              <div className={styles.part} key={part.partId}>
                <h4>
                  第 {index + 1} 题第 {partIndex + 1} 小问（
                  {item?.parts.find((candidate) => candidate.id === part.partId)?.score ?? ""}{" "}
                  分题面权重）
                </h4>
                <Field label={`第 ${index + 1} 题第 ${partIndex + 1} 小问结果`}>
                  <select
                    value={part.judgment}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        items: value.items.map((candidate) =>
                          candidate.itemId === entry.itemId
                            ? {
                                ...candidate,
                                parts: candidate.parts.map((p) =>
                                  p.partId === part.partId
                                    ? { ...p, judgment: event.target.value as PracticeJudgment }
                                    : p,
                                ),
                              }
                            : candidate,
                        ),
                      })
                    }
                  >
                    {Object.entries(judgmentLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={`第 ${index + 1} 题第 ${partIndex + 1} 小问说明`}>
                  <textarea
                    maxLength={10000}
                    required={part.judgment === "UNSURE" || part.judgment === "SKIPPED"}
                    value={part.feedback}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        items: value.items.map((candidate) =>
                          candidate.itemId === entry.itemId
                            ? {
                                ...candidate,
                                parts: candidate.parts.map((p) =>
                                  p.partId === part.partId
                                    ? { ...p, feedback: event.target.value }
                                    : p,
                                ),
                              }
                            : candidate,
                        ),
                      })
                    }
                  />
                </Field>
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}
