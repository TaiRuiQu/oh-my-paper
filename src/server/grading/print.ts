import "server-only";
import type {GradeResult} from "@/contracts/grading";
import {renderMathText} from "@/server/exams/math";
import {escapePrintText} from "@/server/exams/print";
export async function printableGradeReport(result:GradeResult){
  const images=await renderMathText(result.questions.flatMap((q)=>[q.questionText,q.studentAnswer,q.expectedAnswer,q.feedback]));
  const text=(value:string)=>{let at=0,html="";for(const m of value.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g)){html+=escapePrintText(value.slice(at,m.index));const latex=m[1]??m[2];html+=images[latex]?`<img class="formula" src="${images[latex]}" alt="${escapePrintText(latex)}">`:escapePrintText(latex);at=m.index+m[0].length;}return html+escapePrintText(value.slice(at));};
  const body=["<h1>试卷批改报告</h1>",`<p>已计分：${result.totals.awardedPoints} / ${result.totals.gradedMaxPoints} 分 · 待核对 ${result.totals.pendingQuestions} 题</p>`,"<p>未核对的建议分数不计入总分。</p>"];
  for(const q of result.questions)body.push(`<section><h2>${escapePrintText(q.section)} 第 ${escapePrintText(q.number)} 题</h2><p>${text(q.questionText)}</p><p>作答：${text(q.studentAnswer||"未作答")}</p><p>参考答案${q.referenceOrigin==="model"?"（系统推导，需核对）":""}：${text(q.expectedAnswer||"尚未建立")}</p><p>${q.needsReview?"建议得分":"已计分"}：${q.needsReview?q.suggestedScore??"待判":q.score??"待判"} / ${q.maxPoints??"待设定"}</p><p>${text(q.feedback)}</p>${q.review?`<p>人工核对：${escapePrintText(q.review.note)}</p>`:""}</section>`);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>试卷批改报告</title><style>body{max-width:850px;margin:40px auto;padding:0 24px;color:#222;font:17px/1.8 sans-serif}h1{font-size:28px}h2{font-size:19px;margin-top:32px}p{white-space:pre-wrap}.formula{height:1.6em;vertical-align:middle}section{break-inside:avoid}@media print{body{margin:0}}</style><body>${body.join("\n")}</body></html>`;
}
