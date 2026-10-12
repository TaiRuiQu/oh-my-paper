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
  const files = args.filter((arg, index) => !["--no-answers", "--configured", "--student-answers"].includes(arg) && (outputIndex < 0 || (index !== outputIndex && index !== outputIndex + 1)));
  if (!files.length) throw new Error("Usage: pnpm parse:exam <PDF/JPG/PNG> [more files] [--out <new-directory>]");
  await mkdir(dirname(outputDir), { recursive: true, mode: 0o700 });
  const { parseExam } = await import("../src/server/exams");
  const configured = args.includes("--configured") ? await (async () => {
    const { getPipelineProviderSnapshot } = await import("../src/server/ai/settings");
    const { modelsFromSnapshot } = await import("../src/server/ai/pipeline");
    return modelsFromSnapshot(await getPipelineProviderSnapshot());
  })() : undefined;
  const exam = await parseExam({ files, outputDir,
    ...(configured ? { model: configured.model, models: configured.models, stagePresets: configured.stagePresets } : {}),
    generateAnswers: !args.includes("--no-answers"), extractStudentAnswers: args.includes("--student-answers"),
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
}).finally(async () => {
  if (process.argv.includes("--configured")) await (await import("../src/server/db/client")).disconnectDatabase();
});
