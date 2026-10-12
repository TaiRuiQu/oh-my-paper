import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { examSamples } from "../evals/exam-samples";
import type { DigitalExam } from "../src/contracts/exams";
import { loadEnvironment } from "./load-env.mjs";
import { failureReason } from "../src/server/exams/runtime";
import { regionsEqual } from "../src/lib/figure-assets";
import type { PipelineModels } from "../src/server/exams/runtime";
import { blocksToText } from "../src/lib/grading-defaults";

loadEnvironment();

export function checkExamSample(sample: (typeof examSamples)[number], exam: DigitalExam) {
  const actualNumbers = exam.questions.map((question) => question.number);
  const questionFigures = [
    ...exam.questions.flatMap((q) => [
      ...q.blocks,
      ...q.options.flatMap((o) => o.blocks),
      ...q.parts.flatMap((p) => p.blocks),
    ]),
    ...exam.materials.flatMap((m) => m.blocks),
  ].filter((block) => block.type === "figure");
  const questionAssets = exam.assets.filter(
    (asset) =>
      asset.role !== "student_answer" &&
      questionFigures.some(
        (block) => block.type === "figure" && regionsEqual(block.region, asset.region),
      ),
  );
  const checks: { name: string; passed: boolean; actual: unknown; expected: unknown }[] = [
    {
      name: "page_count",
      passed: exam.pages.length === sample.pages,
      actual: exam.pages.length,
      expected: sample.pages,
    },
    {
      name: "question_numbers_in_order",
      passed: JSON.stringify(actualNumbers) === JSON.stringify(sample.numbers),
      actual: actualNumbers,
      expected: sample.numbers,
    },
    {
      name: "figure_coverage",
      passed: questionAssets.length >= sample.minFigures,
      actual: questionAssets.length,
      expected: `>=${sample.minFigures}`,
    },
    {
      name: "all_questions_localized_and_transcribed",
      passed:
        exam.questions.every(
          (q) =>
            q.regions.length &&
            (q.blocks.length || q.parts.length || q.materialRefs.length) &&
            !/\[unreadable\]/i.test(JSON.stringify(q.blocks)),
        ) &&
        !exam.verification.findings.some((finding) =>
          ["question_localization_failed", "question_transcription_failed"].includes(finding.code),
        ),
      actual: exam.questions
        .filter((q) => /\[unreadable\]/i.test(JSON.stringify(q.blocks)))
        .map((q) => q.number),
      expected: "no failed localization or transcription",
    },
    {
      name: "polluted_figures_withheld",
      passed: exam.assets.every((asset) => !asset.contaminated || asset.cleanKey === null),
      actual: exam.assets.filter((asset) => asset.contaminated).length,
      expected: "all contaminated cleanKey=null",
    },
    ...sample.annotationKinds.map((kind) => ({
      name: `separated_${kind}`,
      passed: exam.annotations.some((annotation) => annotation.kind === kind),
      actual: exam.annotations.filter((annotation) => annotation.kind === kind).length,
      expected: ">=1",
    })),
  ];
  if ("rotation" in sample)
    checks.push({
      name: "upright_orientation",
      passed: exam.pages[0]?.rotation === sample.rotation,
      actual: exam.pages[0]?.rotation,
      expected: sample.rotation,
    });
  if ("referenceNumbers" in sample) {
    const missing = sample.referenceNumbers.filter(
      (number) =>
        !exam.annotations.some(
          (a) =>
            a.kind === "reference_answer" &&
            a.questionNumber === number &&
            blocksToText(a.blocks.filter((b) => b.type !== "figure")).trim(),
        ),
    );
    checks.push({
      name: "numbered_reference_answers",
      passed: !missing.length,
      actual: missing,
      expected: "readable reference text associated with every printed answer number",
    });
  }
  if ("studentNumbers" in sample) {
    const missing = sample.studentNumbers.filter(
      (number) =>
        !exam.annotations.some(
          (a) => a.kind === "student_answer" && a.questionNumber === number && a.blocks.length,
        ),
    );
    checks.push({
      name: "numbered_student_answers",
      passed: !missing.length,
      actual: missing,
      expected: "student evidence associated with every printed question number",
    });
  }
  if ("studentChoiceAnchors" in sample)
    for (const anchor of sample.studentChoiceAnchors) {
      const text = exam.annotations
        .filter((a) => a.kind === "student_answer" && a.questionNumber === anchor.number)
        .map((a) => blocksToText(a.blocks))
        .join("\n");
      const selected = text.trim().match(/^([A-D])(?=[\s。；，,;]|$)/)?.[1];
      checks.push({
        name: `student_choice_${anchor.number}`,
        passed: selected === anchor.choice,
        actual: selected ?? null,
        expected: anchor.choice,
      });
    }
  if ("answerOnlyPages" in sample)
    checks.push({
      name: "no_questions_in_answer_only_pages",
      passed: exam.questions.every((question) =>
        question.regions.every(
          (region) => !(sample.answerOnlyPages as readonly number[]).includes(region.page),
        ),
      ),
      actual: exam.questions
        .filter((question) =>
          question.regions.some((region) =>
            (sample.answerOnlyPages as readonly number[]).includes(region.page),
          ),
        )
        .map((question) => question.number),
      expected: [],
    });
  if ("textAnchors" in sample)
    for (const anchor of sample.textAnchors) {
      const question = exam.questions.find((q) => q.number === anchor.number);
      const text = blocksToText(question?.blocks ?? []).replace(/\s/g, "");
      checks.push({
        name: `source_wording_${anchor.number}`,
        passed: text.includes(anchor.text),
        actual: text.includes(anchor.text),
        expected: anchor.text,
      });
    }
  if ("blankParts" in sample)
    for (const expected of sample.blankParts) {
      const question = exam.questions.find((q) => q.number === expected.number);
      const part = question?.parts.find(
        (p) => p.label.replace(/[（()）\s]/g, "") === expected.partLabel,
      );
      const main = blocksToText(question?.blocks ?? []);
      const partText = part
        ? blocksToText(part.blocks)
        : (main.match(
            new RegExp(
              `[（(]${expected.partLabel}[）)]([\\s\\S]*?)(?=[（(]${Number(expected.partLabel) + 1}[）)]|$)`,
            ),
          )?.[1] ?? "");
      const count = partText.match(/_{2,}|＿{2,}/g)?.length ?? 0;
      checks.push({
        name: `unfilled_source_blanks_${expected.number}_${expected.partLabel}`,
        passed: count >= expected.minBlanks,
        actual: count,
        expected: `>=${expected.minBlanks}`,
      });
    }
  if ("continuationAnchors" in sample)
    for (const expected of sample.continuationAnchors) {
      const question = exam.questions.find((q) => q.number === expected.number);
      const covered =
        question?.regions.some(
          (r) =>
            r.page === 1 &&
            r.x <= expected.x &&
            r.x + r.width >= expected.x &&
            r.y <= expected.y &&
            r.y + r.height >= expected.y,
        ) ?? false;
      checks.push({
        name: `cross_column_continuation_${expected.number}`,
        passed: covered,
        actual: covered,
        expected: { x: expected.x, y: expected.y },
      });
    }
  return checks;
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const root = resolve(
    value("--out") ?? `${process.env.STORAGE_ROOT ?? "storage"}/exam-evals/${randomUUID()}`,
  );
  const only = value("--only")?.split(",");
  const selected = examSamples.filter((sample) => !only || only.includes(sample.id));
  if (!selected.length) throw new Error("No matching sample IDs.");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const { parseExam } = await import("../src/server/exams");
  const configured = value("--provider-id")
    ? await (async () => {
        const { getDb } = await import("../src/server/db/client");
        const { createProviderExamModel } = await import("../src/server/ai/providers");
        const { decryptApiKey } = await import("../src/server/ai/credentials");
        const { providerSchema } = await import("../src/contracts/ai-providers");
        const provider = await getDb().aiProvider.findUniqueOrThrow({
          where: { id: value("--provider-id") },
        });
        return {
          model: createProviderExamModel(
            providerSchema.parse(provider),
            decryptApiKey(provider.encryptedApiKey),
          ),
          models: {} as PipelineModels,
          stagePresets: {},
        };
      })()
    : args.includes("--responses")
      ? await (async () => {
          const { config } = await import("dotenv");
          config({ path: ".local/recognition-api.env", quiet: true });
          const { createProviderExamModel } = await import("../src/server/ai/providers");
          if (!process.env.RECOGNITION_TEST_API_KEY)
            throw new Error("RECOGNITION_TEST_API_KEY required.");
          const { providerSchema } = await import("../src/contracts/ai-providers");
          return {
            model: createProviderExamModel(
              providerSchema.parse({
                name: "Recognition acceptance",
                apiType: "openai_responses",
                baseURL: process.env.RECOGNITION_TEST_BASE_URL,
                model: process.env.RECOGNITION_TEST_MODEL,
                maxOutputTokens: 16000,
                timeoutSeconds: 600,
              }),
              process.env.RECOGNITION_TEST_API_KEY,
            ),
            models: {} as PipelineModels,
            stagePresets: {},
          };
        })()
      : args.includes("--configured")
        ? await (async () => {
            const { getPipelineProviderSnapshot } = await import("../src/server/ai/settings");
            const { modelsFromSnapshot } = await import("../src/server/ai/pipeline");
            return modelsFromSnapshot(await getPipelineProviderSnapshot());
          })()
        : undefined;
  if (configured)
    console.log(
      `Stage models: ${JSON.stringify(Object.fromEntries(Object.entries(configured.models).map(([stage, model]) => [stage, model!.name])))}`,
    );
  const reports: object[] = [];
  let pendingReport = Promise.resolve();
  const saveReport = () => {
    pendingReport = pendingReport.then(async () => {
      const path = join(root, "report.json");
      await writeFile(
        `${path}.tmp`,
        JSON.stringify(
          {
            createdAt: new Date().toISOString(),
            note: "Development sample structural and evidence-coverage checks; not measured transcription or solution accuracy.",
            reports,
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
      await rename(`${path}.tmp`, path);
    });
    return pendingReport;
  };
  let next = 0;
  // Independent documents may run concurrently; dependent pages within a document stay ordered.
  await Promise.all(
    [0, 1].map(async () => {
      while (next < selected.length) {
        const sample = selected[next++];
        const outputDir = join(root, sample.id);
        let exam: DigitalExam;
        try {
          exam = args.includes("--reuse")
            ? JSON.parse(await readFile(join(outputDir, "exam.json"), "utf8"))
            : await parseExam({
                files: [resolve("examples", sample.file)],
                outputDir,
                ...(configured
                  ? {
                      model: configured.model,
                      models: configured.models,
                      stagePresets: configured.stagePresets,
                    }
                  : {}),
                generateAnswers: !args.includes("--no-answers"),
                extractStudentAnswers: args.includes("--student-answers"),
                onProgress: ({ page, total, phase }) =>
                  console.log(`${sample.id}: ${page}/${total} ${phase}`),
              });
          const checks = checkExamSample(sample, exam);
          reports.push({
            sample: sample.id,
            outputDir,
            passed: checks.every((check) => check.passed),
            checks,
            reviewStatus: exam.verification.status,
            findings: exam.verification.findings,
            usage: exam.verification.usage,
          });
          console.log(
            `${sample.id}: ${checks.filter((check) => check.passed).length}/${checks.length} structural checks passed; ${exam.questions.length} questions, ${exam.assets.length} figures; ${exam.verification.status}`,
          );
        } catch (error) {
          reports.push({
            sample: sample.id,
            outputDir,
            passed: false,
            error: failureReason(error),
          });
        }
        await saveReport();
      }
    }),
  );
  await saveReport();
  console.log(`Evaluation report: ${join(root, "report.json")}`);
  if (reports.some((report) => !(report as { passed: boolean }).passed)) process.exitCode = 2;
}

if (process.argv[1]?.endsWith("evaluate-exams.ts"))
  main()
    .catch(() => {
      console.error("Sample evaluation failed.");
      process.exitCode = 1;
    })
    .finally(async () => {
      if (process.argv.includes("--configured") || process.argv.includes("--provider-id"))
        await (await import("../src/server/db/client")).disconnectDatabase();
    });
