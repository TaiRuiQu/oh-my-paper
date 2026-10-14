"use client";
import Image from "next/image";
import { useState } from "react";
import type { FinalGrade, PlatformState, Review, ScanSubmission } from "@/contracts/platform";
import { Empty, Field, Panel, Submit, readForm, stringField, numberField } from "./primitives";
import { QuestionBody, type Mutate } from "./questions";
export function Reviews({
  state,
  mutate,
  pending,
}: {
  state: PlatformState;
  mutate: Mutate;
  pending: boolean;
}) {
  const [assessmentId, setAssessmentId] = useState(""),
    [submissionId, setSubmissionId] = useState("");
  const submissions = state.submissions.filter(
      (s) => !assessmentId || s.assessmentId === assessmentId,
    ),
    submission = submissions.find((s) => s.id === submissionId);
  return (
    <Panel
      title="阅卷工作台"
      description="逐题查看作答、参考答案与评分标准。双评由不同教师独立提交，分差超阈值后进入仲裁三评。"
    >
      <div className="p-toolbar">
        <select
          aria-label="选择考试"
          value={assessmentId}
          onChange={(e) => {
            setAssessmentId(e.target.value);
            setSubmissionId("");
          }}
        >
          <option value="">全部考试 / 作业</option>
          {state.assessments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          aria-label="选择学生答卷"
          value={submissionId}
          onChange={(e) => setSubmissionId(e.target.value)}
        >
          <option value="">选择学生答卷</option>
          {submissions.map((s) => (
            <option key={s.id} value={s.id}>
              {state.classrooms.flatMap((c) => c.students).find((st) => st.id === s.studentId)
                ?.name ?? "待匹配"}{" "}
              · {state.papers.find((p) => p.id === s.paperId)?.subject} ·{" "}
              {{ PENDING: "待阅卷", REVIEW: "待复核", GRADED: "已阅卷" }[s.status]}
            </option>
          ))}
        </select>
      </div>
      {submission ? (
        <SubmissionReview
          key={submission.id}
          submission={submission}
          state={state}
          mutate={mutate}
          pending={pending}
        />
      ) : (
        <Empty>
          {submissions.length ? "选择一份学生答卷开始阅卷。" : "先在扫描录入中上传学生答卷。"}
        </Empty>
      )}
    </Panel>
  );
}
function SubmissionReview({
  submission,
  state,
  mutate,
  pending,
}: {
  submission: ScanSubmission;
  state: PlatformState;
  mutate: Mutate;
  pending: boolean;
}) {
  const paper = state.papers.find((p) => p.id === submission.paperId),
    assessment = state.assessments.find((a) => a.id === submission.assessmentId),
    settings = assessment?.papers.find((p) => p.paperId === submission.paperId),
    result = state.analytics.results.find(
      (r) => r.assessmentId === submission.assessmentId && r.studentId === submission.studentId,
    ),
    grades = result?.subjects.find((s) => s.paperId === submission.paperId)?.grades ?? [];
  return (
    <>
      {submission.status === "REVIEW" && (
        <div className="p-panel-content">
          <p className="p-notice">
            扫描识别存在不确定信息，请核对学生卡号、图像位置和作答后再提交评分。
          </p>
        </div>
      )}
      {paper?.items.map((item, index) => {
        const answer = submission.answers.find((a) => a.itemId === item.id),
          reviews = state.reviews.filter(
            (r) => r.submissionId === submission.id && r.itemId === item.id,
          ),
          grade = grades.find((g) => g.itemId === item.id);
        return (
          <ReviewItem
            key={item.id}
            index={index}
            item={item}
            answer={answer}
            reviews={reviews}
            grade={grade}
            double={settings?.gradingMode === "DOUBLE"}
            state={state}
            submission={submission}
            mutate={mutate}
            pending={pending}
          />
        );
      })}
    </>
  );
}
function ReviewItem({
  index,
  item,
  answer,
  reviews,
  grade,
  double,
  state,
  submission,
  mutate,
  pending,
}: {
  index: number;
  item: NonNullable<PlatformState["papers"][number]>["items"][number];
  answer: ScanSubmission["answers"][number] | undefined;
  reviews: Review[];
  grade: FinalGrade | undefined;
  double: boolean;
  state: PlatformState;
  submission: ScanSubmission;
  mutate: Mutate;
  pending: boolean;
}) {
  const next: Review["round"] =
    grade?.status === "ARBITRATION"
      ? "ARBITRATION"
      : reviews.some((r) => r.round === "FIRST") && double
        ? "SECOND"
        : "FIRST";
  const [round, setRound] = useState<Review["round"]>(next);
  const ownReview = reviews.find((r) => r.reviewerId === state.actor.id && r.round === round);
  return (
    <article className="p-review-work">
      <div className="p-question-head">
        <h3>
          第 {index + 1} 题 · {item.score} 分
        </h3>
        <span className={`p-status${grade?.status === "FINAL" ? " success" : ""}`}>
          {grade?.status === "FINAL"
            ? `最终得分 ${grade.score}`
            : grade?.status === "ARBITRATION"
              ? "等待仲裁"
              : grade?.status === "SECOND"
                ? "等待第二评"
                : "等待评分"}
        </span>
      </div>
      <details>
        <summary>查看题目、参考答案与评分标准</summary>
        <QuestionBody question={item.snapshot} />
        <p>答案：{item.snapshot.content.answers.join("；") || "暂无"}</p>
        <p className="p-question-content">评分标准：{item.snapshot.content.rubric || "暂无"}</p>
        {item.snapshot.content.parts.map((p, i) => (
          <p key={p.id}>
            （{i + 1}）{p.answers.join("；")} · {p.rubric}
          </p>
        ))}
      </details>
      <div className="p-split">
        <div>
          <h3>学生作答</h3>
          {answer?.text && <p className="p-question-content">{answer.text}</p>}
          {answer?.images.map((url, i) => (
            <Image
              unoptimized
              width={1000}
              height={1000}
              className="p-scan-image"
              key={url}
              src={url}
              alt={`第 ${index + 1} 题作答图像 ${i + 1}`}
            />
          ))}
          {!answer?.images.length && !answer?.text && (
            <p className="p-muted">尚未录入这道题的作答。</p>
          )}
        </div>
        <div>
          <ReviewForm
            key={`${round}-${ownReview?.id ?? "new"}`}
            item={item}
            submissionId={submission.id}
            round={round}
            setRound={setRound}
            ownReview={ownReview}
            double={double}
            arbitration={grade?.status === "ARBITRATION"}
            mutate={mutate}
            pending={pending}
          />
          {reviews.length > 0 && (
            <details>
              <summary>评阅记录（{reviews.length}）</summary>
              {reviews.map((r) => (
                <p key={r.id} className="p-muted">
                  {{ FIRST: "第一评", SECOND: "第二评", ARBITRATION: "仲裁" }[r.round]} · {r.score}{" "}
                  分 · {r.feedback}
                </p>
              ))}
            </details>
          )}
        </div>
      </div>
    </article>
  );
}

function ReviewForm({
  item,
  submissionId,
  round,
  setRound,
  ownReview,
  double,
  arbitration,
  mutate,
  pending,
}: {
  item: PlatformState["papers"][number]["items"][number];
  submissionId: string;
  round: Review["round"];
  setRound: (round: Review["round"]) => void;
  ownReview: Review | undefined;
  double: boolean;
  arbitration: boolean;
  mutate: Mutate;
  pending: boolean;
}) {
  const mixed = item.snapshot.type === "MIXED",
    parts = item.snapshot.content.parts,
    totalWeight = parts.reduce((s, p) => s + p.score, 0);
  const [partScores, setPartScores] = useState(
    parts.map((part) => ({
      partId: part.id,
      score: ownReview?.partScores?.find((p) => p.partId === part.id)?.score ?? 0,
      feedback: ownReview?.partScores?.find((p) => p.partId === part.id)?.feedback ?? "",
    })),
  );
  const total = partScores.reduce((s, p) => s + p.score, 0);
  return (
    <form
      className="p-form"
      onSubmit={async (e) => {
        const d = readForm(e);
        await mutate({
          type: "review.save",
          review: {
            submissionId,
            itemId: item.id,
            round,
            score: mixed ? total : numberField(d, "score"),
            feedback: stringField(d, "feedback"),
            ...(mixed ? { partScores } : {}),
          },
        });
      }}
    >
      <Field label="评阅轮次">
        <select value={round} onChange={(e) => setRound(e.target.value as Review["round"])}>
          <option value="FIRST">第一评</option>
          {double && <option value="SECOND">第二评</option>}
          {double && arbitration && <option value="ARBITRATION">仲裁三评</option>}
        </select>
      </Field>
      {mixed ? (
        <>
          <h3>逐小问评分</h3>
          {parts.map((part, index) => {
            const maximum = totalWeight ? (item.score * part.score) / totalWeight : 0;
            return (
              <section className="p-part" key={part.id}>
                <strong>
                  第 {index + 1} 小问 · {Number(maximum.toFixed(4))} 分
                </strong>
                <p className="p-muted">{part.stem}</p>
                <Field label={`第 ${index + 1} 小问得分`}>
                  <input
                    required
                    type="number"
                    min={0}
                    max={maximum}
                    step="any"
                    value={partScores[index]?.score ?? 0}
                    onChange={(e) =>
                      setPartScores(
                        partScores.map((p, i) =>
                          i === index ? { ...p, score: Number(e.target.value) } : p,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label={`第 ${index + 1} 小问反馈`}>
                  <textarea
                    value={partScores[index]?.feedback ?? ""}
                    onChange={(e) =>
                      setPartScores(
                        partScores.map((p, i) =>
                          i === index ? { ...p, feedback: e.target.value } : p,
                        ),
                      )
                    }
                  />
                </Field>
              </section>
            );
          })}
          <p className="p-score" role="status">
            合计 {Number(total.toFixed(4))} / {item.score} 分
          </p>
        </>
      ) : (
        <Field label={`得分（满分 ${item.score}）`}>
          <input
            required
            type="number"
            name="score"
            min={0}
            max={item.score}
            step={0.5}
            defaultValue={ownReview?.score}
          />
        </Field>
      )}
      <Field label="批改反馈">
        <textarea
          name="feedback"
          defaultValue={ownReview?.feedback}
          placeholder="指出错误与改进建议"
        />
      </Field>
      <Submit pending={pending}>{ownReview ? "更新本轮评分" : "提交本轮评分"}</Submit>
    </form>
  );
}
