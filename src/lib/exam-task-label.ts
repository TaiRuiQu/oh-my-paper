import type { ExamTaskSummary } from "@/contracts/exam-tasks";

export function taskLabel(task: ExamTaskSummary) {
  if (task.status === "COMPLETED")
    return task.autoGrade ? "识别完成 · 查看作答" : "已保存 · 查看题套";
  if (task.status === "FAILED") return "识别失败 · 查看详情";
  if (task.status === "QUEUED") return "等待识别";
  if (task.phase === "recognizing") return "Agent 正在识别 · 查看工具操作";
  if (!task.totalPages) return "正在准备页面";
  const labels: Record<string, string> = {
    inventory: "全卷解析",
    localization: "逐题定位",
    transcription: "题目文本化",
    references: "提取参考答案",
    answer_parsing: "解析学生作答",
    parsing: "逐题识别",
    solving: "AI 解题",
    saved: "保存完成",
  };
  return `${labels[task.phase] ?? "准备中"} · ${task.page} / ${task.totalPages}`;
}
