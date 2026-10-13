"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/http-client";
import type { ExamTaskSummary } from "@/contracts/exam-tasks";

export function ExamDelete({
  id,
  name,
  onDeleted,
}: {
  id: string;
  name: string;
  onDeleted?: () => void;
}) {
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setPending(true);
    setError("");
    try {
      await apiRequest(`/api/exams/${id}`, { method: "DELETE" });
      client.setQueryData<{ tasks: ExamTaskSummary[] }>(["exams"], (data) =>
        data ? { tasks: data.tasks.filter((task) => task.id !== id) } : data,
      );
      await client.invalidateQueries({ queryKey: ["exams"] });
      onDeleted?.();
    } catch (error) {
      setError(error instanceof Error ? error.message : "删除失败，请重试。");
    } finally {
      setPending(false);
    }
  }
  return (
    <span className="exam-delete">
      {confirming ? (
        <span className="delete-confirmation" role="group" aria-label={`确认删除 ${name}`}>
          <span>从列表移除？管理员仍可审查记录。</span>
          <button
            className="text-action danger-action"
            disabled={pending}
            onClick={() => void remove()}
          >
            {pending ? "正在删除…" : "确认删除"}
          </button>
          <button className="text-action" disabled={pending} onClick={() => setConfirming(false)}>
            取消
          </button>
        </span>
      ) : (
        <button
          className="text-action danger-action"
          aria-label={`删除 ${name}`}
          onClick={() => setConfirming(true)}
        >
          删除
        </button>
      )}
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
