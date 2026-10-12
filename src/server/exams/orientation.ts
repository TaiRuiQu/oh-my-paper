import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

const execute = promisify(execFile);

export async function detectPrintedOrientation(path: string, signal?: AbortSignal): Promise<{
  degrees: number; confidence: number;
} | null> {
  const localRoot = resolve(".tools/tesseract");
  let executable = process.env.TESSERACT_PATH ?? "tesseract";
  let local = false;
  if (!process.env.TESSERACT_PATH) {
    try { await access(join(localRoot, "usr/bin/tesseract")); executable = join(localRoot, "usr/bin/tesseract"); local = true; }
    catch { /* Try a normal system installation. */ }
  }
  const args = [path, "stdout", "--psm", "0", "-l", "osd"];
  const dataPath = process.env.TESSERACT_DATA_PATH ?? (local ? join(localRoot, "usr/share/tesseract-ocr/5/tessdata") : undefined);
  if (dataPath) args.push("--tessdata-dir", dataPath);
  try {
    const { stdout } = await execute(executable, args, { timeout: 20_000, maxBuffer: 64 * 1024, signal,
      env: local ? { ...process.env, LC_ALL: "C", LD_LIBRARY_PATH: `${join(localRoot, "usr/lib/x86_64-linux-gnu")}${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ""}` }
        : { ...process.env, LC_ALL: "C" },
    });
    const degrees = Number(stdout.match(/^Rotate:\s+(\d+)/m)?.[1]);
    const confidence = Number(stdout.match(/^Orientation confidence:\s+([\d.]+)/m)?.[1]);
    if (![0, 90, 180, 270].includes(degrees) || !Number.isFinite(confidence) || confidence < 3) return null;
    return { degrees, confidence };
  } catch { signal?.throwIfAborted(); return null; }
}
