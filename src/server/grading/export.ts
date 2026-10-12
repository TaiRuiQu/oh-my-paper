import type { GradeResult } from "@/contracts/grading";

export function exportGradeMarkdown(result: GradeResult) {
  const lines = ["# 试卷批改报告", "", `模型：${result.model}`, `提示词版本：${result.promptVersion}`, "",
    result.totals.scoredQuestions ? `计入总分：${result.totals.awardedPoints} / ${result.totals.gradedMaxPoints} 分` : "尚无已计分题目", `待核对：${result.totals.pendingQuestions} 题`, "",
    "未核对的建议分数不计入总分。", ""];
  for (const question of result.questions) {
    lines.push(`## ${question.section} 第 ${question.number} 题`, "", question.questionText, "", `作答：${question.studentAnswer || "未作答"}`, "",
      `参考答案（${question.referenceOrigin === "supplied" ? "已提供" : "AI 推导，需核对"}）：${question.expectedAnswer || "未提供"}`, "",
      `计入得分：${question.score ?? "暂不计分"} / ${question.maxPoints ?? "分值未设置"}`,
      `AI 建议分数：${question.suggestedScore ?? "未判分"}`, "", question.feedback, "");
    for (const criterion of question.criteria) lines.push(`- ${criterion.description}：${criterion.awardedPoints} / ${criterion.maxPoints}，${criterion.explanation}`);
    if (question.needsReview) lines.push("", "待核对：", ...question.reviewReasons.map((reason) => `- ${reason}`));
    if (question.review) lines.push("", `人工核对：${question.review.note}（${question.review.reviewedAt}）`);
    lines.push("");
  }
  return lines.join("\n");
}
