"use client";
import { reviewRule } from "@/lib/document-layout";
import Image from "next/image";
import { Fragment, useEffect, useRef, useState } from "react";
import type {
  FinalGrade,
  PlatformState,
  QuestionReviewRule,
  Review,
  ScanSubmission,
} from "@/contracts/platform";
import { Field, Submit, readForm, stringField, numberField } from "./primitives";
import { QuestionBody, type Mutate } from "./questions";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { submissionNeedsScanReview } from "@/lib/scan-recognition";
import { assessmentReviewBlockReason } from "@/lib/assessment-roster";
import { reviewRoundAvailability, type ReviewRoundChoice } from "@/lib/review-round-availability";
import { PaperSharedReading } from "./paper-reading";
export type LocalReviewDraft = {
  itemId: string;
  round: Review["round"];
  questionNumber: number;
  score?: string;
  feedback?: string;
  parts: { number: number; score?: number; feedback?: string }[];
};
export function SubmissionReview({
  submission,
  state,
  mutate,
  pending,
  refresh,
  readOnlyReason,
  onLocalDraft,
}: {
  submission: ScanSubmission;
  state: PlatformState;
  mutate: Mutate;
  pending: boolean;
  refresh?: () => Promise<void>;
  readOnlyReason?: string;
  onLocalDraft?: (key: string, draft: LocalReviewDraft | null) => void;
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
      {submissionNeedsScanReview(submission) && (
        <div className="p-panel-content">
          <p className="p-notice">扫描识别存在不确定信息，请核对学生卡号、图像位置和作答。</p>
        </div>
      )}
      {paper && <PaperSharedReading paper={paper} context="评阅卷首" />}
      {paper?.items.map((item, index) => {
        const answer = submission.answers.find((a) => a.itemId === item.id),
          reviews = state.reviews.filter(
            (r) => r.submissionId === submission.id && r.itemId === item.id,
          ),
          grade = grades.find((g) => g.itemId === item.id);
        return (
          <Fragment key={item.id}>
            <PaperSharedReading
              paper={paper}
              beforeItemId={item.id}
              context={`评阅第${index + 1}题前`}
            />
            <ReviewItem
              key={item.id}
              index={index}
              item={item}
              answer={answer}
              reviews={reviews}
              grade={grade}
              policy={
                settings
                  ? reviewRule(settings, item.id)
                  : { doubleReview: false, arbitrationEnabled: false, maxDifference: 0 }
              }
              state={state}
              submission={submission}
              mutate={mutate}
              pending={pending}
              refresh={refresh}
              readOnlyReason={readOnlyReason}
              onLocalDraft={onLocalDraft}
            />
          </Fragment>
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
  policy,
  state,
  submission,
  mutate,
  pending,
  refresh,
  readOnlyReason,
  onLocalDraft,
}: {
  index: number;
  item: NonNullable<PlatformState["papers"][number]>["items"][number];
  answer: ScanSubmission["answers"][number] | undefined;
  reviews: Review[];
  grade: FinalGrade | undefined;
  policy: QuestionReviewRule;
  state: PlatformState;
  submission: ScanSubmission;
  mutate: Mutate;
  pending: boolean;
  refresh?: () => Promise<void>;
  readOnlyReason?: string;
  onLocalDraft?: (key: string, draft: LocalReviewDraft | null) => void;
}) {
  const double = policy.doubleReview;
  const assessment = state.assessments.find((entry) => entry.id === submission.assessmentId);
  const published = assessment?.published === true;
  const participationBlock = assessment
    ? assessmentReviewBlockReason(assessment, submission.studentId, submission.paperId)
    : "本次安排不可用，暂不能评阅";
  const assignment = state.reviewAssignments?.find(
    (entry) => entry.submissionId === submission.id && entry.itemId === item.id,
  );
  const choices = (
    assignment?.availableRounds ??
    reviewRoundAvailability({ reviewerId: state.actor.id, reviews, policy })
  ).map((choice) => (participationBlock ? { ...choice, reason: participationBlock } : choice));
  const occupiedRounds = assignment?.rounds ?? reviews;
  const existingOwn = reviews.find((r) => r.reviewerId === state.actor.id);
  const next: Review["round"] =
    existingOwn?.round ??
    (grade?.status === "ARBITRATION"
      ? "ARBITRATION"
      : occupiedRounds.some((r) => r.round === "FIRST") && double
        ? "SECOND"
        : "FIRST");
  const [round, setRound] = useState<Review["round"] | undefined>(
    () =>
      choices.find((choice) => choice.round === next && !choice.reason)?.round ??
      choices.find((choice) => !choice.reason)?.round,
  );
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
          {participationBlock
            ? "暂停评阅"
            : grade?.status === "FINAL"
              ? `最终得分 ${grade.score}`
              : grade?.status === "ARBITRATION"
                ? "等待仲裁"
                : grade?.status === "SECOND"
                  ? "等待第二评"
                  : "等待评分"}
        </span>
      </div>
      {assignment?.blind && (
        <p className="p-notice" role="status">
          本题正在独立双评。两位教师完成评分前，仅显示您自己的评分和反馈。
        </p>
      )}
      {double && occupiedRounds.some((r) => r.round === "FIRST" && r.source === "AI") && (
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
          {published && (
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
          )}
          {!round ? (
            !published && (
              <div className="p-answers">
                <p>本题当前没有可执行的评阅轮次。</p>
                <ReviewRoundSelect choices={choices} pending={pending} onChange={setRound} />
              </div>
            )
          ) : (
            <ReviewForm
              key={round}
              questionNumber={index + 1}
              item={item}
              submissionId={submission.id}
              round={round}
              setRound={setRound}
              ownReview={ownReview}
              choices={choices}
              mutate={mutate}
              pending={pending}
              published={published}
              readOnlyReason={readOnlyReason}
              onLocalDraft={onLocalDraft}
              refresh={refresh}
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

function ReviewRoundSelect({
  choices,
  round,
  pending,
  onChange,
}: {
  choices: ReviewRoundChoice[];
  round?: Review["round"];
  pending: boolean;
  onChange?: (round: Review["round"]) => void;
}) {
  return (
    <>
      <Field label="评阅轮次">
        <select
          value={round ?? ""}
          disabled={pending || !choices.some((choice) => !choice.reason)}
          onChange={(event) => {
            const choice = choices.find((entry) => entry.round === event.target.value);
            if (choice && !choice.reason) onChange?.(choice.round);
          }}
        >
          {!round && <option value="">请选择可执行轮次</option>}
          {choices.map((choice) => (
            <option key={choice.round} value={choice.round} disabled={!!choice.reason}>
              {choice.label}
              {choice.reason ? `（${choice.reason}）` : ""}
            </option>
          ))}
        </select>
      </Field>
      <p className="p-muted">
        {choices
          .filter((choice) => choice.reason)
          .map((choice) => `${choice.label}：${choice.reason}`)
          .join("；")}
      </p>
    </>
  );
}

function ReviewForm({
  questionNumber,
  item,
  submissionId,
  round,
  setRound,
  ownReview,
  choices,
  mutate,
  pending,
  published,
  refresh,
  readOnlyReason,
  onLocalDraft,
}: {
  questionNumber: number;
  item: PlatformState["papers"][number]["items"][number];
  submissionId: string;
  round: Review["round"];
  setRound: (round: Review["round"]) => void;
  ownReview: Review | undefined;
  choices: ReviewRoundChoice[];
  mutate: Mutate;
  pending: boolean;
  published: boolean;
  refresh?: () => Promise<void>;
  readOnlyReason?: string;
  onLocalDraft?: (key: string, draft: LocalReviewDraft | null) => void;
}) {
  const mixed = item.snapshot.type === "MIXED",
    parts = item.snapshot.content.parts,
    totalWeight = parts.reduce((s, p) => s + p.score, 0);
  const incomingDraft = {
    score: String(ownReview?.score ?? ""),
    feedback: ownReview?.feedback ?? "",
    partScores: parts.map((part) => ({
      partId: part.id,
      score: ownReview?.partScores?.find((p) => p.partId === part.id)?.score ?? 0,
      feedback: ownReview?.partScores?.find((p) => p.partId === part.id)?.feedback ?? "",
    })),
  };
  const incomingSnapshot = JSON.stringify(incomingDraft);
  const incomingSignature = JSON.stringify({
    id: ownReview?.id,
    version: ownReview?.version ?? 0,
    source: ownReview?.source,
    snapshot: incomingSnapshot,
  });
  const [sourceSignature, setSourceSignature] = useState(incomingSignature);
  const [baselineVersion, setBaselineVersion] = useState(ownReview?.version ?? 0);
  const [saveError, setSaveError] = useState("");
  const [versionRejected, setVersionRejected] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [comparisonRead, setComparisonRead] = useState(false);
  const [reloadError, setReloadError] = useState("");
  const [partScores, setPartScores] = useState(incomingDraft.partScores);
  const [score, setScore] = useState(incomingDraft.score);
  const [feedback, setFeedback] = useState(incomingDraft.feedback);
  const snapshot = JSON.stringify({ score, feedback, partScores });
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const [submitted, setSubmitted] = useState(Boolean(ownReview));
  const [savingDraft, setSavingDraft] = useState(false);
  const saving = useRef(false);
  const dirty = snapshot !== savedSnapshot;
  useEffect(() => {
    if (!onLocalDraft) return;
    const baseline = JSON.parse(savedSnapshot) as typeof incomingDraft;
    onLocalDraft(
      `${item.id}/${round}`,
      dirty
        ? {
            itemId: item.id,
            round,
            questionNumber,
            ...(score !== baseline.score ? { score } : {}),
            ...(feedback !== baseline.feedback ? { feedback } : {}),
            parts: partScores.flatMap((part, index) => {
              const previous = baseline.partScores[index];
              return part.score !== previous?.score || part.feedback !== previous?.feedback
                ? [
                    {
                      number: index + 1,
                      ...(part.score !== previous?.score ? { score: part.score } : {}),
                      ...(part.feedback !== previous?.feedback ? { feedback: part.feedback } : {}),
                    },
                  ]
                : [];
            }),
          }
        : null,
    );
  }, [
    onLocalDraft,
    savedSnapshot,
    snapshot,
    dirty,
    item.id,
    round,
    questionNumber,
    score,
    feedback,
    partScores,
  ]);
  // Adopt each external version once. A refresh must never replace a draft or replay
  // an older in-flight response after this form finishes saving its local version.
  if (sourceSignature !== incomingSignature) {
    setSourceSignature(incomingSignature);
    if (!dirty && !savingDraft && (ownReview?.version ?? 0) >= baselineVersion) {
      setScore(incomingDraft.score);
      setFeedback(incomingDraft.feedback);
      setPartScores(incomingDraft.partScores);
      setSavedSnapshot(incomingSnapshot);
      setSubmitted(Boolean(ownReview));
      setBaselineVersion(ownReview?.version ?? 0);
      setVersionRejected(false);
      setSaveError("");
    }
  }
  const { confirmDiscard, markSaved } = useUnsavedChanges(
    dirty,
    "有未提交的评分或反馈，离开后会丢失。确定离开？",
  );
  const total = partScores.reduce((s, p) => s + p.score, 0);
  const unavailableReason = choices.find((choice) => choice.round === round)?.reason;
  const externalChanged = (ownReview?.version ?? 0) > baselineVersion;
  const versionConflict = versionRejected || externalChanged;
  const blocked =
    published || !!readOnlyReason || !!unavailableReason || versionConflict || reloading;
  // Publication changes write access, but must not unmount another question's draft.
  // Keep the form instance alive so an explicit withdrawal can restore its inputs.
  if ((published || readOnlyReason) && !dirty && !savingDraft) return null;
  return (
    <form
      className="p-form"
      onSubmit={async (e) => {
        const d = readForm(e);
        if (
          saving.current ||
          pending ||
          blocked ||
          !choices.some((choice) => choice.round === round && !choice.reason)
        )
          return;
        saving.current = true;
        setSavingDraft(true);
        try {
          const result = await mutate({
            type: "review.save",
            review: {
              submissionId,
              itemId: item.id,
              round,
              expectedVersion: baselineVersion,
              score: mixed ? total : numberField(d, "score"),
              feedback: stringField(d, "feedback"),
              ...(mixed ? { partScores } : {}),
            },
          });
          if (!result.error) {
            // Accepted writes increment exactly once, even if the subsequent state read failed.
            setBaselineVersion(result.reviewVersion ?? baselineVersion + 1);
            setSaveError("");
            setVersionRejected(false);
            setComparisonRead(false);
            setSavedSnapshot(snapshot);
            setSubmitted(true);
            markSaved();
          } else {
            setSaveError(result.error);
            if (result.errorStatus === 409) {
              setVersionRejected(true);
              setComparisonRead(false);
            }
          }
        } finally {
          saving.current = false;
          setSavingDraft(false);
        }
      }}
    >
      <ReviewRoundSelect
        choices={choices}
        round={round}
        pending={pending || savingDraft || reloading || published || !!readOnlyReason}
        onChange={(nextRound) => {
          if (confirmDiscard()) {
            onLocalDraft?.(`${item.id}/${round}`, null);
            setRound(nextRound);
          }
        }}
      />
      {(published || readOnlyReason) && (
        <section
          className="p-answers"
          aria-label={`第 ${questionNumber} 题${readOnlyReason ? "旧提交的" : "已发布后的"}本地评分草稿`}
        >
          <p className="p-notice" role="status">
            {readOnlyReason
              ? `${readOnlyReason}本题未提交的评分与反馈保留在下方，只供核对，不能写入旧提交或自动转移到新提交。`
              : "成绩已由其他操作发布。本题未提交的评分与反馈保留在下方，只供核对，不会写入已发布成绩。如需继续修改，请先由有权限的教师撤回发布，再重新读取核对。"}
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={pending || savingDraft || reloading}
            onClick={() => {
              if (!confirmDiscard()) return;
              setScore(incomingDraft.score);
              setFeedback(incomingDraft.feedback);
              setPartScores(incomingDraft.partScores);
              setSavedSnapshot(incomingSnapshot);
              setBaselineVersion(ownReview?.version ?? 0);
              setSubmitted(Boolean(ownReview));
              setVersionRejected(false);
              setSaveError("");
              setComparisonRead(false);
              markSaved();
            }}
          >
            放弃本题未提交草稿
          </button>
        </section>
      )}
      {unavailableReason && (
        <p className="p-notice error" role="alert">
          当前轮次暂不可提交：{unavailableReason}
          。已保留本题草稿，请先核对参与状态与评阅记录；如有其他可用轮次，可明确切换。
        </p>
      )}
      {(versionConflict || saveError) && (
        <section className="p-answers" aria-label="评分版本核对">
          <p className="p-notice error" role="alert">
            {versionConflict
              ? "这轮评分的服务端记录已变化或提交被拒绝。本地草稿已保留，请重新读取并比较；不会自动覆盖最新评分。"
              : saveError}
          </p>
          {versionConflict && (
            <p className="p-muted">
              {saveError ||
                `当前草稿基于版本 ${baselineVersion}，已收到版本 ${ownReview?.version}。`}
            </p>
          )}
          {refresh && (
            <button
              type="button"
              className="button secondary"
              disabled={pending || reloading || savingDraft}
              onClick={async () => {
                setReloading(true);
                setReloadError("");
                setComparisonRead(false);
                try {
                  await refresh();
                  setComparisonRead(true);
                } catch (error) {
                  setReloadError(
                    error instanceof Error ? error.message : "读取最新评分失败，请重试。",
                  );
                } finally {
                  setReloading(false);
                }
              }}
            >
              {reloading ? "正在读取最新评分…" : "重新读取最新评分并比较"}
            </button>
          )}
          {reloadError && (
            <p className="p-notice error" role="alert">
              {reloadError}。本地草稿仍保留。
            </p>
          )}
          {comparisonRead && (
            <>
              <div className="p-split">
                <div>
                  <h3>本地未提交草稿</h3>
                  <p>
                    得分：{mixed ? total : score || "未填写"} / {item.score}
                  </p>
                  <p className="p-question-content">{feedback || "暂无反馈"}</p>
                  {mixed &&
                    partScores.map((part, index) => (
                      <p key={part.partId}>
                        第 {index + 1} 小问：{part.score} · {part.feedback || "暂无反馈"}
                      </p>
                    ))}
                </div>
                <div>
                  <h3>最新已保存评分</h3>
                  <p>
                    {ownReview
                      ? `版本 ${ownReview.version} · 得分 ${ownReview.score} / ${item.score}`
                      : "本轮暂无本人已保存评分"}
                  </p>
                  <p className="p-question-content">{ownReview?.feedback || "暂无反馈"}</p>
                  {mixed &&
                    incomingDraft.partScores.map((part, index) => (
                      <p key={part.partId}>
                        第 {index + 1} 小问：{part.score} · {part.feedback || "暂无反馈"}
                      </p>
                    ))}
                </div>
              </div>
              <button
                type="button"
                className="button secondary"
                disabled={pending || reloading || savingDraft || !!unavailableReason}
                onClick={() => {
                  if (!confirmDiscard()) return;
                  setScore(incomingDraft.score);
                  setFeedback(incomingDraft.feedback);
                  setPartScores(incomingDraft.partScores);
                  setSavedSnapshot(incomingSnapshot);
                  setBaselineVersion(ownReview?.version ?? 0);
                  setSubmitted(Boolean(ownReview));
                  setVersionRejected(false);
                  setSaveError("");
                  setComparisonRead(false);
                  markSaved();
                }}
              >
                放弃本地草稿并采用最新评分
              </button>
              <p className="p-muted">
                采用后请重新编辑并确认评分，再提交。未选择采用时，原草稿继续保留。
              </p>
            </>
          )}
        </section>
      )}
      <fieldset
        className="p-form p-review-fields"
        disabled={
          published ||
          !!readOnlyReason ||
          pending ||
          savingDraft ||
          reloading ||
          !!unavailableReason
        }
      >
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
              step="any"
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
      <Submit pending={pending || savingDraft} disabled={blocked}>
        {ownReview ? "更新本轮评分" : "提交本轮评分"}
      </Submit>
    </form>
  );
}
