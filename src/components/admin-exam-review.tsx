"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AdminExamDetail } from "@/contracts/admin";
import { apiRequest } from "@/lib/http-client";
import { formatDate } from "@/lib/date-time";
import { ExamContent } from "./exam-result";
import { AgentResultContent } from "./exam-agents";
import { StatusBadge } from "./processing-state";
import { ExamExport } from "./exam-export";
export function AdminExamReview({ initialData }: { initialData: AdminExamDetail }) {
  const [view, setView] = useState("questions");
  const query = useQuery({
    queryKey: ["admin-exam", initialData.task.id],
    queryFn: () => apiRequest<AdminExamDetail>(`/api/admin/exams/${initialData.task.id}`),
    initialData,
    refetchInterval: (q) =>
      q.state.data?.task.status === "RUNNING" ||
      q.state.data?.task.status === "QUEUED" ||
      q.state.data?.agents.some((task) => ["QUEUED", "RUNNING"].includes(task.status))
        ? 2500
        : false,
  });
  const { task, exam, agents } = query.data;
  const answers = agents.filter((agent) => agent.kind === "ANSWER");
  return (
    <>
      <Link className="back-link" href="/admin/exams">
        返回试卷记录审查
      </Link>
      <div className="result-heading">
        <div>
          <h1>{task.name}</h1>
          <p className="intro admin-record-owner">
            {task.owner.name} · {task.owner.email} · {task.source} · {formatDate(task.createdAt)}
          </p>
        </div>
        <div className="inline-actions">
          {exam && <ExamExport taskId={task.id} name={exam.name} admin />}
          <StatusBadge status={task.status} />
        </div>
      </div>
      {query.error && (
        <p className="form-error" role="alert">
          {query.error.message}
          <button className="text-action" onClick={() => void query.refetch()}>
            重新加载
          </button>
        </p>
      )}
      {task.error && (
        <p className="form-error" role="alert">
          {task.error}
        </p>
      )}
      {exam ? (
        <>
          <div className="content-tabs" role="group" aria-label="审查内容">
            <button aria-pressed={view === "questions"} onClick={() => setView("questions")}>
              试题内容
            </button>
            <button aria-pressed={view === "answers"} onClick={() => setView("answers")}>
              标准答案
            </button>
          </div>
          <div className="surface detail-surface">
            {view === "questions" ? (
              <ExamContent
                exam={exam}
                taskId={task.id}
                filesBaseURL={`/api/admin/exams/${task.id}/files`}
              />
            ) : answers.length ? (
              answers.map((answer) => (
                <section key={answer.id}>
                  <div className="section-heading">
                    <h2>{answer.name}</h2>
                    <StatusBadge status={answer.status} />
                  </div>
                  <p className="hint">
                    {formatDate(answer.createdAt)} ·{" "}
                    {answer.answerSource === "UPLOAD" ? "上传答案" : "AI 生成"}
                  </p>
                  {answer.error && <p className="form-error">{answer.error}</p>}
                  {answer.status !== "COMPLETED" && (
                    <p className="hint">已保存草稿，完成前可能修订。</p>
                  )}
                  <AgentResultContent task={answer} exam={exam} />
                </section>
              ))
            ) : (
              <p className="empty-state">暂无标准答案。</p>
            )}
          </div>
        </>
      ) : (
        <div className="surface empty-state">
          <h2>{task.status === "FAILED" ? "试卷解析未完成" : "试卷正在处理中"}</h2>
          <p>审查记录会在结果保存后显示试题内容。</p>
        </div>
      )}
    </>
  );
}
