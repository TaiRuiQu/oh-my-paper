import type { AiJobDTO, AiKind } from "@/contracts/platform-ai";

export const AI_JOB_NAMES: Record<AiKind, string> = {
  IMPORT: "图片识别导入",
  ENRICH: "知识点与参考答案",
  ASSEMBLE: "智能组卷",
  TEMPLATE: "智能答题卡",
  GRADE: "AI 阅卷",
  RECOMMEND: "巩固练习推荐",
};

export const AI_JOB_STATUSES: Record<AiJobDTO["status"], string> = {
  QUEUED: "等待处理",
  RUNNING: "正在处理",
  COMPLETED: "已完成",
  FAILED: "未完成",
};

export const aiJobHref = (id: string) => `/workspace/ai/${encodeURIComponent(id)}`;

export function aiJobResult(job: AiJobDTO) {
  return job.result && typeof job.result === "object"
    ? (job.result as {
        summary?: string;
        result?: {
          ids?: string[];
          paperId?: string;
          paperKind?: "EXAM" | "HOMEWORK";
          recommendations?: unknown[];
          skipped?: { id: string; sourceUrl?: string; reason: string }[];
        };
        recommendations?: unknown[];
      })
    : null;
}

export function aiJobResultLink(job: AiJobDTO): { href: string; label: string } | undefined {
  if (job.status !== "COMPLETED") return;
  const result = aiJobResult(job);
  if (result?.result?.paperId)
    return {
      href: `${result.result.paperKind === "HOMEWORK" ? "/homework" : "/exams/papers"}/${result.result.paperId}/edit`,
      label: `核对并编辑${result.result.paperKind === "HOMEWORK" ? "作业" : "试卷"}`,
    };
  const id = result?.result?.ids?.[0];
  if (job.kind === "ASSEMBLE" && id) {
    const kind = (job.input as { kind?: string } | null)?.kind;
    return {
      href: `${kind === "HOMEWORK" ? "/homework" : "/exams/papers"}/${id}/edit`,
      label: kind === "HOMEWORK" ? "核对并编辑作业" : "核对并编辑试卷",
    };
  }
  if (job.kind === "TEMPLATE" && id)
    return { href: `/exams/cards/${id}/edit`, label: "核对并编辑答题卡" };
  if (job.kind === "IMPORT" || job.kind === "ENRICH")
    return { href: "/questions", label: "核对题库内容" };
}
