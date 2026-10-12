import type { ContentBlock, DigitalExam } from "@/contracts/exams";

export function exportExamMarkdown(exam: DigitalExam) {
  const render = (blocks: ContentBlock[]): string => blocks.map((block) => {
    if (block.type === "text") return block.text;
    if (block.type === "math") return `$$\n${block.latex}\n$$`;
    if (block.type === "table") {
      if (!block.rows.length) return "";
      const row = (cells: string[]) => `| ${cells.map((cell) => cell.replaceAll("|", "\\|").replaceAll("\n", "<br>")).join(" | ")} |`;
      return [row(block.rows[0]), row(block.rows[0].map(() => "---")), ...block.rows.slice(1).map(row)].join("\n");
    }
    const asset = exam.assets.find((item) => JSON.stringify(item.region) === JSON.stringify(block.region));
    if (!asset?.cleanKey) return `[图像待复核：${block.caption}]`;
    return `![${block.caption.replaceAll("[", "").replaceAll("]", "")}](${asset.cleanKey})`;
  }).join("\n\n");
  const output = [`# ${exam.title ?? "数字试卷"}`, ...exam.instructions];
  for (const material of exam.materials) output.push(`## ${material.title || material.key}`, render(material.blocks));
  let section: string | null = null;
  for (const question of exam.questions) {
    if (section !== question.section) { section = question.section; if (section) output.push(`## ${section}`); }
    output.push(`### ${question.number}${question.points === null ? "" : `（${question.points} 分）`}`);
    if (question.status === "needs_review") output.push("[本题有内容待复核]");
    if (question.materialRefs.length) output.push(`材料：${question.materialRefs.join("、")}`);
    output.push(render(question.blocks));
    for (const option of question.options) output.push(`${option.label}. ${render(option.blocks)}`);
    for (const part of question.parts) output.push(`${part.parentLabel ?? ""}${part.label} ${render(part.blocks)}`);
  }
  if (!exam.questions.length) output.push("本文件未识别到完整题干；参考答案与作答保存在独立 annotations 中。");
  return output.filter(Boolean).join("\n\n") + "\n";
}
