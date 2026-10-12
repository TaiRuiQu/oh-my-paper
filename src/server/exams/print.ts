import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DigitalExam, ContentBlock } from "@/contracts/exams";
import { renderExamMath } from "./math";
export const escapePrintText = (text:string) => text.replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export async function printableExam(exam:DigitalExam,directory:string) {
  const math=await renderExamMath(exam);
  const text = (value: string) => {
    let cursor = 0, html = "";
    for (const m of value.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g)) {
      html += escapePrintText(value.slice(cursor, m.index));
      const latex = m[1] ?? m[2];
      html += math[latex] ? `<img class="formula" src="${math[latex]}" alt="${escapePrintText(latex)}">` : escapePrintText(latex);
      cursor = m.index + m[0].length;
    }
    return html + escapePrintText(value.slice(cursor));
  };
  const render=async(blocks:ContentBlock[])=> (await Promise.all(blocks.map(async(b)=>{
    if(b.type==="text")return `<p>${text(b.text).replace(/\n/g,"<br>")}</p>`;
    if(b.type==="math")return math[b.latex]?`<p><img class="formula" src="${math[b.latex]}" alt="${escapePrintText(b.latex)}"></p>`:`<p>${escapePrintText(b.latex)}</p>`;
    if(b.type==="table")return `<table>${b.rows.map((row)=>`<tr>${row.map((c)=>`<td>${escapePrintText(c)}</td>`).join("")}</tr>`).join("")}</table>`;
    const asset=exam.assets.find((a)=>JSON.stringify(a.region)===JSON.stringify(b.region));
    if(!asset?.cleanKey||!/^figures\/figure-\d+\.png$/.test(asset.cleanKey))return `<p>配图待核对：${escapePrintText(b.caption)}</p>`;
    const bytes=await readFile(join(directory,asset.cleanKey));return `<figure><img src="data:image/png;base64,${bytes.toString("base64")}" alt="${escapePrintText(b.caption)}"><figcaption>${escapePrintText(b.caption)}</figcaption></figure>`;
  }))).join("");
  const body=[`<h1>${escapePrintText(exam.title??"数字试卷")}</h1>`,...exam.instructions.map((i)=>`<p>${escapePrintText(i)}</p>`)];
  for(const m of exam.materials)body.push(`<h2>${escapePrintText(m.title||"共用材料")}</h2>${await render(m.blocks)}`);
  for(const q of exam.questions){body.push(`<section><h2>${escapePrintText(q.section)} 第 ${escapePrintText(q.number)} 题${q.points===null?"":`（${q.points}分）`}</h2>${q.status==="needs_review"?"<p>本题内容待核对</p>":""}${await render(q.blocks)}`);for(const o of q.options)body.push(`<p>${escapePrintText(o.label)}.</p>${await render(o.blocks)}`);for(const p of q.parts)body.push(`<p>${escapePrintText((p.parentLabel??"")+p.label)}</p>${await render(p.blocks)}`);body.push("</section>");}
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapePrintText(exam.title??"试卷")}</title><style>body{max-width:850px;margin:40px auto;padding:0 24px;color:#222;font:17px/1.8 sans-serif}h1{font-size:28px}h2{font-size:19px;margin-top:32px}img{max-width:100%}.formula{height:1.6em;vertical-align:middle}table{border-collapse:collapse}td{border:1px solid #aaa;padding:8px}section{break-inside:avoid}p{white-space:pre-wrap}@media print{body{margin:0}}</style><body>${body.join("\n")}</body></html>`;
}
