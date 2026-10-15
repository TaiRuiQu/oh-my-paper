import type { AiJobDTO } from "@/contracts/platform-ai";

type EventData = Record<string, unknown>;
export type AITraceActivity = {
  id: number;
  type: "tool" | "step" | "start" | "complete" | "event";
  label: string;
  toolName?: string;
  status: "running" | "complete" | "error";
  durationMs?: number;
  events: { index: number; value: unknown }[];
};

const TOOL_LABELS: Record<string, string> = {
  inspect_image: "查看图片",
  python: "核对材料与计算",
  shell: "核对材料与计算",
  record_source_inventory: "核对扫描页题目数量",
  propose_question: "整理识别题目",
  read_question: "读取题目",
  propose_enrichment: "补充知识点与参考答案",
  search_questions: "搜索题库",
  propose_paper: "编排试卷",
  read_paper: "读取试卷",
  read_paper_question: "读取卷内题目",
  generate_layout: "生成答题区域",
  propose_template: "整理答题卡",
  list_items: "查看待批改题目",
  read_answer: "查看学生作答",
  propose_grade: "记录评分与反馈",
  skip_questions: "跳过无法辨认的题目",
  read_learning: "查看学情与错题",
  search_candidates: "搜索巩固练习",
  read_candidate: "查看候选练习",
  propose_recommendations: "整理推荐练习",
  report_failure: "报告无法完成的要求",
  finish: "核对任务结果",
};

function eventData(value: unknown): EventData {
  return value && typeof value === "object" ? (value as EventData) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function aiToolLabel(name: string) {
  return TOOL_LABELS[name] ?? "处理题目";
}

/** Decode escaped prose line breaks without changing TeX commands or code examples. */
export function normalizeAITraceText(value: string) {
  return value
    .split(
      /(```[\s\S]*?```|`[^`]*`|\$\$[\s\S]*?\$\$|\$[^\n$]*?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g,
    )
    .map((part, index) => (index % 2 ? part : part.replace(/\\r\\n|\\n(?![a-zA-Z])/g, "\n")))
    .join("");
}

export type AITraceGroup = { id: number; label: string; activities: AITraceActivity[] };

/** Consecutive tool calls share a row; model messages and final checks remain boundaries. */
export function aiTraceGroups(activities: AITraceActivity[]): AITraceGroup[] {
  const groups: AITraceGroup[] = [];
  const canGroup = (activity: AITraceActivity) =>
    activity.type === "tool" && !["finish", "report_failure"].includes(activity.toolName ?? "");
  for (const activity of activities) {
    const previous = groups.at(-1);
    if (canGroup(activity) && previous && canGroup(previous.activities[0])) {
      previous.activities.push(activity);
      const names = new Set(previous.activities.map((item) => item.toolName));
      previous.label = names.size === 1 ? aiToolLabel(activity.toolName!) : "处理材料与整理结果";
    } else {
      groups.push({ id: activity.id, label: activity.label, activities: [activity] });
    }
  }
  return groups;
}

/** Group a tool's lifecycle without losing any raw events or mixing concurrent calls. */
export function aiTraceActivities(events: unknown[]): AITraceActivity[] {
  const activities: AITraceActivity[] = [];
  const calls = new Map<string, AITraceActivity>();
  let roundTools: AITraceActivity[] = [];
  for (const [index, value] of events.entries()) {
    const data = eventData(value);
    const name = text(data.name) ?? text(data.tool);
    const callId = text(data.toolCallId);
    const rawEvent = { index, value };
    if ((data.type === "tool" || data.type === "sandbox") && name) {
      let activity = callId ? calls.get(callId) : undefined;
      if (!activity || (data.type === "tool" && data.status === "started")) {
        activity = {
          id: index,
          type: "tool",
          toolName: name,
          label: text(data.message) ?? aiToolLabel(name),
          status: data.status === "started" ? "running" : "complete",
          events: [],
        };
        activities.push(activity);
        roundTools.push(activity);
        if (callId) calls.set(callId, activity);
      }
      activity.events.push(rawEvent);
      if (data.status === "ended") activity.status = "complete";
      if (data.error || (typeof data.exitCode === "number" && data.exitCode !== 0))
        activity.status = "error";
      if (typeof data.durationMs === "number" && Number.isFinite(data.durationMs))
        activity.durationMs = Math.max(0, data.durationMs);
      continue;
    }
    if (data.type === "step" && roundTools.length) {
      // A completed model round adds diagnostics, not a duplicate row for the same actions.
      roundTools.at(-1)!.events.push(rawEvent);
      roundTools.forEach((activity) => {
        if (activity.status === "running") activity.status = "complete";
      });
      roundTools = [];
      continue;
    }
    const type =
      data.type === "start" || data.type === "complete" || data.type === "step"
        ? data.type
        : "event";
    activities.push({
      id: index,
      type,
      label:
        text(data.message) ??
        text(data.summary) ??
        (type === "start"
          ? "开始处理任务"
          : type === "complete"
            ? "任务处理完成"
            : type === "step"
              ? "分析材料，确定下一步"
              : (text(data.type) ?? text(value) ?? "执行记录")),
      status: data.error || data.type === "error" ? "error" : "complete",
      events: [rawEvent],
    });
    if (type === "step") roundTools = [];
  }
  return activities;
}

export function aiJobCurrentStep(job: AiJobDTO, activities = aiTraceActivities(job.events)) {
  if (job.status === "QUEUED") return "等待开始处理";
  if (job.status === "COMPLETED") return "处理完成";
  if (job.status === "FAILED") return "处理已中断，可重试任务";
  const running = activities.filter((activity) => activity.status === "running");
  if (running.length) {
    const names = [
      ...new Set(
        running.map((activity) =>
          activity.toolName ? aiToolLabel(activity.toolName) : activity.label,
        ),
      ),
    ];
    return names.length > 1 ? `${names[0]}等 ${running.length} 项操作` : names[0];
  }
  if (!activities.length) return "准备处理材料";
  if (activities.at(-1)?.type === "complete") return "保存处理结果";
  return "分析处理结果，确定下一步";
}

export function formatAIDuration(milliseconds: number) {
  if (milliseconds > 0 && milliseconds < 1000) return "不足 1 秒";
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

export function aiJobElapsed(job: AiJobDTO, now: number | null) {
  const start = job.status === "QUEUED" ? job.createdAt : job.startedAt;
  const end = job.finishedAt ? Date.parse(job.finishedAt) : now;
  if (!start || end === null) return null;
  const milliseconds = end - Date.parse(start);
  return Number.isFinite(milliseconds) ? formatAIDuration(milliseconds) : null;
}
