import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { examInventorySchema, type DigitalExam } from "@/contracts/exams";
import type { AiStage } from "@/contracts/ai-providers";
import type { AgentEvent } from "@/contracts/recognition";
import type { PromptPresetId } from "@/contracts/prompt-presets";
import { createDeepSeekExamModel, type ExamModel } from "@/server/ai/deepseek";
import {
  DEFAULT_LIMITS,
  ensureEmptyOutput,
  prepareDocuments,
  rotatePage,
  type DocumentLimits,
  type PageImage,
} from "./documents";
import { exportExamMarkdown } from "./export";
import { saveJSON } from "./evidence";
import { pipelineRuntime, PipelineValidationError, type PipelineModels } from "./runtime";
import { solveExamQuestions } from "./solutions";
import { activityWriter } from "./activity";
import { recognizeDocument, RECOGNITION_VERSION } from "./recognition-agent";

export type ParsePhase = "recognizing" | "solving" | "saved" | "failed";
export type ParseExamOptions = {
  files: string[];
  outputDir: string;
  model?: ExamModel;
  models?: PipelineModels;
  signal?: AbortSignal;
  promptPreset?: PromptPresetId;
  stagePresets?: Partial<Record<AiStage, PromptPresetId>>;
  maxConcurrency?: number;
  generateAnswers?: boolean;
  extractStudentAnswers?: boolean;
  template?: DigitalExam;
  loadTemplateFigure?: (key: string) => Promise<Uint8Array>;
  limits?: Partial<DocumentLimits>;
  onProgress?: (event: { page: number; total: number; phase: ParsePhase }) => void | Promise<void>;
  onAgentEvent?: (event: AgentEvent) => void | Promise<void>;
  recognitionDraft?: {
    sourceFiles: DigitalExam["sourceFiles"];
    rotations: { page: number; rotation: number }[];
    result: unknown;
    feedback?: string;
  };
};

export async function parseExam(options: ParseExamOptions): Promise<DigitalExam> {
  if (!options.files.length) throw new Error("At least one exam file is required.");
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  if (Object.values(limits).some((v) => !Number.isSafeInteger(v) || v < 1))
    throw new Error("Parser limits must be positive integers.");
  const model =
    options.models?.recognition ??
    options.models?.inventory ??
    options.model ??
    createDeepSeekExamModel();
  const outputDir = resolve(options.outputDir);
  await ensureEmptyOutput(outputDir);
  const emit = activityWriter(outputDir, options.onAgentEvent);
  await emit({
    type: "started",
    text: "正在准备文件，识别 Agent 将自主选择工具。",
    data: { model: model.name, version: RECOGNITION_VERSION },
  });
  try {
    const { sources, pages } = await prepareDocuments(
      options.files,
      outputDir,
      limits,
      options.signal,
    );
    if (options.recognitionDraft) {
      const draft = options.recognitionDraft;
      if (
        JSON.stringify(sources.map((s) => s.sha256)) !==
        JSON.stringify(draft.sourceFiles.map((s) => s.sha256))
      )
        throw new Error("Recognition draft belongs to a different source document.");
      if (draft.rotations.length !== pages.length)
        throw new Error("Draft page coverage differs from the uploaded document.");
      for (const page of pages) {
        const rotation = draft.rotations.find((r) => r.page === page.page)?.rotation;
        if (rotation === undefined || ![0, 90, 180, 270].includes(rotation))
          throw new Error("Invalid draft orientation.");
        await rotatePage(page, rotation);
      }
    }
    for (const dir of ["checkpoints", "figures", "questions", "answers", "agent"])
      await mkdir(join(outputDir, dir), { mode: 0o700 });
    const exam: DigitalExam = {
      schemaVersion: "1.0",
      id: randomUUID(),
      title: null,
      subject: null,
      grade: null,
      sourceFiles: sources,
      pages: pages.map(({ page, key, width, height, rotation }) => ({
        page,
        key,
        width,
        height,
        rotation,
        documentType: "unknown",
        status: "verified",
      })),
      instructions: [],
      questions: [],
      materials: [],
      annotations: [],
      assets: [],
      pipeline: {
        version: RECOGNITION_VERSION,
        generateAnswers: options.generateAnswers ?? true,
        models: { recognition: model.name },
      },
      verification: {
        status: "partial",
        model: model.name,
        promptVersion: RECOGNITION_VERSION,
        findings: [],
        corrections: [],
        usage: { inputTokens: 0, outputTokens: 0, calls: 0 },
      },
    };
    if (options.template) {
      const template = options.template;
      Object.assign(exam, {
        title: template.title,
        subject: template.subject,
        grade: template.grade,
        instructions: structuredClone(template.instructions),
        questions: structuredClone(template.questions),
        materials: structuredClone(template.materials),
        assets: structuredClone(template.assets),
        template: template.template,
      });
      for (const asset of exam.assets)
        for (const key of new Set(
          [asset.evidenceKey, asset.cleanKey].filter((k): k is string => !!k),
        )) {
          if (!options.loadTemplateFigure || !/^figures\/figure-\d+\.png$/.test(key))
            throw new Error("Template figure loader required.");
          await writeFile(join(outputDir, key), await options.loadTemplateFigure(key), {
            mode: 0o600,
          });
        }
    }
    await options.onProgress?.({ phase: "recognizing", page: 0, total: pages.length });
    await recognizeDocument({
      exam,
      pages,
      outputDir,
      model,
      signal: options.signal,
      template: options.template,
      extractStudentAnswers: options.extractStudentAnswers,
      onEvent: emit,
      draft: options.recognitionDraft,
    });
    if (!options.template) {
      const runtime = pipelineRuntime(
        exam,
        options.model ?? model,
        options.models,
        options.signal,
        options.stagePresets,
        options.promptPreset,
      );
      exam.pipeline!.models.solution = runtime.pick("solution").name;
      // Optional answer generation remains a separate service, outside the recognition agent.
      await solveExamQuestions({
        exam,
        outputDir,
        generate: runtime.generate,
        modelName: runtime.pick("solution").name,
        concurrency: options.maxConcurrency ?? runtime.pick("solution").maxConcurrency ?? 3,
        generateAnswers: options.generateAnswers ?? true,
        signal: options.signal,
        onProgress: (page, total) => options.onProgress?.({ phase: "solving", page, total }),
      });
    }
    await persistExam(outputDir, exam);
    await emit({
      type: "completed",
      text: "识别结果已校验并保存。",
      data: {
        questions: exam.questions.length,
        annotations: exam.annotations.length,
        figures: exam.assets.length,
        usage: exam.verification.usage,
      },
    });
    await options.onProgress?.({ phase: "saved", page: pages.length, total: pages.length });
    return exam;
  } catch (error) {
    await emit({
      type: "failed",
      text: options.signal?.aborted
        ? "识别已中断；已有工具记录已保留。"
        : "识别未完成；已有工具记录已保留，可检查后重新识别。",
    });
    throw error;
  }
}

export function validateInventory(
  inventory: z.infer<typeof examInventorySchema>,
  pages: PageImage[],
) {
  const pageNumbers = pages.map((p) => p.page);
  if (
    inventory.pages.length !== pages.length ||
    new Set(inventory.pages.map((p) => p.page)).size !== pages.length ||
    pageNumbers.some((page) => !inventory.pages.some((p) => p.page === page))
  )
    throw new PipelineValidationError("Inventory page coverage mismatch.");
  if (inventory.totalQuestions !== inventory.questions.length)
    throw new PipelineValidationError("Inventory question count mismatch.");
  if (
    !inventory.questions.length &&
    inventory.pages.some((p) => p.hasQuestionStems || p.documentType === "question_paper")
  )
    throw new PipelineValidationError(
      "Pages with printed question stems contain no question identities.",
    );
  if (
    new Set(inventory.questions.map((q) => JSON.stringify([q.section, q.number]))).size !==
    inventory.questions.length
  )
    throw new PipelineValidationError("Duplicate inventory question identity.");
  if (
    inventory.questions.length &&
    inventory.totalPoints !== null &&
    inventory.questions.every((q) => q.points !== null) &&
    Math.abs(inventory.questions.reduce((sum, q) => sum + q.points!, 0) - inventory.totalPoints) >
      0.01
  )
    throw new PipelineValidationError(
      "Question points do not sum to the declared paper total; re-read printed rules and any inferred allocation.",
    );
  for (const section of inventory.sections) {
    const questions = inventory.questions.filter((q) => q.section === section.title);
    if (
      section.points !== null &&
      questions.length &&
      questions.every((q) => q.points !== null) &&
      Math.abs(questions.reduce((sum, q) => sum + q.points!, 0) - section.points) > 0.01
    )
      throw new PipelineValidationError(
        `Section ${section.title} has ${section.points} points but its question scores sum to ${questions.reduce((sum, q) => sum + q.points!, 0)}; re-read the section rule.`,
      );
  }
  for (const question of inventory.questions) {
    if (
      new Set(question.pages).size !== question.pages.length ||
      question.pages.some((p) => !pageNumbers.includes(p))
    )
      throw new PipelineValidationError("Invalid question page coverage.");
    if (
      (question.points === null) !== (question.pointsOrigin === "unknown") ||
      (question.pointsOrigin === "inferred" && !question.pointsReason.trim())
    )
      throw new PipelineValidationError("Invalid scoring provenance.");
  }
}
export async function persistExam(outputDir: string, exam: DigitalExam) {
  await saveJSON(join(outputDir, "exam.json"), exam);
  await saveJSON(join(outputDir, "verification.json"), exam.verification);
  await writeFile(join(outputDir, "exam.md"), exportExamMarkdown(exam), { mode: 0o600 });
}
