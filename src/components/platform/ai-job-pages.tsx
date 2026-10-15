"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AiJobDTO } from "@/contracts/platform-ai";
import { aiTeacherFailure } from "@/lib/ai-teacher-display";
import { AI_JOB_NAMES, aiJobHref, aiJobResult, aiJobResultLink } from "@/lib/ai-job-display";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { PlatformAI } from "./ai";
import { AIExecutionTrace } from "./ai-execution-trace";
import { AITraceText } from "./ai-trace-content";
import { useDomain } from "./domain-provider";
import { PageHeader } from "./page-header";
import { Panel } from "./primitives";
import { QuestionBody } from "./questions";

export function AIJobsPage() {
  const { state, refresh, notify } = useDomain();
  return (
    <>
      <PageHeader
        title="AI 任务记录"
        description="集中查看自己提交的 AI 任务，跟进处理进度并核对结果。"
        back={{ href: "/workspace", label: "返回首页" }}
      />
      <PlatformAI state={state} tab="overview" refresh={refresh} notify={notify} />
    </>
  );
}

export function AIJobDetailPage({ initialJob }: { initialJob: AiJobDTO }) {
  const router = useRouter();
  const { state, refresh, notify } = useDomain();
  const [job, setJob] = useState(initialJob);
  const [failure, setFailure] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const completed = useRef(initialJob.status === "COMPLETED");
  const poll = useCallback(async () => {
    setRefreshing(true);
    try {
      const current = await apiRequest<AiJobDTO>(`/api/platform/ai/${initialJob.id}`);
      setJob(current);
      setFailure("");
      if (current.status === "COMPLETED" && !completed.current) {
        completed.current = true;
        await refresh();
      }
    } catch {
      setFailure("暂时无法更新进度，请稍后刷新。");
    } finally {
      setRefreshing(false);
    }
  }, [initialJob.id, refresh]);

  const active = job.status === "QUEUED" || job.status === "RUNNING";
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void poll(), 3000);
    return () => clearInterval(timer);
  }, [active, poll]);

  async function retry() {
    setRetrying(true);
    try {
      const next = await apiRequest<{ id: string }>(`/api/platform/ai/${job.id}/retry`, {
        method: "POST",
        ...jsonBody({}),
      });
      notify("任务已重新排队，正在查看新任务。");
      router.push(aiJobHref(next.id));
    } catch (error) {
      notify(aiTeacherFailure(error instanceof Error ? error.message : error), true);
    } finally {
      setRetrying(false);
    }
  }

  const result = aiJobResult(job);
  const resultLink = aiJobResultLink(job);
  const recommendations = result?.recommendations ?? result?.result?.recommendations;
  const skipped = result?.result?.skipped;
  const skippedQuestionLabel = (id: string, index: number) => {
    if (/[\u4e00-\u9fff]/.test(id)) return id;
    const item = state.papers?.flatMap((paper) => paper.items).find((item) => item.id === id);
    if (item) return `第 ${item.position + 1} 题`;
    const question = state.questions.find((question) => question.id === id);
    return question?.content.stem || `待核对题目 ${index + 1}`;
  };
  return (
    <>
      <PageHeader
        title={`${AI_JOB_NAMES[job.kind]} · 处理进度`}
        description="离开页面后仍会继续处理，完成后可在这里核对结果。"
        back={{ href: "/workspace/ai", label: "返回 AI 任务记录" }}
        actions={
          <>
            <button className="button secondary" disabled={refreshing} onClick={() => void poll()}>
              {refreshing ? "正在刷新…" : "刷新状态"}
            </button>
            {job.status === "FAILED" && (
              <button className="button" disabled={retrying} onClick={() => void retry()}>
                {retrying ? "正在重新提交…" : "重试任务"}
              </button>
            )}
            {resultLink && (
              <Link className="button" href={resultLink.href}>
                {resultLink.label}
              </Link>
            )}
          </>
        }
      />
      {failure && (
        <p role="alert" className="p-notice error">
          {failure}
        </p>
      )}
      <AIExecutionTrace job={job} showDiagnostics={state.actor?.role === "ADMIN"} />
      {result?.summary && (
        <Panel title="处理结果">
          <div className="p-panel-content">
            <AITraceText text={result.summary} />
          </div>
        </Panel>
      )}
      {!!skipped?.length && (
        <Panel
          title="需要您核对的题目"
          description="以下题目看不清，已跳过。请查看原图后人工核对，其余题目的处理不受影响。"
        >
          <div className="p-table" role="region" aria-label="跳过的题目及原因" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>题目</th>
                  <th>跳过原因</th>
                  <th>原图</th>
                </tr>
              </thead>
              <tbody>
                {skipped.map((entry, index) => (
                  <tr key={entry.id}>
                    <td>
                      <AITraceText text={skippedQuestionLabel(entry.id, index)} />
                    </td>
                    <td>{entry.reason}</td>
                    <td>{entry.sourceUrl ? <a href={entry.sourceUrl}>查看原图</a> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {job.kind === "RECOMMEND" && recommendations?.length ? (
        <Panel title="推荐练习">
          {recommendations.map((recommendation, index) => {
            const data =
              recommendation && typeof recommendation === "object"
                ? (recommendation as {
                    questionId?: string;
                    id?: string;
                    question?: (typeof state.questions)[number];
                    reason?: string;
                    stem?: string;
                  })
                : null;
            const id =
              typeof recommendation === "string" ? recommendation : (data?.questionId ?? data?.id);
            const question =
              data?.question ?? state.questions.find((candidate) => candidate.id === id);
            return (
              <article className="p-question" key={index}>
                {question ? (
                  <QuestionBody question={question} />
                ) : (
                  <AITraceText text={data?.reason ?? data?.stem ?? "已生成推荐题目"} />
                )}
                {question && data?.reason && <AITraceText text={data.reason} />}
              </article>
            );
          })}
        </Panel>
      ) : null}
    </>
  );
}
