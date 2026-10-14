import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import sharp from "sharp";
import { logError } from "@/server/logger";
import { validateCardTemplate, cardPageCode } from "./cards";
import type { Box, CardTemplate, SubmissionAnswer } from "./types";
const execute = promisify(execFile);
export type ScanResult = {
  studentNumber: string | null;
  answers: (SubmissionAnswer & {
    omr?: { scores: Record<string, number>; needsReview: boolean };
  })[];
  alignment: Record<string, unknown>;
  needsReview: boolean;
};
async function runScan(
  inputPath: string,
  outputDir: string,
  config: Record<string, unknown>,
): Promise<ScanResult> {
  const temp = await mkdtemp(join(tmpdir(), "omp-card-"));
  try {
    await mkdir(outputDir, { recursive: true });
    // Flatten and EXIF-orient at full resolution before reading pixels in OpenCV.
    await sharp(inputPath, { limitInputPixels: 80_000_000 })
      .rotate()
      .flatten({ background: "white" })
      .png()
      .toFile(join(temp, "input.png"));
    await writeFile(join(temp, "config.json"), JSON.stringify(config));
    const python =
      process.env.CARD_SCAN_PYTHON ??
      (existsSync(resolve(".venv/bin/python")) ? resolve(".venv/bin/python") : "python3");
    const { stdout } = await execute(
      python,
      [
        resolve("tools/card-scan/scan.py"),
        "--input",
        join(temp, "input.png"),
        "--config",
        join(temp, "config.json"),
        "--output",
        resolve(outputDir),
      ],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(stdout) as ScanResult;
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr
        : "";
    const known: Record<string, string> = {
      REGISTRATION_MARKS_MISSING: "请保证四个定位点均清晰且未被裁掉。",
      REGISTRATION_MARKS_INVALID: "四个定位点无法形成有效页面，请重新扫描。",
      CARD_PAGE_CODE_MISSING: "页面识别码不清晰，请按模板重新打印。",
      CARD_TEMPLATE_MISMATCH: "答题卡不属于所选模板。",
      CARD_PAGE_ORDER: "答题卡页码与上传顺序不符，请按每位学生的页码排序。",
    };
    const code =
      /ValueError: (REGISTRATION_MARKS_MISSING|REGISTRATION_MARKS_INVALID|CARD_PAGE_CODE_MISSING|CARD_TEMPLATE_MISMATCH|CARD_PAGE_ORDER):/.exec(
        stderr,
      )?.[1];
    if (code) throw new Error(`${code}: ${known[code]}`);
    const { errorId } = logError("platform.scan.failed", error);
    throw new Error(`扫描处理失败，请重试或联系管理员（${errorId}）。`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
export async function processCardScan(options: {
  inputPath: string;
  template: CardTemplate;
  page?: number;
  outputDir: string;
}): Promise<ScanResult> {
  validateCardTemplate(options.template);
  const page = options.page ?? 1;
  if (!Number.isInteger(page) || page < 1 || page > options.template.layout.pageCount)
    throw new Error("答题卡页码不存在");
  return runScan(options.inputPath, options.outputDir, {
    mode: "card",
    layout: options.template.layout,
    page,
    pageCode: cardPageCode(options.template.id, page),
  });
}
export async function cropWorkbook(options: {
  inputPath: string;
  regions: (Box & { itemId: string })[];
  outputDir: string;
}): Promise<ScanResult> {
  if (
    !options.regions.length ||
    new Set(options.regions.map((r) => r.itemId)).size !== options.regions.length
  )
    throw new Error("练习册裁切须逐题提供唯一坐标");
  for (const r of options.regions)
    if (
      ![r.x, r.y, r.width, r.height].every(Number.isFinite) ||
      r.x < 0 ||
      r.y < 0 ||
      r.width <= 0 ||
      r.height <= 0 ||
      r.x + r.width > 1 ||
      r.y + r.height > 1
    )
      throw new Error("练习册坐标必须在页面内");
  return runScan(options.inputPath, options.outputDir, {
    mode: "workbook",
    regions: options.regions,
  });
}
