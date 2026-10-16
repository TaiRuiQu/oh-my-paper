"use client";
import { useRef, useState } from "react";
import type {
  PracticeAnswer,
  PracticeAssetUploadResult,
  PracticeEvaluationInput,
  PracticeSessionDetail,
} from "@/contracts/practice";
import { Field } from "@/components/platform/primitives";
import { useUnsavedChanges } from "@/components/platform/use-unsaved-changes";
import { formatSchoolDateTime } from "@/lib/date-time";
import { apiRequest } from "@/lib/http-client";
import { PracticeAnswerEditor } from "./answer-editor";
import {
  PracticeEligibility,
  PracticeEvaluationEditor,
  PracticeEvaluationReading,
  PracticeReferenceReading,
  initialEvaluation,
} from "./feedback";
import { PracticeForm, PracticePanel } from "./primitives";
import { PracticeHistoryView } from "./history";
import { PracticeAiFeedback } from "./ai-feedback";
import { PracticePaper } from "./paper";
import { usePractice } from "./provider";
import styles from "./practice.module.css";
const feedbackLabels: Record<PracticeSessionDetail["session"]["feedbackState"], string> = {
  NONE: "已提交 · 尚无反馈",
  WAITING: "已提交 · 待反馈",
  AI_CANDIDATE: "AI反馈候选 · 待人工核验",
  SELF: "本人自评 · 未经教师确认",
  TEACHER_CONFIRMED: "教师核验已完成",
};
export function StudentPractice({ detail }: { detail: PracticeSessionDetail }) {
  const { pending, stale, refresh, write } = usePractice<PracticeSessionDetail>();
  const draft = detail.draft;
  const [answers, setAnswers] = useState<PracticeAnswer[]>(() =>
      structuredClone(draft?.answers ?? []),
    ),
    [dirty, setDirty] = useState(false),
    [uploading, setUploading] = useState(false),
    [unresolved, setUnresolved] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [receipt, setReceipt] = useState(""),
    [action, setAction] = useState<"self" | "review" | "retry" | null>(null);
  const lock = useRef(false),
    requestId = useRef(crypto.randomUUID());
  const { markSaved } = useUnsavedChanges(
    dirty || unresolved,
    "有未保存的练习作答或图片，离开后会丢失。确定离开？",
  );
  const disabled = pending || stale || uploading || conflict;
  const attempt = detail.currentAttempt;
  async function reload() {
    if (
      lock.current ||
      uploading ||
      ((dirty || unresolved || action) &&
        !window.confirm("重新读取会放弃当前未保存作答与图片。确定重新读取？"))
    )
      return;
    lock.current = true;
    try {
      await refresh();
      markSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取失败，作答仍保留。");
    } finally {
      lock.current = false;
    }
  }
  async function save() {
    if (lock.current || disabled || unresolved || !draft || !detail.capabilities.canSaveDraft)
      return;
    lock.current = true;
    try {
      const result = await write({
        type: "practice.draft.save",
        sessionId: detail.session.id,
        expectedVersion: detail.session.version,
        expectedDraftVersion: draft.version,
        answers,
      });
      if (result.ok) {
        markSaved();
        setDirty(false);
      } else {
        setError(result.error);
        setConflict(result.conflict);
      }
    } finally {
      lock.current = false;
    }
  }
  async function submit() {
    if (lock.current || disabled || dirty || unresolved || !draft || !detail.capabilities.canSubmit)
      return;
    const total = detail.papers.reduce((sum, paper) => sum + paper.items.length, 0),
      filled = answers.filter((answer) => answer.text.trim() || answer.images.length).length;
    if (
      !window.confirm(
        `确认提交本轮练习？${filled < total ? `有 ${total - filled} 题未填写。` : ""}本轮提交不可修改，再练会保留历史。`,
      )
    )
      return;
    lock.current = true;
    try {
      const result = await write({
        type: "practice.submit",
        sessionId: detail.session.id,
        expectedVersion: detail.session.version,
        expectedDraftVersion: draft.version,
        requestId: requestId.current,
      });
      if (result.ok) {
        markSaved();
        setReceipt(`提交已收到：第 ${result.result.sequence ?? "本"} 次提交。`);
      } else {
        setError(result.error);
        setConflict(result.conflict);
      }
    } finally {
      lock.current = false;
    }
  }
  return (
    <>
      <PracticePanel
        title={detail.session.name}
        description="私人草稿仅本人可读；提交后按本轮内容记录反馈，练习不改写正式成绩。"
        actions={
          <button
            type="button"
            className="button secondary"
            disabled={pending || uploading}
            onClick={() => void reload()}
          >
            重新读取本次练习
          </button>
        }
      >
        <p>
          {detail.session.status === "DRAFT"
            ? "练习草稿 · 本轮尚未提交、尚未核验"
            : detail.session.reviewRequestedAt
              ? "已提交 · 已请求教师核验，待教师处理"
              : feedbackLabels[detail.session.feedbackState]}{" "}
          · {detail.session.subject} · {detail.session.student.name}
        </p>
        <PracticeEligibility items={detail.eligibility} />
        {detail.capabilities.blockReasons.map((reason, index) => (
          <p className={styles.help} key={index}>
            {reason}
          </p>
        ))}
        {receipt && (
          <p role="status" className="p-notice">
            {receipt}
          </p>
        )}
        {attempt && (
          <p role="status" className="p-notice">
            {detail.session.status === "DRAFT" ? "上次提交回执" : "服务端回执"}：第{" "}
            {attempt.sequence} 次提交 · {formatSchoolDateTime(attempt.submittedAt, detail.timezone)}
          </p>
        )}
        {error && (
          <div role="alert" className="p-notice error">
            <p>{error}</p>
            {conflict && <p>版本已改变，作答仍保留，不会自动套用新版本提交。</p>}
            <button
              type="button"
              className="button secondary"
              disabled={pending || uploading}
              onClick={() => void reload()}
            >
              放弃作答并重新读取
            </button>
          </div>
        )}
      </PracticePanel>
      {draft && detail.capabilities.canSaveDraft ? (
        <PracticePanel
          title="本轮作答"
          description="先保存全部文字和图片，再明确提交；上传失败需重试或移除。"
        >
          <p role="status">
            {pending
              ? "正在保存或读取，暂时不能编辑"
              : dirty || unresolved
                ? "有未保存的作答或图片"
                : draft.version > 0
                  ? `草稿已保存 · v${draft.version}${draft.updatedAt ? ` · ${formatSchoolDateTime(draft.updatedAt, detail.timezone)}` : ""}`
                  : "尚无已保存草稿"}
          </p>
          <PracticeAnswerEditor
            papers={detail.papers}
            answers={answers}
            onChange={(value) => {
              setAnswers(value);
              setDirty(true);
            }}
            disabled={disabled}
            upload={async (file) => {
              const body = new FormData();
              body.set("file", file);
              const result = await apiRequest<PracticeAssetUploadResult>(
                `/api/platform/practice/sessions/${detail.session.id}/assets`,
                { method: "POST", body },
              );
              return result.url;
            }}
            onUploading={setUploading}
            onUnresolved={setUnresolved}
          />
          <div className="p-actions">
            <button
              type="button"
              className="button secondary"
              disabled={disabled || unresolved}
              onClick={() => void save()}
            >
              保存练习草稿
            </button>
            {detail.capabilities.canSubmit && (
              <button
                type="button"
                className="button"
                disabled={disabled || dirty || unresolved || !!action}
                onClick={() => void submit()}
              >
                确认提交本轮练习
              </button>
            )}
          </div>
        </PracticePanel>
      ) : (
        <PracticePanel title="本轮题面与反馈状态">
          {detail.papers.map((paper, index) => (
            <PracticePaper key={paper.id} paper={paper} context={`当前第 ${index + 1} 份题面`} />
          ))}
          <p className={styles.help}>本轮提交内容可从下方历史读取；反馈会保留来源和版本。</p>
        </PracticePanel>
      )}
      <PracticePanel
        title="参考答案与核对"
        description="查看参考会记录系统已提供答案；后续再练不能冒充未看参考的独立尝试。"
      >
        {detail.reference && (
          <PracticeReferenceReading
            reference={detail.reference}
            papers={detail.papers}
            context="当前练习"
            audience="STUDENT"
          />
        )}
        {detail.capabilities.canRevealReference && (
          <button
            type="button"
            className="button secondary"
            disabled={disabled || dirty || unresolved || !!action}
            onClick={async () => {
              if (
                lock.current ||
                !!action ||
                !window.confirm(
                  "查看参考会记录答案已提供，后续再练将按复现或已参考记录。确认查看？",
                )
              )
                return;
              lock.current = true;
              try {
                const itemIds = detail.papers
                  .flatMap((paper) => paper.items.map((item) => item.id))
                  .filter((id) => !detail.revealedItemIds.includes(id));
                const result = await write({
                  type: "practice.reference.reveal",
                  sessionId: detail.session.id,
                  expectedVersion: detail.session.version,
                  itemIds,
                  reason: "本人明确选择查看参考",
                });
                if (!result.ok) {
                  setError(result.error);
                  setConflict(result.conflict);
                }
              } finally {
                lock.current = false;
              }
            }}
          >
            明确查看参考答案与解析
          </button>
        )}
        {(dirty || unresolved) && <p className={styles.help}>请先保存作答，再查看参考。</p>}
        {action && (
          <p className={styles.help}>
            请先保存或取消当前自评、核验请求或再练设置，再查看参考或请求AI反馈。
          </p>
        )}
        {attempt && detail.evaluations.length > 0 && (
          <div>
            {detail.session.status === "DRAFT" && (
              <p className="p-notice">
                以下为上次第 {attempt.sequence} 次提交的历史反馈；本轮草稿尚未提交、尚未核验。
              </p>
            )}
            {detail.evaluations.map((evaluation) => (
              <PracticeEvaluationReading
                key={evaluation.id}
                evaluation={evaluation}
                papers={detail.papers}
                attemptSequence={attempt.sequence}
                reviewPending={!!detail.session.reviewRequestedAt}
                timezone={detail.timezone}
              />
            ))}
          </div>
        )}
        {attempt && (
          <>
            <div className="p-actions">
              {attempt.canSelfAssess && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={disabled || !!action}
                  onClick={() => setAction("self")}
                >
                  记录本人自评
                </button>
              )}
              {attempt.canRequestReview && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={disabled || !!action}
                  onClick={() => setAction("review")}
                >
                  请求教师核验
                </button>
              )}
              {detail.capabilities.canRetry && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={disabled || !!action}
                  onClick={() => setAction("retry")}
                >
                  开始下一轮再练
                </button>
              )}
            </div>
            {action && (
              <StudentAction
                key={action}
                action={action}
                detail={detail}
                close={() => setAction(null)}
              />
            )}
            <details>
              <summary>可选：请求AI反馈候选</summary>
              <PracticeAiFeedback
                attempt={attempt}
                disabled={disabled || dirty || unresolved || !!action}
              />
            </details>
          </>
        )}
      </PracticePanel>
      {detail.capabilities.canViewHistory && (
        <PracticePanel title="不可变提交与反馈历史">
          <PracticeHistoryView sessionId={detail.session.id} />
        </PracticePanel>
      )}
    </>
  );
}
function StudentAction({
  action,
  detail,
  close,
}: {
  action: "self" | "review" | "retry";
  detail: PracticeSessionDetail;
  close: () => void;
}) {
  const [evaluation, setEvaluation] = useState<PracticeEvaluationInput>(() =>
      initialEvaluation(detail.papers),
    ),
    [message, setMessage] = useState(""),
    [copy, setCopy] = useState(false);
  const attempt = detail.currentAttempt!;
  return (
    <PracticeForm
      label={
        action === "self"
          ? "保存本人自评"
          : action === "review"
            ? "确认请求教师核验"
            : "确认创建下一轮草稿"
      }
      close={close}
      command={() =>
        action === "self"
          ? {
              type: "practice.self-assess",
              attemptId: attempt.id,
              expectedEvaluationVersion: attempt.evaluationVersion,
              evaluation,
            }
          : action === "review"
            ? {
                type: "practice.review.request",
                attemptId: attempt.id,
                expectedEvaluationVersion: attempt.evaluationVersion,
                message,
              }
            : {
                type: "practice.retry",
                sessionId: detail.session.id,
                expectedVersion: detail.session.version,
                copyPreviousAnswers: copy,
              }
      }
    >
      {action === "self" ? (
        <>
          <p className="p-notice">
            本人自评单独记录，不计为教师确认；不能辨认的内容请选待核验或跳过并说明原因。
          </p>
          <PracticeEvaluationEditor
            papers={detail.papers}
            value={evaluation}
            onChange={setEvaluation}
          />
        </>
      ) : action === "review" ? (
        <Field label="希望老师核对的问题">
          <textarea
            maxLength={2000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </Field>
      ) : (
        <>
          <p>下一轮保留全部旧提交与反馈；参考曝光状态继续保留，不重置为新题。</p>
          <label>
            <input
              type="checkbox"
              checked={copy}
              onChange={(event) => setCopy(event.target.checked)}
            />{" "}
            明确复制上一轮作答到新草稿（用于订正）
          </label>
        </>
      )}
    </PracticeForm>
  );
}
