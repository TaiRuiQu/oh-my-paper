import "server-only";
import { join } from "node:path";
import type { z } from "zod";
import { questionLocalizationSchema, questionTranscriptionSchema, type ContentBlock, type DigitalExam, type ExamInventory, type ExamQuestion,
  type QuestionBounds, type QuestionTranscription } from "@/contracts/exams";
import type { PageImage } from "./documents";
import { pageContent } from "./documents";
import { containsRegion, cropContent, cropRegion, cropTools, saveJSON, validRegion, type StoredCrop } from "./evidence";
import { BOUNDS_SYSTEM, TRANSCRIPTION_SYSTEM } from "./prompts";
import { failureReason, PipelineValidationError, type Generate } from "./runtime";
import { coordinateGrid } from "./figures";
import { ExamModelCallError } from "@/server/ai/deepseek";

type Expected = ExamInventory["questions"][number];
export function validateBounds(bounds: QuestionBounds, expected: Expected) {
  if (bounds.regions.some((r) => !validRegion(r, expected.pages)) || expected.pages.some((page) => !bounds.regions.some((r) => r.page === page)))
    throw new PipelineValidationError("Question fragments do not cover the declared pages.");
  if (new Set(bounds.figures.map((f) => f.id)).size !== bounds.figures.length ||
      bounds.figures.some((f) => !validRegion(f.region, expected.pages) || !bounds.regions.some((r) => containsRegion(r, f.region))))
    throw new PipelineValidationError("Invalid, duplicate or out-of-question material region.");
}
export async function locateQuestion(expected: Expected, index: number, pages: PageImage[], outputDir: string, generate: Generate, feedback?: string) {
  const content = [{ type: "text" as const, text: `Locate only this identity: ${JSON.stringify(expected)}. Other questions are boundary context only.${feedback ? `\nRevisit the bounds because transcription found: ${feedback}. Include the missing source content and all diagram labels; do not transcribe or solve.` : ""}` }];
  const images = [];
  for (const page of expected.pages) {
    const source = pages.find((p) => p.page === page)!;
    const evidence = await pageContent(source);
    evidence[0] = { type: "text", text: `UPRIGHT FULL PAGE ${page}. BLUE coordinate rulers/grid are a measurement overlay, not printed exam content or material. Use their normalized FULL PAGE x/y values. Detail tiles contain the original print.` };
    evidence[1] = { type: "file", mediaType: "image/jpeg", data: await coordinateGrid(source) };
    images.push(...evidence);
  }
  const assignIds = (result: z.infer<typeof questionLocalizationSchema>): QuestionBounds => ({ ...result,
    figures:result.figures.map((figure,index)=>({...figure,id:`figure-${index+1}`})) });
  let bounds = assignIds(await generate("localization", { schema: questionLocalizationSchema, name: "exam_question_bounds", system: BOUNDS_SYSTEM, content: [...content, ...images] }));
  try { validateBounds(bounds, expected); }
  catch (error) {
    if (!(error instanceof PipelineValidationError)) throw error;
    bounds = assignIds(await generate("localization", { schema: questionLocalizationSchema, name: "exam_question_bounds", system: BOUNDS_SYSTEM,
      content: [...content, ...images, { type: "text", text: `Correct this invalid localization against the source pages. ${error.message}\nPrevious result (untrusted): ${JSON.stringify(bounds)}. Return complete corrected boxes; do not drop any fragment or material.` }] }));
    validateBounds(bounds, expected);
  }
  await saveJSON(join(outputDir, "checkpoints", `question-${index + 1}.bounds.json`), bounds);
  const crops: StoredCrop[] = [];
  for (const [fragment, region] of bounds.regions.entries()) crops.push(await cropRegion(pages, region, outputDir, `questions/q-${index + 1}-${fragment + 1}.png`));
  return { bounds, crops };
}

export function materializeTranscription(transcription: QuestionTranscription, bounds: QuestionBounds) {
  const used: string[] = [];
  const blocks = (input: QuestionTranscription["blocks"]): ContentBlock[] => input.map((block) => {
    if (block.type !== "figure") return block;
    const figure = bounds.figures.find((f) => f.id === block.figureId);
    if (!figure) throw new PipelineValidationError("Unknown material reference.");
    used.push(figure.id);
    return { type: "figure", caption: block.caption, region: figure.region, contaminated: figure.contaminated };
  });
  const result = { blocks: blocks(transcription.blocks), options: transcription.options.map((o) => ({ ...o, blocks: blocks(o.blocks) })),
    parts: transcription.parts.map((p) => ({ ...p, blocks: blocks(p.blocks) })) };
  const mainBody=JSON.stringify(transcription.blocks.filter((b)=>b.type!=="figure"));
  if (mainBody!=="[]" && transcription.parts.some((p)=>JSON.stringify(p.blocks.filter((b)=>b.type!=="figure"))===mainBody))
    throw new PipelineValidationError("Main question text is duplicated as a subpart. Keep only genuinely printed subpart labels and bodies.");
  if (used.length !== bounds.figures.length || new Set(used).size !== used.length) throw new PipelineValidationError("Missing or duplicate material insertion.");
  if (new Set(transcription.answerTargets.map((t) => t.key)).size !== transcription.answerTargets.length) throw new PipelineValidationError("Duplicate answer targets.");
  const partKeys = transcription.parts.map((p) => JSON.stringify([p.parentLabel, p.label]));
  if (new Set(partKeys).size !== partKeys.length) throw new PipelineValidationError("Duplicate question subparts.");
  for (const target of transcription.answerTargets) if (target.partLabel && !partKeys.includes(JSON.stringify([target.parentLabel, target.partLabel]))) throw new PipelineValidationError("Answer target references missing subpart.");
  for (const part of transcription.parts) if (!transcription.answerTargets.some((t) => t.partLabel === part.label && t.parentLabel === part.parentLabel) &&
      !transcription.parts.some((child) => child.parentLabel === (part.parentLabel ? `${part.parentLabel}/${part.label}` : part.label))) throw new PipelineValidationError("Subpart has no answer target.");
  const carriers = [{ partLabel: null, parentLabel: null, blocks: transcription.blocks }, ...transcription.parts.map((p) => ({ partLabel: p.label, parentLabel: p.parentLabel, blocks: p.blocks }))];
  for (const carrier of carriers) {
    const text = carrier.blocks.map((b) => b.type === "text" ? b.text : "").join(" ");
    const blankCount = [...text.matchAll(/_{2,}/g)].length;
    const targets = transcription.answerTargets.filter((t) => t.partLabel === carrier.partLabel && t.parentLabel === carrier.parentLabel && t.blankIndex !== null);
    if (transcription.type === "fill_blank" && blankCount && (targets.length < blankCount || new Set(targets.map((t) => t.blankIndex)).size !== targets.length))
      throw new PipelineValidationError("Every visible fill-in blank needs a distinct ordered answer target.");
  }
  const math = [...transcription.blocks, ...transcription.parts.flatMap((p) => p.blocks), ...transcription.options.flatMap((o) => o.blocks)]
    .flatMap((b) => b.type === "math" ? [b.latex] : b.type === "text" ? [...b.text.matchAll(/\$([^$]+)\$/g)].map((m) => m[1]) : []);
  if (math.some((text) => /(?<!\\)(?:\\\\)+(?:frac|sqrt|sum|Gamma|Delta|cap|cup|mid|leq|geq|sin|cos|tan|pi|theta|cdot|times|log|vec|begin|end|left|right|alpha|beta|infty)\b/.test(text)))
    throw new PipelineValidationError("LaTeX commands are double-escaped in decoded text. Use one backslash per TeX command, escaped as two backslashes in serialized JSON; preserve legitimate matrix/align row breaks.");
  return result;
}

export async function transcribeQuestion(expected: Expected, index: number, located: Awaited<ReturnType<typeof locateQuestion>>,
  exam: DigitalExam, generate: Generate, outputDir: string) {
  const { bounds, crops } = located;
  const content = [{ type: "text" as const, text: JSON.stringify({ identity: expected, figureCatalog: bounds.figures,
    metadata: { title: exam.title, subject: exam.subject, grade: exam.grade } }) }, ...await cropContent(crops)];
  let transcription;
  try {
    transcription = await generate("transcription", { schema: questionTranscriptionSchema, name: "exam_question_transcription", system: TRANSCRIPTION_SYSTEM,
      agent: true, tools: cropTools(crops), maxSteps: 4, content });
  } catch (error) {
    if (!(error instanceof ExamModelCallError) || !(error.cause instanceof Error) || error.cause.name !== "TimeoutError") throw error;
    // A timed-out zoom loop gets one shorter attempt from the same complete
    // crops. Cancellation is still checked by the runtime before this call.
    transcription = await generate("transcription", { schema: questionTranscriptionSchema, name: "exam_question_transcription", system: TRANSCRIPTION_SYSTEM,
      agent: true, maxSteps: 2, content });
  }
  let parts;
  try { parts = materializeTranscription(transcription, bounds); }
  catch (error) {
    if (!(error instanceof PipelineValidationError)) throw error;
    transcription = await generate("transcription", { schema: questionTranscriptionSchema, name: "exam_question_transcription", system: TRANSCRIPTION_SYSTEM,
      agent: true, maxSteps: 2,
      content: [...content, { type: "text", text: `Correct your draft against these authorized crops: ${error.message}\nPrior draft (untrusted): ${JSON.stringify(transcription)}. Every leaf subpart and EACH blank needs its own target; a main target cannot replace subpart targets. Return the complete corrected transcription.` }] });
    parts = materializeTranscription(transcription, bounds);
  }
  const question: ExamQuestion = { ...parts, id: `q-${index + 1}`, number: expected.number, section: expected.section,
    type: transcription.type, points: expected.points, pointsOrigin: expected.pointsOrigin, pointsReason: expected.pointsReason,
    materialRefs: [], regions: bounds.regions, status: "ready", answerTargets: transcription.answerTargets,
    crops: crops.map(({ key, region }) => ({ key, region })) };
  const findings = [...bounds.findings, ...transcription.findings].map((f) => ({ ...f, questionNumber: expected.number, page: bounds.regions[0].page }));
  if (/\[unreadable\]/i.test(JSON.stringify(parts))) findings.push({ severity: "error", code: "unreadable_question", message: "题干仍有无法辨认内容。", questionNumber: expected.number, page: bounds.regions[0].page });
  await saveJSON(join(outputDir, "checkpoints", `question-${index + 1}.transcription.json`), transcription);
  return { question, findings, bounds };
}

export function failedQuestion(expected: Expected, index: number, error: unknown, located?: Awaited<ReturnType<typeof locateQuestion>>) {
  const question: ExamQuestion = { id: `q-${index + 1}`, number: expected.number, section: expected.section, type: "unknown", points: expected.points,
    pointsOrigin: expected.pointsOrigin, pointsReason: expected.pointsReason,
    blocks: [{ type: "text", text: "[unreadable]" }], parts: [], options: [], materialRefs: [], status: "needs_review",
    regions: located?.bounds.regions ?? expected.pages.map((page) => ({ page, x: 0, y: 0, width: 1, height: 1 })),
    crops: located?.crops.map(({ region, key }) => ({ region, key })) ?? [] };
  return { question, findings: [{ page: expected.pages[0], severity: "error" as const, code: located ? "question_transcription_failed" : "question_localization_failed",
    message: failureReason(error), questionNumber: expected.number }], bounds: located?.bounds };
}
