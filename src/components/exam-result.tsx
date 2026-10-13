"use client";
/* Authenticated material crops render directly. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useState } from "react";
import { taskErrorMessage } from "@/lib/error-message";
import { ProcessingState, StatusBadge } from "./processing-state";
import { useQuery } from "@tanstack/react-query";
import type { ExamTaskDetail } from "@/contracts/exam-tasks";
import { examQuestionCount, type Exam, type Material } from "@/contracts/exams";
import { apiRequest } from "@/lib/http-client";
import { materialKey } from "@/lib/exam-materials";
import { MarkdownText } from "./markdown-text";
import { RecognitionActivityFeed } from "./recognition-activity";
import { ExamAgents } from "./exam-agents";

export function ExamResult({
  id,
  initialData,
  isAdmin = false,
  initialView = "questions",
}: {
  id: string;
  initialData: ExamTaskDetail;
  isAdmin?: boolean;
  initialView?: "questions" | "answers";
}) {
  const [view, setView] = useState(initialView),
    [retrying, setRetrying] = useState(false),
    [retryError, setRetryError] = useState("");
  async function retry() {
    setRetrying(true);
    setRetryError("");
    try {
      await apiRequest(`/api/exams/${id}/retry`, { method: "POST" });
      await query.refetch();
    } catch (error) {
      setRetryError(
        isAdmin && error instanceof Error
          ? error.message
          : taskErrorMessage(error, "暂时无法重试，请稍后再试。"),
      );
    } finally {
      setRetrying(false);
    }
  }
  const query = useQuery({
    queryKey: ["exam", id],
    queryFn: () => apiRequest<ExamTaskDetail>(`/api/exams/${id}`),
    initialData,
    refetchInterval: (query) =>
      ["QUEUED", "RUNNING"].includes(query.state.data?.task.status ?? "") ? 2500 : false,
  });
  const { task, exam } = query.data;
  return (
    <>
      <Link className="back-link" href="/dashboard">
        返回试卷列表
      </Link>
      <div className="result-heading">
        <div>
          <h1>{exam?.name ?? task.name}</h1>
          <p className="intro" role="status">
            {exam
              ? `${exam.sections.length} 道大题 · ${examQuestionCount(exam)} 道小题${exam.totalScore === null ? "" : ` · 总分 ${exam.totalScore} 分`}`
              : task.status === "FAILED"
                ? "试卷未能添加完成"
                : ""}
          </p>
        </div>
        {exam && (
          <div className="inline-actions">
            <Link className="button" href={`/grading?exam=${id}`}>
              批改答卷
            </Link>
            {isAdmin && (
              <a className="button secondary" href={`/api/exams/${id}/files/exam.json`}>
                下载 JSON
              </a>
            )}
          </div>
        )}
        {!exam && <StatusBadge status={task.status} />}
      </div>
      {isAdmin && (
        <details className="debug-disclosure">
          <summary>管理员调试 · 试卷识别</summary>
          <RecognitionActivityFeed key={id} task={task} />
        </details>
      )}
      {query.error && (
        <p className="form-error" role="alert">
          {isAdmin ? query.error.message : "页面暂时无法刷新，请重试。"}{" "}
          <button className="button secondary" onClick={() => void query.refetch()}>
            重新加载
          </button>
        </p>
      )}
      {task.status === "FAILED" && (
        <div className="empty-state">
          <p role="alert">
            {isAdmin
              ? task.error
              : task.errorCode === "CREDITS_EXHAUSTED"
                ? "Credit 余额为负，无法开始新任务。已有结果保留，请联系管理员。"
                : "这份试卷未能处理完成，请重试。"}
          </p>
          <button className="button" disabled={retrying} onClick={() => void retry()}>
            {retrying ? "正在提交" : "重试"}
          </button>
          {retryError && (
            <p role="alert" className="form-error">
              {retryError}
            </p>
          )}
          <Link className="button" href="/dashboard">
            重新上传试卷
          </Link>
        </div>
      )}
      {["QUEUED", "RUNNING"].includes(task.status) && (
        <ProcessingState
          creditLabel={isAdmin ? "折算用量" : "已消费"}
          creditsSpent={task.creditsSpent ?? "0"}
          startedAt={task.createdAt}
          progress={[{ label: "已解析题目", ...(task.progress ?? { total: null, completed: 0 }) }]}
        />
      )}
      {exam && (
        <>
          <div className="content-tabs" role="group" aria-label="试卷视图">
            <button aria-pressed={view === "questions"} onClick={() => setView("questions")}>
              试题内容
            </button>
            <button aria-pressed={view === "answers"} onClick={() => setView("answers")}>
              标准答案
            </button>
          </div>
          <div className="surface detail-surface">
            {view === "questions" ? (
              <ExamContent exam={exam} taskId={id} />
            ) : (
              <ExamAgents exam={exam} taskId={id} isAdmin={isAdmin} />
            )}
          </div>
        </>
      )}
    </>
  );
}

export function ExamContent({
  exam,
  taskId,
  filesBaseURL,
}: {
  exam: Exam;
  taskId: string;
  filesBaseURL?: string;
}) {
  return (
    <div className="exam-sections">
      {exam.sections.map((section, sectionPosition) => {
        const offset = exam.sections
          .slice(0, sectionPosition)
          .reduce((count, previous) => count + previous.questions.length, 0);
        return (
          <section
            key={section.id}
            className="exam-section"
            aria-labelledby={`section-${section.id}`}
          >
            <div className="section-heading">
              <h2 id={`section-${section.id}`}>
                {section.number}、{section.title}
              </h2>
              {section.score !== null && <span className="task-status">共 {section.score} 分</span>}
            </div>
            {section.description && <MarkdownText text={section.description} />}
            <ol className="question-list">
              {section.questions.map((question, index) => (
                <li key={question.id} className="exam-question">
                  <div className="question-heading">
                    <h3>第 {question.number} 题</h3>
                    <span className="task-status">
                      {question.score === null ? "分值未标注" : `${question.score} 分`}
                    </span>
                  </div>
                  {question.description && <MarkdownText text={question.description} />}
                  <QuestionMaterials
                    filesBaseURL={filesBaseURL}
                    taskId={taskId}
                    materials={question.materials}
                    position={offset + index}
                    label={`第 ${question.number} 题`}
                  />
                  {question.subquestions.length > 0 && (
                    <ol className="subquestion-list">
                      {question.subquestions.map((part, partPosition) => (
                        <li key={part.number} className="exam-subquestion">
                          <div className="question-heading">
                            <h4>{part.number}</h4>
                            {part.score !== null && (
                              <span className="task-status">{part.score} 分</span>
                            )}
                          </div>
                          <MarkdownText text={part.description} />
                          <QuestionMaterials
                            filesBaseURL={filesBaseURL}
                            taskId={taskId}
                            materials={part.materials}
                            position={offset + index}
                            subquestionPosition={partPosition}
                            label={`第 ${question.number} 题${part.number}`}
                          />
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function QuestionMaterials({
  filesBaseURL,
  taskId,
  materials,
  position,
  subquestionPosition,
  label,
}: {
  filesBaseURL?: string;
  taskId: string;
  materials: Material[];
  position: number;
  subquestionPosition?: number;
  label: string;
}) {
  if (!materials.length) return null;
  return (
    <div className="question-materials">
      {materials.map((material, index) => (
        <figure key={index}>
          <img
            src={`${filesBaseURL ?? `/api/exams/${taskId}/files`}/${materialKey(position, index, subquestionPosition)}`}
            alt={`${label}材料 ${index + 1}`}
            loading="lazy"
          />
          <figcaption>
            材料 {index + 1} · 第 {material.page} 页
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
