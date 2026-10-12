"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { GradeTaskSummary } from "@/contracts/grading";
import type { ExamTaskDetail, ExamTaskSummary } from "@/contracts/exam-tasks";
import { apiRequest } from "@/lib/http-client";

export function useExamResult(initialTask: ExamTaskSummary) {
  const [retrying, setRetrying] = useState(false);
  const [actionError, setActionError] = useState("");
  const data = useQuery({
    queryKey: ["exam", initialTask.id],
    queryFn: () => apiRequest<ExamTaskDetail>(`/api/exams/${initialTask.id}`),
    refetchInterval: (query) =>
      !query.state.data || ["QUEUED", "RUNNING"].includes(query.state.data.task.status)
        ? 2500
        : false,
  });
  const task = data.data?.task ?? initialTask;
  const exam = data.data?.exam;
  const grades = useQuery({
    queryKey: ["grade-history", task.id],
    queryFn: () => apiRequest<{ tasks: GradeTaskSummary[] }>(`/api/exams/${task.id}/grades`),
    enabled: task.status === "COMPLETED" && !!task.autoGrade,
    refetchInterval: (query) =>
      !query.state.data?.tasks.length ||
      query.state.data.tasks.some((t) => ["QUEUED", "RUNNING"].includes(t.status))
        ? 2500
        : false,
  });
  const automaticGrade = grades.data?.tasks[0];

  const images = data.data?.mathImages ?? {};
  const fileURL = (key: string) =>
    `/api/exams/${task.id}/files/${key.split("/").map(encodeURIComponent).join("/")}`;

  async function cancel() {
    setActionError("");
    try {
      await apiRequest(`/api/exams/${task.id}/cancel`, { method: "POST" });
      await data.refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "取消未成功，请重试。");
    }
  }
  async function retry() {
    setRetrying(true);
    setActionError("");
    try {
      await apiRequest(`/api/exams/${task.id}/retry`, { method: "POST" });
      await data.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "提交失败，请重试。");
    } finally {
      setRetrying(false);
    }
  }
  async function generateSolutions() {
    setRetrying(true);
    setActionError("");
    try {
      await apiRequest(`/api/exams/${task.id}/solutions`, { method: "POST" });
      await data.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "答案生成未能提交，请重试。");
    } finally {
      setRetrying(false);
    }
  }
  return {
    data,
    task,
    exam,
    automaticGrade,
    images,
    fileURL,
    retrying,
    actionError,
    cancel,
    retry,
    generateSolutions,
  };
}
