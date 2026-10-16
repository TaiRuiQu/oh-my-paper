"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import type { TeachingSession } from "@/contracts/teaching";
import { Field } from "@/components/platform/primitives";
import { useAiProgress } from "@/components/platform/use-ai-progress";
import { useUnsavedChanges } from "@/components/platform/use-unsaved-changes";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { aiJobHref } from "@/lib/ai-job-display";

export function AiPreparation({
  session,
  disabled,
}: {
  session: TeachingSession;
  disabled: boolean;
}) {
  const [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [requirements, setRequirements] = useState(""),
    [modelId, setModelId] = useState(""),
    [busy, setBusy] = useState(false),
    [jobId, setJobId] = useState("");
  const lock = useRef(false);
  const { markSaved } = useUnsavedChanges(
    !!requirements,
    "有未提交的 AI 备课要求，离开后会丢失。确定离开？",
  );
  const { models, jobs, failure, loading, reconnect } = useAiProgress({
    onCompleted: async () =>
      setNotice("AI 任务列表已更新，请按下方本课堂任务行核对状态；当前编辑不会自动替换。"),
  });
  const relevant = jobs.filter(
    (job) =>
      job.kind === "LESSON_PREPARE" &&
      typeof job.input === "object" &&
      job.input !== null &&
      "sessionId" in job.input &&
      job.input.sessionId === session.id,
  );
  return (
    <>
      <p>
        AI
        自主查阅当前授权课程、材料与题库，生成可编辑草稿。教师须核对后人工确认；人工备课可直接完成授课准备。
      </p>
      {failure && (
        <p className="p-notice error" role="alert">
          {failure}
          <button type="button" className="button secondary" onClick={() => void reconnect()}>
            重新连接 AI 状态
          </button>
        </p>
      )}
      {error && (
        <p className="p-notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="p-notice">
          {notice}
          {jobId && (
            <>
              {" "}
              <Link href={aiJobHref(jobId)}>查看备课任务</Link>
            </>
          )}
        </p>
      )}
      {!session.canPrepare ? (
        requirements ? (
          <Field
            label="未提交的 AI 备课要求（仅本页保留）"
            hint="课堂已开始或备课权限已变化，不能提交这些要求。可复制另存；离开本页会丢失。"
          >
            <textarea readOnly value={requirements} />
          </Field>
        ) : (
          <p>当前课堂不能继续 AI 备课，已有任务仍可查看。</p>
        )
      ) : (
        <form
          className="p-form"
          inert={disabled || busy}
          onSubmit={async (event) => {
            event.preventDefault();
            if (disabled || busy || lock.current || !models.length) return;
            lock.current = true;
            setBusy(true);
            setNotice("");
            setError("");
            try {
              const result = await apiRequest<{ id: string }>("/api/platform/ai", {
                method: "POST",
                ...jsonBody({
                  kind: "LESSON_PREPARE",
                  modelId: modelId || models[0].id,
                  input: {
                    sessionId: session.id,
                    publicationId: session.binding.publicationId,
                    expectedVersion: session.version,
                    expectedPlanVersion: session.planVersion,
                    expectedBindingVersion: session.bindingVersion,
                    requirements,
                  },
                }),
              });
              setJobId(result.id);
              setNotice("AI 备课任务已提交，完成后保存为待核对草稿，不会自动确认或开课。");
              markSaved();
              setRequirements("");
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "AI 备课提交失败，请重试。");
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          <Field label="备课使用模型">
            <select
              disabled={disabled || busy || !models.length}
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            >
              <option value="">
                {models[0] ? `默认：${models[0].name}` : loading ? "正在读取模型…" : "暂无可用模型"}
              </option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="AI 备课要求（选填）">
            <textarea
              maxLength={10000}
              value={requirements}
              onChange={(event) => setRequirements(event.target.value)}
              placeholder="说明教学目标、活动偏好、已有材料或需要解决的问题"
            />
          </Field>
          {!models.length && !loading && (
            <p>当前没有可用模型，可继续人工编写教案，也可联系管理员配置模型。</p>
          )}
          <button
            type="submit"
            className="button secondary"
            disabled={disabled || busy || !models.length}
          >
            {busy ? "正在提交 AI 备课…" : "生成 AI 备课草稿"}
          </button>
        </form>
      )}
      {!!relevant.length && (
        <ul>
          {relevant.slice(0, 5).map((job) => (
            <li key={job.id}>
              <Link href={aiJobHref(job.id)}>
                备课任务 ·{" "}
                {
                  {
                    QUEUED: "排队中",
                    RUNNING: "处理中",
                    COMPLETED: "已完成，待核对",
                    FAILED: "失败，可查看原因",
                  }[job.status]
                }
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
