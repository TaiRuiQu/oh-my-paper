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
  QUEUED: "等待执行",
  RUNNING: "正在处理",
  COMPLETED: "已完成",
  FAILED: "执行失败",
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

export function aiEventDescription(event: unknown) {
  if (!event || typeof event !== "object") return String(event ?? "执行记录");
  const data = event as {
    type?: string;
    tool?: string;
    name?: string;
    status?: string;
    message?: string;
    summary?: string;
    durationMs?: number;
    toolNames?: string[];
    exitCode?: number;
  };
  if (data.message || data.summary) return data.message ?? data.summary!;
  if (data.type === "start") return "开始执行任务";
  if (data.type === "complete") return "任务执行完成";
  if (data.type === "tool") {
    const duration = typeof data.durationMs === "number" ? `（${data.durationMs} 毫秒）` : "";
    return `${data.status === "started" ? "调用工具" : "工具执行结束"}：${data.tool ?? data.name ?? "未命名工具"}${duration}`;
  }
  if (data.type === "step")
    return data.toolNames?.length ? `本轮调用：${data.toolNames.join("、")}` : "本轮模型处理完成";
  if (data.type === "sandbox")
    return `${data.name === "python" ? "Python" : "命令"}执行${data.exitCode === 0 ? "完成" : "失败"}（退出码 ${data.exitCode ?? "未知"}）`;
  return [data.type, data.tool ?? data.name, data.status].filter(Boolean).join(" · ") || "执行记录";
}
