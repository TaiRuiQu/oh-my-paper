"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import type { PracticeAttemptSummary } from "@/contracts/practice";
import { Field } from "@/components/platform/primitives";
import { useAiProgress } from "@/components/platform/use-ai-progress";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { aiJobHref } from "@/lib/ai-job-display";
export function PracticeAiFeedback({
  attempt,
  disabled,
}: {
  attempt: PracticeAttemptSummary;
  disabled: boolean;
}) {
  const [modelId, setModelId] = useState(""),
    [pending, setPending] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [jobId, setJobId] = useState("");
  const lock = useRef(false);
  const { models, jobs, failure, loading, reconnect } = useAiProgress({
    onCompleted: async () =>
      setNotice("AI任务状态已更新，请按本练习任务行核对；不会自动替换当前输入。"),
  });
  const relevant = jobs.filter(
    (job) => job.kind === "PRACTICE_GRADE" && job.practice?.attemptId === attempt.id,
  );
  return (
    <>
      <p>
        AI可自主读取本轮冻结题目、参考与作答，反馈保存为候选，不代表教师确认。也可直接自评或请求教师核验。
      </p>
      {failure && (
        <p className="p-notice error" role="alert">
          {failure}
          <button type="button" className="button secondary" onClick={() => void reconnect()}>
            重新连接AI状态
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
          {jobId && <Link href={aiJobHref(jobId)}>查看任务状态</Link>}
        </p>
      )}
      <Field label="练习反馈AI模型">
        <select
          value={modelId}
          disabled={pending || disabled}
          onChange={(event) => setModelId(event.target.value)}
        >
          <option value="">
            {models[0] ? `默认：${models[0].name}` : loading ? "正在读取模型…" : "暂无可用模型"}
          </option>
          {models.map((model) => (
            <option value={model.id} key={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </Field>
      <button
        type="button"
        className="button secondary"
        disabled={pending || disabled || !attempt.canRequestAi || !models.length}
        onClick={async () => {
          if (lock.current || disabled || !models.length) return;
          lock.current = true;
          setPending(true);
          setNotice("");
          setError("");
          try {
            const result = await apiRequest<{ id: string }>("/api/platform/ai", {
              method: "POST",
              ...jsonBody({
                kind: "PRACTICE_GRADE",
                modelId: modelId || models[0].id,
                input: {
                  attemptId: attempt.id,
                  sessionId: attempt.sessionId,
                  expectedEvaluationVersion: attempt.evaluationVersion,
                  attemptFingerprint: attempt.attemptFingerprint,
                  contentFingerprint: attempt.contentFingerprint,
                },
              }),
            });
            setJobId(result.id);
            setNotice("反馈任务已提交，完成后请明确重新读取本练习核对候选。");
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "请求失败，请重试。");
          } finally {
            lock.current = false;
            setPending(false);
          }
        }}
      >
        {pending ? "正在请求…" : "请求AI反馈候选"}
      </button>
      {!models.length && !loading && <p>当前无可用模型，可继续人工自评或请求教师核验。</p>}
      {relevant.map((job) => (
        <p key={job.id}>
          <Link href={aiJobHref(job.id)}>本轮AI反馈任务</Link> ·{" "}
          {job.status === "COMPLETED"
            ? "候选已保存，请明确重新读取"
            : job.status === "FAILED"
              ? "处理失败，可核对任务原因后重试"
              : "处理中"}
        </p>
      ))}
    </>
  );
}
