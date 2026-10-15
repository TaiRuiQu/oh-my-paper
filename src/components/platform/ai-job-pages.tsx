"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AiJobDTO } from "@/contracts/platform-ai";
import { AI_JOB_NAMES, aiJobHref, aiJobResult, aiJobResultLink } from "@/lib/ai-job-display";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { PlatformAI } from "./ai";
import { AIExecutionTrace } from "./ai-execution-trace";
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
        description="集中查看自己提交的 AI 任务，进入任务页面跟进执行过程和结果。"
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
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "任务状态加载失败，请刷新重试。");
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
      notify(error instanceof Error ? error.message : "重试失败，请稍后重试。", true);
    } finally {
      setRetrying(false);
    }
  }

  const result = aiJobResult(job);
  const resultLink = aiJobResultLink(job);
  const recommendations = result?.recommendations ?? result?.result?.recommendations;
  return (
    <>
      <PageHeader
        title={`${AI_JOB_NAMES[job.kind]} · 执行轨迹`}
        description="离开页面后任务会继续执行。运行期间自动更新，点击活动可查看详情。"
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
      <AIExecutionTrace job={job} />
      {result?.summary &&
        !job.events.some(
          (event) =>
            event &&
            typeof event === "object" &&
            (event as { type?: string; summary?: string }).type === "complete" &&
            (event as { summary?: string }).summary === result.summary,
        ) && <p className="p-notice">{result.summary}</p>}
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
                  <p className="p-muted">{data?.reason ?? data?.stem ?? "已生成推荐题目"}</p>
                )}
                {question && data?.reason && <p className="p-muted">{data.reason}</p>}
              </article>
            );
          })}
        </Panel>
      ) : null}
    </>
  );
}
