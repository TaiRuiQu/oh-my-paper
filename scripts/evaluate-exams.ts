import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { examSamples } from "../evals/exam-samples";
import type { DigitalExam } from "../src/contracts/exams";
import { loadEnvironment } from "./load-env.mjs";
import { failureReason } from "../src/server/exams/runtime";
import { regionsEqual } from "../src/lib/figure-assets";

loadEnvironment();

export function checkExamSample(sample: (typeof examSamples)[number], exam: DigitalExam) {
  const actualNumbers = exam.questions.map((question) => question.number);
  const questionFigures = [...exam.questions.flatMap((q) => [...q.blocks, ...q.options.flatMap((o) => o.blocks), ...q.parts.flatMap((p) => p.blocks)]),
    ...exam.materials.flatMap((m) => m.blocks)].filter((block) => block.type === "figure");
  const questionAssets = exam.assets.filter((asset) => asset.role !== "student_answer" && questionFigures.some((block) => block.type === "figure" && regionsEqual(block.region,asset.region)));
  const checks: { name: string; passed: boolean; actual: unknown; expected: unknown }[] = [
    { name: "page_count", passed: exam.pages.length === sample.pages, actual: exam.pages.length, expected: sample.pages },
    { name: "question_numbers_in_order", passed: JSON.stringify(actualNumbers) === JSON.stringify(sample.numbers), actual: actualNumbers, expected: sample.numbers },
    { name: "figure_coverage", passed: questionAssets.length >= sample.minFigures, actual: questionAssets.length, expected: `>=${sample.minFigures}` },
    { name: "all_questions_localized_and_transcribed", passed: !exam.verification.findings.some((finding) => ["question_localization_failed", "question_transcription_failed"].includes(finding.code)),
      actual: exam.questions.filter((q) => /\[unreadable\]/i.test(JSON.stringify(q.blocks))).map((q) => q.number), expected: "no failed localization or transcription" },
    { name: "polluted_figures_withheld", passed: exam.assets.every((asset) => !asset.contaminated || asset.cleanKey === null), actual: exam.assets.filter((asset) => asset.contaminated).length, expected: "all contaminated cleanKey=null" },
    ...sample.annotationKinds.filter((kind) => kind !== "student_answer" || !!exam.answerDocument).map((kind) => ({ name: `separated_${kind}`, passed: exam.annotations.some((annotation) => annotation.kind === kind),
      actual: exam.annotations.filter((annotation) => annotation.kind === kind).length, expected: ">=1" })),
  ];
  if ("rotation" in sample) checks.push({ name: "upright_orientation", passed: exam.pages[0]?.rotation === sample.rotation,
    actual: exam.pages[0]?.rotation, expected: sample.rotation });
  if ("answerOnlyPages" in sample) checks.push({ name: "no_questions_in_answer_only_pages",
    passed: exam.questions.every((question) => question.regions.every((region) => !(sample.answerOnlyPages as readonly number[]).includes(region.page))),
    actual: exam.questions.filter((question) => question.regions.some((region) => (sample.answerOnlyPages as readonly number[]).includes(region.page))).map((question) => question.number), expected: [] });
  return checks;
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const root = resolve(value("--out") ?? `${process.env.STORAGE_ROOT ?? "storage"}/exam-evals/${randomUUID()}`);
  const only = value("--only")?.split(",");
  const selected = examSamples.filter((sample) => !only || only.includes(sample.id));
  if (!selected.length) throw new Error("No matching sample IDs.");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const { parseExam } = await import("../src/server/exams");
  const configured = args.includes("--configured") ? await (async () => {
    const { getPipelineProviderSnapshot } = await import("../src/server/ai/settings");
    const { modelsFromSnapshot } = await import("../src/server/ai/pipeline");
    return modelsFromSnapshot(await getPipelineProviderSnapshot());
  })() : undefined;
  if (configured) console.log(`Stage models: ${JSON.stringify(Object.fromEntries(Object.entries(configured.models).map(([stage, model]) => [stage, model!.name])))}`);
  const reports: object[] = [];
  let pendingReport = Promise.resolve();
  const saveReport = () => {
    pendingReport = pendingReport.then(async () => {
      const path = join(root, "report.json");
      await writeFile(`${path}.tmp`, JSON.stringify({
        createdAt: new Date().toISOString(), note: "Development sample structural and evidence-coverage checks; not measured transcription or solution accuracy.", reports,
      }, null, 2) + "\n", { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    });
    return pendingReport;
  };
  let next = 0;
  // Independent documents may run concurrently; dependent pages within a document stay ordered.
  await Promise.all([0, 1].map(async () => {
    while (next < selected.length) {
      const sample = selected[next++];
      const outputDir = join(root, sample.id);
      let exam: DigitalExam;
      try {
        exam = args.includes("--reuse")
          ? JSON.parse(await readFile(join(outputDir, "exam.json"), "utf8"))
          : await parseExam({ files: [resolve("examples", sample.file)], outputDir,
            ...(configured ? { model: configured.model, models: configured.models, stagePresets: configured.stagePresets } : {}),
            generateAnswers: !args.includes("--no-answers"), extractStudentAnswers: args.includes("--student-answers"),
            onProgress: ({ page, total, phase }) => console.log(`${sample.id}: ${page}/${total} ${phase}`) });
        const checks = checkExamSample(sample, exam);
        reports.push({ sample: sample.id, outputDir, passed: checks.every((check) => check.passed), checks,
          reviewStatus: exam.verification.status, findings: exam.verification.findings, usage: exam.verification.usage });
        console.log(`${sample.id}: ${checks.filter((check) => check.passed).length}/${checks.length} structural checks passed; ${exam.questions.length} questions, ${exam.assets.length} figures; ${exam.verification.status}`);
      } catch (error) {
        reports.push({ sample: sample.id, outputDir, passed: false, error: failureReason(error) });
      }
      await saveReport();
    }
  }));
  await saveReport();
  console.log(`Evaluation report: ${join(root, "report.json")}`);
  if (reports.some((report) => !(report as { passed: boolean }).passed)) process.exitCode = 2;
}

main().catch(() => { console.error("Sample evaluation failed."); process.exitCode = 1; }).finally(async () => {
  if (process.argv.includes("--configured")) await (await import("../src/server/db/client")).disconnectDatabase();
});
