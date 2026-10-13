import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { AppError } from "@/server/errors";
const execute = promisify(execFile);
const metadataSchema = z.object({
  originalWidth: z.number().int().positive(),
  originalHeight: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  detectorSize: z.literal(320),
  confidence: z.number().min(0).max(1).nullable(),
  corners: z
    .array(z.tuple([z.number().finite(), z.number().finite()]))
    .length(4)
    .nullable(),
  corrected: z.boolean(),
  reason: z.enum(["rendered_pdf", "flat_scan", "low_confidence", "invalid_corners", "corrected"]),
});
export async function scanDocumentPage(options: {
  input: string;
  output: string;
  detect: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
}) {
  const localPython = join(process.cwd(), ".venv", "bin", "python");
  const python =
    process.env.DOCUMENT_SCAN_PYTHON ??
    (process.env.PYTHON_SANDBOX_VENV
      ? join(resolve(process.env.PYTHON_SANDBOX_VENV), "bin", "python")
      : existsSync(localPython)
        ? localPython
        : "python3");
  const script = join(process.cwd(), "tools/document-scan/scan.py");
  const model =
    process.env.DOCUMENT_SCAN_MODEL ?? join(process.cwd(), "assets/models/doccornernet-320.onnx");
  try {
    const { stdout } = await execute(
      python,
      [
        script,
        "--input",
        options.input,
        "--output",
        options.output,
        "--model",
        model,
        ...(options.detect ? [] : ["--skip-detection"]),
      ],
      {
        signal: options.signal,
        timeout: options.timeoutMs,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, OMP_NUM_THREADS: "1", OPENBLAS_NUM_THREADS: "1" },
      },
    );
    const metadata = metadataSchema.parse(JSON.parse(stdout));
    await writeFile(`${options.output}.scan.json`, JSON.stringify(metadata, null, 2), {
      mode: 0o600,
    });
    return metadata;
  } catch (cause) {
    options.signal?.throwIfAborted();
    throw new AppError(
      "扫描预处理失败，请检查 Python、OpenCV 和 DocCornerNet 模型安装（DOCUMENT_SCAN_PYTHON / DOCUMENT_SCAN_MODEL）。",
      "DOCUMENT_SCAN_FAILED",
      422,
      { cause },
    );
  }
}
