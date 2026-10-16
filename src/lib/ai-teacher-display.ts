import type { AiJobDTO } from "@/contracts/platform-ai";
import type { AITraceActivity } from "./ai-trace-display";

function data(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function unpack(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function issue(value: unknown) {
  const text = (typeof value === "string" ? value : (JSON.stringify(value) ?? "")).slice(0, 20000);
  if (/看不清|无法辨认|模糊|遮挡|unreadable/i.test(text)) return "部分题目或作答看不清。";
  if (/越界|超出纸张|重叠|答题区域/.test(text)) return "答题区域没有排好。";
  if (/已被修改|作答已.*修改|权限已改变|任务状态已改变/.test(text)) return "材料在处理期间有变化。";
  if (/ACCESS_40[134]/.test(text)) return "目前无法查看这些材料。";
  if (
    /完整标准答案|答案.*不完整|没有生成完整答案|必须提供答案解析|必须提供评分标准|必须生成考查知识点/.test(
      text,
    )
  )
    return "部分题目的答案或解析还不完整，需要继续补充。";
  if (
    /题库.*不足|组卷题数不足|巩固卷题数不足|题库中符合条件|无法满足知识点占比|推荐数量不足|题型数量不符合/.test(
      text,
    )
  )
    return "可选题目暂时无法满足本次要求。";
  if (/超.*满分|小问分数|评分上限|给分/.test(text)) return "部分题目的评分需要重新核对。";
  if (/余额|CREDITS_EXHAUSTED|Credit/.test(text)) return "可用的 AI 额度不足。";
  if (
    /401|403|密钥|模型已移除|模型已停用|模型已移除或停用|未配置|配置可用 AI|authentication|api.?key/i.test(
      text,
    )
  )
    return "AI 服务暂时无法使用。";
  if (/无权|权限/.test(text)) return "目前无法查看这些材料。";
  if (/超时|timeout|timed out/i.test(text)) return "这次处理等待时间较长。";
  if (/网络|中断|HTTP 5\d\d|上游|网关|服务.*不可用|Service Unavailable|fetch failed/i.test(text))
    return "AI 服务连接暂时不稳定。";
  if (/InvalidToolInput|NoSuchTool|TypeValidation|JSONParse|invalid input|schema/i.test(text))
    return "AI 需要调整处理方式。";
  return "这一步暂时没有处理好。";
}

export function aiTeacherFailure(error: unknown) {
  const message = issue(error);
  const recovery: Record<string, string> = {
    "部分题目或作答看不清。": "请查看原图，补充清晰的图片后重试。",
    "答题区域没有排好。": "请检查试卷题目后重新生成。",
    "材料在处理期间有变化。": "请使用最新内容重新提交。",
    "可选题目暂时无法满足本次要求。": "请调整题目数量或选题范围后重试。",
    "目前无法查看这些材料。": "请联系管理员确认访问权限。",
    "可用的 AI 额度不足。": "请联系管理员补充额度。",
    "AI 服务暂时无法使用。": "请联系管理员检查 AI 服务配置。",
  };
  const action = recovery[message] ?? "请稍后重试；如果仍未完成，请联系管理员协助处理。";
  const reason =
    message === "这一步暂时没有处理好。" || message === "AI 需要调整处理方式。"
      ? "这次处理没有完成。"
      : message;
  return `${reason}${action}`;
}

const completed: Record<string, string> = {
  inspect_image: "已查看本次图片材料。",
  python: "已完成这一步的材料检查和计算。",
  shell: "已完成这一步的材料检查和计算。",
  record_source_inventory: "已核对扫描页中的题目数量。",
  propose_question: "已整理识别出的题目内容。",
  read_question: "已读取本次需要处理的题目。",
  propose_enrichment: "已整理题目的知识点、参考答案和解析。",
  search_questions: "已在题库中查找符合要求的题目。",
  propose_paper: "已整理本次试卷的选题与题序。",
  read_paper: "已读取试卷内容。",
  read_paper_question: "已查看卷内题目。",
  generate_layout: "已生成答题区域的初稿。",
  propose_template: "已整理答题卡版面。",
  list_items: "已确认需要批改的题目。",
  read_answer: "已查看题目、评分依据和学生作答。",
  read_classroom: "已读取班级学生与本次作业内容。",
  register_submission: "已确认学生身份，并整理其扫描页。",
  record_answers: "已自动定位并提取题目作答。",
  defer_pages: "已保留无法确认归属的材料，其余作业继续批改。",
  propose_grade: "已整理本次评分与评语。",
  skip_questions: "已记录看不清的题目，留待人工核对。",
  read_learning: "已查看学生的学习情况与错题。",
  search_candidates: "已查找适合巩固练习的题目。",
  read_candidate: "已查看候选练习的题目内容。",
  propose_recommendations: "已整理适合学生的巩固练习。",
  finish: "已完成最后核对。请查看下方的处理结果。",
};

export function aiTeacherActivity(activity: AITraceActivity, status: AiJobDTO["status"]) {
  if (activity.status === "error") {
    const errors = activity.events.flatMap(({ value }) => {
      const record = data(value);
      return record.error ? [record.error] : record.stderr ? [record.stderr] : [];
    });
    const reasons = [...new Set(errors.map(issue))];
    const message = reasons.length ? reasons.join("") : "这一步暂时没有处理好。";
    const continuation =
      status === "COMPLETED"
        ? "AI 已继续处理，请以最终保存的结果为准。"
        : status === "RUNNING" || status === "QUEUED"
          ? "AI 正在继续核对，您可以先等待处理结果。"
          : "本次处理已停止，请按页面提示检查材料后重试。";
    return `${message}${continuation}`;
  }
  if (activity.status === "running")
    return status === "FAILED"
      ? "处理在这一步停止，请检查材料后重试。"
      : status === "COMPLETED"
        ? "本次处理已结束，请查看最终结果。"
        : "AI 正在处理这部分内容，完成后会自动更新。";
  if (activity.type === "start") return "已开始处理您提交的材料。";
  if (activity.type === "complete") return "本次处理已结束，请查看最终结果并核对题目内容。";
  return completed[activity.toolName ?? ""] ?? "已完成这一步的核对。";
}

export function aiActivityImages(activity: AITraceActivity): string[] {
  return [
    ...new Set(
      activity.events.flatMap(({ value }) => {
        const record = data(value);
        const output = data(unpack(record.output ?? record.result));
        const images = record.type === "sandbox" ? record.images : output.images;
        return Array.isArray(images)
          ? images.flatMap((image) => {
              const url = data(image).url;
              return typeof url === "string" && /^\/api\/platform\/assets\/[\w-]+$/.test(url)
                ? [url]
                : [];
            })
          : [];
      }),
    ),
  ];
}
