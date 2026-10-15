"use client";
import { reviewRule } from "@/lib/document-layout";
import Image from "next/image";
import { useRef, useState } from "react";
import type { FinalGrade, PlatformState, Review, ScanSubmission } from "@/contracts/platform";
import { Field, Submit, readForm, stringField, numberField } from "./primitives";
import { QuestionBody, type Mutate } from "./questions";
import { useUnsavedChanges } from "./use-unsaved-changes";
export function SubmissionReview({
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
            double={settings ? reviewRule(settings, item.id).doubleReview : false}
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
  const existingOwn = reviews.find((r) => r.reviewerId === state.actor.id);
  const next: Review["round"] =
    existingOwn?.round ??
    (grade?.status === "ARBITRATION"
      ? "ARBITRATION"
      : reviews.some((r) => r.round === "FIRST") && double
        ? "SECOND"
        : "FIRST");
  const [round, setRound] = useState<Review["round"]>(next);
  const history = (state.reviewHistory ?? state.reviews).filter(
    (r) => r.submissionId === submission.id && r.itemId === item.id,
  );
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
      {double && reviews.some((r) => r.round === "FIRST" && r.source === "AI") && (
        <p className="p-notice">
          本题启用双评，AI 分数作为建议。第一评教师须确认评分，另一位教师独立完成第二评。
        </p>
      )}
      {grade?.calculation && <p className="p-muted">计分依据：{grade.calculation}</p>}
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
          {state.assessments.find((a) => a.id === submission.assessmentId)?.published ? (
            <div className="p-answers">
              <h3>已发布评分 · 只读</h3>
              <p>
                最终得分：{grade?.score ?? "待评分"} / {item.score}
              </p>
              <p className="p-muted">{grade?.feedback || "暂无文字反馈"}</p>
              <button className="button secondary" disabled>
                成绩已发布
              </button>
            </div>
          ) : (
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
          )}
          {history.length > 0 && (
            <details>
              <summary>评阅记录（{history.length}）</summary>
              {history.map((r) => (
                <p key={r.id} className="p-muted">
                  {{ FIRST: "第一评", SECOND: "第二评", ARBITRATION: "仲裁" }[r.round]} · {r.score}{" "}
                  分 · {state.users.find((u) => u.id === r.reviewerId)?.name ?? r.reviewerId} ·{" "}
                  {new Date(r.createdAt).toLocaleString("zh-CN")} ·{" "}
                  {r.source === "AI" ? "AI" : "人工"} · {r.feedback}
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
  const [score, setScore] = useState(String(ownReview?.score ?? ""));
  const [feedback, setFeedback] = useState(ownReview?.feedback ?? "");
  const snapshot = JSON.stringify({ score, feedback, partScores });
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const [submitted, setSubmitted] = useState(Boolean(ownReview));
  const saving = useRef(false);
  const dirty = snapshot !== savedSnapshot;
  const { confirmDiscard, markSaved } = useUnsavedChanges(
    dirty,
    "有未提交的评分或反馈，离开后会丢失。确定离开？",
  );
  const total = partScores.reduce((s, p) => s + p.score, 0);
  return (
    <form
      className="p-form"
      onSubmit={async (e) => {
        const d = readForm(e);
        if (saving.current || pending) return;
        saving.current = true;
        try {
          const result = await mutate({
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
          if (!result.error) {
            setSavedSnapshot(snapshot);
            setSubmitted(true);
            markSaved();
          }
        } finally {
          saving.current = false;
        }
      }}
    >
      <Field label="评阅轮次">
        <select
          value={round}
          disabled={pending}
          onChange={(e) => {
            if (confirmDiscard()) setRound(e.target.value as Review["round"]);
          }}
        >
          <option value="FIRST">第一评</option>
          {double && <option value="SECOND">第二评</option>}
          {double && (arbitration || ownReview?.round === "ARBITRATION") && (
            <option value="ARBITRATION">仲裁三评</option>
          )}
        </select>
      </Field>
      <fieldset className="p-form p-review-fields" disabled={pending}>
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
              value={score}
              onChange={(e) => setScore(e.target.value)}
            />
          </Field>
        )}
        <Field label="批改反馈">
          <textarea
            name="feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="指出错误与改进建议"
          />
        </Field>
      </fieldset>
      <p className="p-muted" role="status">
        {dirty ? "本题评分有未提交修改" : submitted ? "本轮评分已提交" : "本轮评分尚未提交"}
      </p>
      <Submit pending={pending}>{ownReview ? "更新本轮评分" : "提交本轮评分"}</Submit>
    </form>
  );
}
