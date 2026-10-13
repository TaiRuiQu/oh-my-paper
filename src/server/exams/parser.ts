import "server-only";
import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { UserContent } from "ai";
import { parsedExamSchema, type Material } from "@/contracts/exams";
import { UPLOAD_LIMITS, type QuestionProgress } from "@/contracts/exam-tasks";
import type { ExamModel } from "@/server/ai/providers";
import { prepareDocuments, DEFAULT_LIMITS } from "./documents";
import { AppError } from "@/server/errors";
import type { AgentEventInput } from "@/contracts/activity";
import { createInspectionTools, disposeInspectionTools } from "./tools";
import { EXAM_PARSING_PROMPT } from "./prompts";
import { examMaterials } from "@/lib/exam-materials";

export function materialPixels(box: Material, page: { width: number; height: number }) {
  const left = Math.floor(box.x * page.width),
    top = Math.floor(box.y * page.height);
  return {
    left,
    top,
    width: Math.max(
      1,
      Math.min(page.width - left, Math.ceil((box.x + box.width) * page.width) - left),
    ),
    height: Math.max(
      1,
      Math.min(page.height - top, Math.ceil((box.y + box.height) * page.height) - top),
    ),
  };
}
export async function parseExam(options: {
  files: string[];
  outputDir: string;
  model: ExamModel;
  signal?: AbortSignal;
  onEvent?: (event: AgentEventInput) => Promise<void>;
  onPhase?: (phase: string) => void;
  onQuestionProgress?: (progress: QuestionProgress) => Promise<void>;
}) {
  options.onPhase?.("prepare_documents");
  await mkdir(options.outputDir, { mode: 0o700 });
  await options.onEvent?.({ type: "started", text: "开始读取上传文件。" });
  const pages = await prepareDocuments(
    options.files,
    options.outputDir,
    { ...DEFAULT_LIMITS, maxPages: UPLOAD_LIMITS.pages },
    options.signal,
  );
  if (!pages.length) throw new AppError("试卷没有可读取的页面。", "EXAM_EMPTY", 422);
  await mkdir(join(options.outputDir, "agent"), { mode: 0o700 });
  await options.onEvent?.({ type: "message", text: `已准备 ${pages.length} 页试卷，开始识别。` });
  const content: UserContent = [];
  for (const page of pages) {
    options.signal?.throwIfAborted();
    content.push({
      type: "text",
      text: `Page ${page.page} (${page.width} × ${page.height}).`,
    });
    content.push({ type: "file", data: await readFile(page.path), mediaType: "image/jpeg" });
  }
  options.onPhase?.("model_recognition");
  const materialPages = new Set<number>();
  const validateMaterials = (exam: Parameters<typeof examMaterials>[0]) => {
    for (const { box, questionNumber, subquestionNumber } of examMaterials(exam)) {
      if (!pages.some((page) => page.page === box.page))
        throw new AppError(
          `第 ${questionNumber} 题${subquestionNumber ?? ""}的材料指向不存在的第 ${box.page} 页（missing page），试卷共 ${pages.length} 页。`,
          "MATERIAL_PAGE_INVALID",
          422,
        );
    }
  };
  const inspection = createInspectionTools(pages, options.outputDir, options.signal, (numbers) => {
    if (numbers.some((page) => materialPages.has(page)))
      throw new AppError(
        "该页面已有保存的材料坐标，请先完成页面旋转，再识别和保存题目。",
        "PAGE_ALREADY_USED",
        422,
      );
  });
  try {
    const exam = parsedExamSchema.parse(
      await options.model.generate({
        system: EXAM_PARSING_PROMPT,
        content,
        signal: options.signal,
        tools: inspection,
        onEvent: options.onEvent,
        onQuestionProgress: options.onQuestionProgress,
        onProgress: async (draft) => {
          options.signal?.throwIfAborted();
          validateMaterials(draft);
          const previousPages = new Set(materialPages);
          materialPages.clear();
          for (const { box } of examMaterials(draft)) materialPages.add(box.page);
          try {
            const temporary = join(options.outputDir, "draft.json.tmp");
            await writeFile(temporary, JSON.stringify(draft, null, 2), { mode: 0o600 });
            await rename(temporary, join(options.outputDir, "draft.json"));
          } catch (error) {
            materialPages.clear();
            for (const page of previousPages) materialPages.add(page);
            throw error;
          }
        },
      }),
    );
    options.onPhase?.("crop_materials");
    validateMaterials(exam);
    await mkdir(join(options.outputDir, "materials"));
    for (const { key, box } of examMaterials(exam)) {
      options.signal?.throwIfAborted();
      const page = pages.find((page) => page.page === box.page)!;
      await sharp(page.path)
        .extract(materialPixels(box, page))
        .jpeg({ quality: 95 })
        .toFile(join(options.outputDir, key));
    }
    options.onPhase?.("save_result");
    await writeFile(join(options.outputDir, "exam.json"), JSON.stringify(exam, null, 2), {
      mode: 0o600,
    });
    await rm(join(options.outputDir, "draft.json"), { force: true });
    return exam;
  } finally {
    await disposeInspectionTools(inspection);
  }
}
