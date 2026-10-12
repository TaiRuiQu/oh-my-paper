import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadEnvironment } from "./load-env.mjs";

loadEnvironment();

async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--out");
  if (outputIndex >= 0 && !args[outputIndex + 1]) throw new Error("--out requires a new output directory.");
  const outputDir = resolve(outputIndex < 0 ? `${process.env.STORAGE_ROOT ?? "storage"}/exam-parses/${randomUUID()}` : args[outputIndex + 1]);
  const files = args.filter((_, index) => outputIndex < 0 || (index !== outputIndex && index !== outputIndex + 1));
  if (!files.length) throw new Error("Usage: pnpm parse:exam <PDF/JPG/PNG> [more files] [--out <new-directory>]");
  await mkdir(dirname(outputDir), { recursive: true, mode: 0o700 });
  const { parseExam } = await import("../src/server/exams");
  const exam = await parseExam({ files, outputDir,
    onProgress: ({ page, total, phase }) => console.log(`Page ${page}/${total}: ${phase}`) });
  console.log(JSON.stringify({ outputDir, questions: exam.questions.length, materials: exam.materials.length,
    figures: exam.assets.length, status: exam.verification.status, findings: exam.verification.findings.length,
    usage: exam.verification.usage }, null, 2));
  if (exam.verification.status === "partial") process.exitCode = 2;
}

main().catch(() => {
  // Provider errors may contain full requests, images or credentials. Keep CLI logs private.
  console.error("Exam parsing failed. Check input files, output directory, Poppler tools, and DeepSeek credentials/network.");
  process.exitCode = 1;
});
