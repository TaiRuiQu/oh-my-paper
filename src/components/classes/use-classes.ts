"use client";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { ClassOverview } from "@/contracts/classes";
import type { ExamTaskSummary } from "@/contracts/exam-tasks";
import { apiRequest, jsonBody } from "@/lib/http-client";

export function useClasses(initialClasses: ClassOverview, grading: boolean) {
  const templates = useQuery({
    queryKey: ["exams"],
    queryFn: () => apiRequest<{ tasks: ExamTaskSummary[] }>("/api/exams"),
    enabled: grading,
  });
  const query = useQuery({
    queryKey: ["classes"],
    queryFn: () => apiRequest<{ classes: ClassOverview }>("/api/classes"),
    initialData: { classes: initialClasses },
    refetchInterval: (q) =>
      q.state.data?.classes.some((c) =>
        c.batches.some((b) => b.exams.some((e) => ["处理中", "等待批改"].includes(e.status))),
      )
        ? 3000
        : false,
  });
  const [selected, setSelected] = useState(initialClasses[0]?.id ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const current = query.data.classes.find((c) => c.id === selected) ?? query.data.classes[0];
  const [drafts, setDrafts] = useState<{ studentId: string; batchId: string; files: File[] }[]>([]);
  const [student, setStudent] = useState("");
  const [batch, setBatch] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  async function create(event: FormEvent<HTMLFormElement>, path: string) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      const result = await apiRequest<{ id: string }>(path, {
        method: "POST",
        ...jsonBody(data),
      });
      await query.refetch();
      if (path === "/api/classes") setSelected(result.id);
      if (path.endsWith("batches")) setBatch(result.id);
      form.reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  function upload(event: FormEvent) {
    event.preventDefault();
    if (!files.length || !batch || !student) return;
    setDrafts([...drafts, { studentId: student, batchId: batch, files }]);
    setFiles([]);
    setStudent("");
    (event.target as HTMLFormElement).reset();
  }
  async function submitBatch() {
    setBusy(true);
    setError("");
    const failed: typeof drafts = [];
    for (const draft of drafts) {
      try {
        const body = new FormData();
        draft.files.forEach((f) => body.append("files", f));
        await apiRequest(`/api/classes/batches/${draft.batchId}?studentId=${draft.studentId}`, {
          method: "POST",
          body,
        });
      } catch (e) {
        failed.push(draft);
        setError(e instanceof Error ? e.message : "部分作答未提交，请重试。");
      }
    }
    setDrafts(failed);
    await query.refetch();
    setBusy(false);
  }
  return {
    templates,
    query,
    current,
    error,
    busy,
    drafts,
    student,
    batch,
    files,
    create,
    upload,
    submitBatch,
    setSelected,
    setBatch,
    setStudent,
    setDrafts,
    setFiles,
  };
}
export type ClassWorkspace = ReturnType<typeof useClasses>;
