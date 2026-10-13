"use client";
import Link from "next/link";
import { useState } from "react";
import { taskErrorMessage } from "@/lib/error-message";
import { useQuery } from "@tanstack/react-query";
import type { GradingWorkflow } from "@/contracts/workflows";
import type { ExamTaskDetail } from "@/contracts/exam-tasks";
import { apiRequest } from "@/lib/http-client";
import { formatDateTime } from "@/lib/date-time";
import { ProcessingState, StatusBadge } from "./processing-state";
import { AgentResultContent } from "./exam-agents";
import { RecognitionActivityFeed } from "./recognition-activity";
const stages = { RECOGNITION: "试卷识别", ANSWER: "标准答案", GRADING: "答卷批改" };
export function WorkflowResult({
  initialWorkflow,
  isAdmin,
}: {
  initialWorkflow: GradingWorkflow;
  isAdmin: boolean;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["workflow", initialWorkflow.id],
    queryFn: () =>
      apiRequest<{ workflow: GradingWorkflow }>(`/api/workflows/${initialWorkflow.id}`),
    initialData: { workflow: initialWorkflow },
    refetchInterval: (query) =>
      ["QUEUED", "RUNNING"].includes(query.state.data?.workflow.status ?? "") ? 2000 : false,
  });
  const flow = query.data.workflow;
  const exam = useQuery({
    queryKey: ["exam", flow.sourceId],
    queryFn: () => apiRequest<ExamTaskDetail>(`/api/exams/${flow.sourceId}`),
    enabled: flow.source.status === "COMPLETED",
  });
  async function retry() {
    setPending(true);
    setError("");
    try {
      await apiRequest(`/api/workflows/${flow.id}/retry`, { method: "POST" });
      await query.refetch();
    } catch (error) {
      setError(
        isAdmin && error instanceof Error
          ? error.message
          : taskErrorMessage(error, "暂时无法重试，请稍后再试。"),
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Link className="back-link" href={flow.kind === "QUICK" ? "/quick-grading" : "/grading"}>
        返回{flow.kind === "QUICK" ? "快速批改" : "批改管理"}
      </Link>
      <div className="page-heading">
        <div>
          <h1>{flow.status === "COMPLETED" ? "批改报告" : "答卷详情"}</h1>
          <p className="intro">
            {flow.name} · <time dateTime={flow.createdAt}>{formatDateTime(flow.createdAt)}</time>
          </p>
        </div>
        <StatusBadge status={flow.status} />
      </div>
      {query.error && (
        <p className="form-error" role="alert">
          {isAdmin ? query.error.message : "页面暂时无法刷新。"}
          <button className="button secondary" onClick={() => void query.refetch()}>
            重新加载
          </button>
        </p>
      )}
      {["QUEUED", "RUNNING"].includes(flow.status) && (
        <section className="surface">
          <ProcessingState
            creditLabel={isAdmin ? "折算用量" : "已消费"}
            creditsSpent={flow.creditsSpent ?? "0"}
            startedAt={flow.createdAt}
            progress={
              flow.progress
                ? [
                    ...(flow.kind === "QUICK"
                      ? [{ label: "已解析题目", ...flow.progress.recognition }]
                      : []),
                    { label: "已准备答案", ...flow.progress.answer },
                    { label: "已批改题目", ...flow.progress.grading },
                  ]
                : undefined
            }
          />
        </section>
      )}
      {flow.status === "FAILED" && (
        <section className="surface recovery-notice">
          <h2>这次批改未能完成</h2>
          <p role="alert">
            {isAdmin
              ? flow.error
              : flow.errorCode === "CREDITS_EXHAUSTED"
                ? "Credit 余额为负，无法开始后续任务。已有结果保留，请联系管理员。"
                : "请重试，无需再次上传答卷。"}
          </p>
          <button className="button" disabled={pending} onClick={() => void retry()}>
            {pending ? "正在提交" : "重试批改"}
          </button>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
      {flow.status === "COMPLETED" && (
        <section className="surface detail-surface">
          <div className="section-heading">
            <h2>{flow.source.name}</h2>
            <Link className="text-action" href={`/exams/${flow.sourceId}?view=answers`}>
              查看标准答案
            </Link>
          </div>
          {exam.data?.exam && flow.grading ? (
            <AgentResultContent task={flow.grading} exam={exam.data.exam} />
          ) : exam.error ? (
            <p className="form-error" role="alert">
              报告暂时无法加载。
              <button className="button secondary" onClick={() => void exam.refetch()}>
                重新加载
              </button>
            </p>
          ) : (
            <ProcessingState title="正在加载报告" />
          )}
        </section>
      )}
      {isAdmin && (
        <details className="debug-disclosure">
          <summary>管理员调试 · 当前阶段：{stages[flow.stage ?? "RECOGNITION"]}</summary>
          <p className="hint">流程 ID：{flow.id}</p>
          <RecognitionActivityFeed task={flow.source} title="试卷识别记录" />
          {[flow.answer, flow.grading].map(
            (task) =>
              task && (
                <div key={task.id}>
                  <p className="hint">
                    {task.kind === "ANSWER" ? "标准答案" : "答卷批改"} · {task.status} · 已保存{" "}
                    {task.result.questions.length} 题
                  </p>
                  {task.status !== "COMPLETED" && exam.data?.exam && (
                    <AgentResultContent task={task} exam={exam.data.exam} />
                  )}
                  <RecognitionActivityFeed
                    task={task}
                    baseURL={`/api/exams/${flow.sourceId}/agents/${task.id}/activity`}
                    title={task.kind === "ANSWER" ? "答案执行记录" : "批改执行记录"}
                  />
                </div>
              ),
          )}
        </details>
      )}
    </>
  );
}
