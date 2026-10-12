import "server-only";
import { join } from "node:path";
import { answerLayoutSchema, answerTranscriptionSchema, type AnswerDocument, type DigitalExam } from "@/contracts/exams";
import { containsRegion, cropContent, cropRegion, cropTools, saveJSON, validRegion, type StoredCrop } from "./evidence";
import { pageContent, type PageImage } from "./documents";
import { ANSWER_LAYOUT_SYSTEM, ANSWER_TRANSCRIPTION_SYSTEM } from "./prompts";
import type { Generate } from "./runtime";
import { regionsEqual } from "@/lib/figure-assets";

export async function extractAnswers(exam: DigitalExam, pages: PageImage[], outputDir: string, generate: Generate) {
  const structure = exam.questions.map((q) => ({ id: q.id, number: q.number, section: q.section, type: q.type,
    blocks: q.blocks, options: q.options, parts: q.parts, answerTargets: q.answerTargets }));
  // Standard answers are intentionally absent from BOTH extraction requests.
  const images = [];
  for (const page of pages) images.push(...await pageContent(page, false));
  const layout = await generate("answer_extraction", { schema: answerLayoutSchema, name: "exam_answer_layout", system: ANSWER_LAYOUT_SYSTEM,
    content: [{ type: "text", text: `Fixed clean exam structure: ${JSON.stringify(structure)}` }, ...images] });
  if (layout.pages.length !== pages.length || new Set(layout.pages.map((p) => p.page)).size !== pages.length ||
    pages.some((p) => !layout.pages.some((info) => info.page === p.page))) throw new Error("Answer layout page coverage mismatch.");
  if (new Set(layout.responses.map((r) => r.id)).size !== layout.responses.length || layout.responses.some((r) =>
    r.regions.some((region) => !validRegion(region, pages.map((p) => p.page))))) throw new Error("Invalid answer layout.");
  await saveJSON(join(outputDir, "checkpoints", "answer-layout.json"), layout);
  for (const page of exam.pages) page.documentType = layout.pages.find((p) => p.page === page.page)!.documentType;
  const crops: (StoredCrop & { sourceId: string })[] = [];
  for (const [index, response] of layout.responses.entries()) for (const [fragment, region] of response.regions.entries())
    crops.push({ ...await cropRegion(pages, region, outputDir, `answers/response-${index + 1}-${fragment + 1}.png`), sourceId: response.id });
  if (!crops.length) {
    const document: AnswerDocument = { complete: false, responses: [], crops: [], findings: [...layout.findings,
      { severity: "error", code: "no_answer_evidence", message: "未定位到作答区域，不能将缺失证据视为未作答。", questionNumber: null }] };
    exam.answerDocument = document;
    await saveJSON(join(outputDir, "checkpoints", "answer-document.json"), document);
    return;
  }
  const output = await generate("answer_extraction", { schema: answerTranscriptionSchema, name: "exam_answer_transcription", system: ANSWER_TRANSCRIPTION_SYSTEM,
    agent: true, maxSteps: 6, tools: cropTools(crops),
    content: [{ type: "text", text: JSON.stringify({ structure, sources: layout.responses,
      cropMap: crops.map((c, i) => ({ crop: i + 1, sourceId: c.sourceId, region: c.region })) }) }, ...await cropContent(crops)] });
  const findings = [...layout.findings, ...output.findings];
  for (const response of output.responses) {
    const source = layout.responses.find((s) => s.id === response.sourceId);
    if (!source) throw new Error("Unknown answer evidence source.");
    if (response.blank && response.blocks.some((b) => b.type !== "text" || b.text.trim())) throw new Error("Nonempty answer marked blank.");
    if (/\[unreadable\]/i.test(JSON.stringify(response.blocks))) response.unreadable = true;
    if (response.unreadable) response.blank = false;
    for (const block of response.blocks) if (block.type === "figure") {
      if (!validRegion(block.region, pages.map((p) => p.page)) || !source.regions.some((r) => containsRegion(r, block.region)))
        throw new Error("Answer image is outside its source evidence.");
      block.contaminated = true;
      let asset = exam.assets.find((a) => a.role === "student_answer" && regionsEqual(a.region, block.region));
      if (!asset) {
        const id = `figure-${exam.assets.length + 1}`;
        const key = `figures/${id}.png`;
        await cropRegion(pages, block.region, outputDir, key);
        asset = { id, region: block.region, caption: block.caption, contaminated: true, evidenceKey: key, cleanKey: null, role: "student_answer" };
        exam.assets.push(asset);
      }
      block.assetId = asset.id;
    }
  }
  const missing = layout.responses.filter((s) => !output.responses.some((r) => r.sourceId === s.id));
  for (const source of missing) findings.push({ severity: "error", code: "missing_answer_transcription",
    message: `作答区域 ${source.id} 未完成电子化。`, questionNumber: source.questionNumber });
  const document: AnswerDocument = { complete: missing.length === 0 && !findings.some((f) => f.severity === "error"), findings,
    responses: output.responses.map((r) => ({ ...r, regions: layout.responses.find((s) => s.id === r.sourceId)!.regions })),
    crops: crops.map(({ sourceId, region, key }) => ({ sourceId, region, key })) };
  exam.answerDocument = document;
  exam.annotations.push(...document.responses.filter((r) => r.questionNumber !== null && !r.blank).map((r) => ({
    questionNumber: r.questionNumber, section: r.section, partLabel: r.partLabel, kind: "student_answer" as const, blocks: r.blocks, regions: r.regions,
  })));
  await saveJSON(join(outputDir, "checkpoints", "answer-document.json"), document);
}
