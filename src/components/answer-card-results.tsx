"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CardBatch } from "@/contracts/answer-cards";
import { apiRequest } from "@/lib/http-client";
import { StatusBadge, ProcessingState } from "./processing-state";
import { AgentResultContent } from "./exam-agents";
export function AnswerCardResults({ initialBatch }: { initialBatch: CardBatch }) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const query = useQuery({
      queryKey: ["card-batch", initialBatch.id],
      queryFn: () =>
        apiRequest<{ batch: CardBatch }>(`/api/answer-cards/batches/${initialBatch.id}`),
      initialData: { batch: initialBatch },
      refetchInterval: (q) =>
        ["QUEUED", "RUNNING"].includes(q.state.data?.batch.status ?? "") ? 2000 : false,
    }),
    batch = query.data.batch;
  async function retry() {
    setPending(true);
    setError("");
    try {
      await apiRequest(`/api/answer-cards/batches/${batch.id}/retry`, { method: "POST" });
      await query.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重试失败。");
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Link className="back-link" href="/grading/cards">
        返回答题卡批改
      </Link>
      <div className="page-heading">
        <div>
          <h1>答题卡批改报告</h1>
          <p className="intro">
            {batch.name} · 已消费 {Number(batch.creditsSpent).toFixed(3)} credit
          </p>
        </div>
        <StatusBadge status={batch.status} />
      </div>
      {(error || query.error) && (
        <p className="form-error" role="alert">
          {error || "结果未能刷新。"}
          <button className="button secondary" onClick={() => void query.refetch()}>
            重新加载
          </button>
        </p>
      )}
      {["QUEUED", "RUNNING"].includes(batch.status) && (
        <section className="surface">
          <ProcessingState
            startedAt={batch.createdAt}
            creditsSpent={batch.creditsSpent}
            progress={[{ label: "已批改题目", completed: batch.completed, total: batch.total }]}
          />
        </section>
      )}
      {batch.status === "FAILED" && (
        <section className="surface recovery-notice">
          <h2>部分答题卡尚未完成</h2>
          <p>{batch.error}</p>
          <button className="button" disabled={pending} onClick={() => void retry()}>
            {pending ? "正在重试" : "重试未完成题目"}
          </button>
          <p className="hint">已评分成功的题目会保留，重试只调用未完成题目。</p>
        </section>
      )}
      {batch.students.map((s) => (
        <section key={s.id} className="surface card-student-result">
          <div className="list-toolbar">
            <h2>{s.name}</h2>
            <StatusBadge status={s.status} />
          </div>
          <p className="hint">
            已完成 {s.completed} 道题{s.error ? ` · ${s.error}` : ""}
          </p>
          {s.status === "COMPLETED" && batch.exam && batch.sourceId && (
            <AgentResultContent
              exam={batch.exam}
              task={{
                id: s.id,
                kind: "GRADING",
                name: s.name,
                status: "COMPLETED",
                error: null,
                createdAt: batch.createdAt,
                result: s.result,
                submissionId: null,
              }}
            />
          )}
        </section>
      ))}
    </>
  );
}
