import "server-only";
import type { GradeResult } from "@/contracts/grading";
import type { ContentBlock } from "@/contracts/exams";
import { renderMathText } from "@/server/exams/math";
import { escapePrintText } from "@/server/exams/print";

export async function printableGradeReport(result: GradeResult, loadAnswerImage?: (figure: Extract<ContentBlock, { type: "figure" }>) => Promise<Uint8Array>) {
  const answerText = result.questions.flatMap((q) => (q.studentAnswerBlocks ?? []).flatMap((b) => b.type === "text" ? [b.text] : b.type === "math" ? [`$${b.latex}$`] : []));
  const images = await renderMathText([...result.questions.flatMap((q) => [q.questionText, q.studentAnswer, q.expectedAnswer, q.feedback]), ...answerText]);
  const text = (value: string) => {
    let at = 0, html = "";
    for (const match of value.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g)) {
      html += escapePrintText(value.slice(at, match.index));
      const latex = match[1] ?? match[2];
      html += images[latex] ? `<img class="formula" src="${images[latex]}" alt="${escapePrintText(latex)}">` : escapePrintText(latex);
      at = match.index + match[0].length;
    }
    return html + escapePrintText(value.slice(at));
  };
  const renderAnswer = async (blocks: ContentBlock[]) => {
    const rendered: string[] = [];
    for (const block of blocks) {
      if (block.type === "text") rendered.push(`<p>${text(block.text)}</p>`);
      else if (block.type === "math") rendered.push(`<p>${text(`$${block.latex}$`)}</p>`);
      else if (block.type === "table") rendered.push(`<table>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${text(cell)}</td>`).join("")}</tr>`).join("")}</table>`);
      else if (loadAnswerImage) {
        const bytes = await loadAnswerImage(block);
        rendered.push(`<figure><img src="data:image/png;base64,${Buffer.from(bytes).toString("base64")}" alt="${escapePrintText(block.caption)}"><figcaption>${escapePrintText(block.caption)}</figcaption></figure>`);
      } else rendered.push(`<p>作答图片：${escapePrintText(block.caption)}</p>`);
    }
    return rendered.join("\n");
  };
  const body = ["<h1>试卷批改报告</h1>", `<p>已计分：${result.totals.awardedPoints} / ${result.totals.gradedMaxPoints} 分 · 待核对 ${result.totals.pendingQuestions} 题</p>`, "<p>未核对的建议分数不计入总分。</p>"];
  for (const question of result.questions) {
    const answer = question.studentAnswerBlocks?.length ? await renderAnswer(question.studentAnswerBlocks) : `<p>${text(question.studentAnswer || (question.verdict === "unanswered" ? "未作答" : "作答证据待核对"))}</p>`;
    body.push(`<section><h2>${escapePrintText(question.section)} 第 ${escapePrintText(question.number)} 题</h2><p>${text(question.questionText)}</p><h3>学生作答</h3>${answer}<p>标准答案：${text(question.expectedAnswer || "尚未建立")}</p><p>${question.needsReview ? "建议得分" : "已计分"}：${question.needsReview ? question.suggestedScore ?? "待判" : question.score ?? "待判"} / ${question.maxPoints ?? "待设定"}</p><p>${text(question.feedback)}</p>${question.review ? `<p>人工核对：${escapePrintText(question.review.note)}</p>` : ""}</section>`);
  }
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>试卷批改报告</title><style>body{max-width:850px;margin:40px auto;padding:0 24px;color:#222;font:17px/1.8 sans-serif}h1{font-size:28px}h2{font-size:19px;margin-top:32px}h3{font-size:17px}p{white-space:pre-wrap}img{max-width:100%}.formula{height:1.6em;vertical-align:middle}td{border:1px solid #aaa;padding:8px}table{border-collapse:collapse}section{break-inside:avoid}@media print{body{margin:0}}</style><body>${body.join("\n")}</body></html>`;
}
