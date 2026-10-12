"use client";
import Link from "next/link";
import { useState } from "react";
import { Search, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { ExamTaskSummary } from "@/contracts/exam-tasks";
import { taskLabel } from "@/lib/exam-task-label";

export function ExamHistory({
  tasks,
  grading,
  isFetching,
  error,
  onRefresh,
}: {
  tasks: ExamTaskSummary[];
  grading: boolean;
  isFetching: boolean;
  error: boolean;
  onRefresh: () => Promise<unknown>;
}) {
  const [search, setSearch] = useState("");
  return (
    <section className="exam-history" aria-labelledby="history-heading">
      <div className="section-heading">
        <h2 id="history-heading">{grading ? "作答记录" : "试卷存稿"}</h2>
        <button className="text-button" onClick={() => void onRefresh()} disabled={isFetching}>
          刷新列表
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          进度暂时无法更新，请刷新列表重试。
        </p>
      )}
      {!tasks.length && (
        <p className="history-empty muted">还没有试卷。上传第一份试卷，识别结果会保存在这里。</p>
      )}
      <div className="exam-search">
        <Search size={16} aria-hidden="true" />
        <Input
          aria-label="搜索试卷"
          placeholder="按试卷名称搜索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="exam-list">
        {tasks
          .filter(
            (task) =>
              (grading ? task.autoGrade : !task.autoGrade) &&
              task.name.toLowerCase().includes(search.toLowerCase()),
          )
          .map((task) => (
            <Link className="exam-row" href={`/exams/${task.id}`} key={task.id}>
              <div className="exam-row-title">
                <FileText size={20} aria-hidden="true" />
                <div>
                  <h3>{task.name}</h3>
                  <p className="hint">
                    {new Date(task.createdAt).toLocaleString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                    })}
                  </p>
                </div>
              </div>
              <span className={`task-status${task.status === "FAILED" ? " danger" : ""}`}>
                {taskLabel(task)}
              </span>
            </Link>
          ))}
      </div>
      {tasks.length === 50 && <p className="hint">显示最近 50 份试卷。</p>}
    </section>
  );
}
