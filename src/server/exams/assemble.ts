import type {
  ContentBlock,
  DigitalExam,
  ExamQuestion,
  ParsedPage,
  QuestionFragment,
} from "@/contracts/exams";
import { findFigureAsset } from "@/lib/figure-assets";

function blocksQuestionContent(code: string, severity: "warning" | "error") {
  // Scores and optional blank workspace do not alter the digital question's
  // text/image readiness. Keep their notices visible for scoring corrections.
  if (
    /points|score|missing_answer_space/i.test(code) ||
    ["solution_unavailable", "reference_extraction_failed"].includes(code)
  )
    return false;
  return (
    severity === "error" ||
    /missing|incomplete|clipped|uncertain|overflow|ambiguous|conflict/i.test(code)
  );
}

function appendBlocks(target: ContentBlock[], incoming: ContentBlock[]) {
  const seen = new Set(target.map((block) => JSON.stringify(block)));
  for (const block of incoming)
    if (!seen.has(JSON.stringify(block))) {
      target.push(block);
      seen.add(JSON.stringify(block));
    }
}

export function appendParsedPage(exam: DigitalExam, page: ParsedPage, pageNumber: number) {
  exam.title ??= page.title;
  exam.subject ??= page.subject;
  exam.grade ??= page.grade;
  exam.instructions = [...new Set([...exam.instructions, ...page.instructions])];
  exam.annotations.push(...page.annotations);
  exam.verification.findings.push(
    ...page.findings.map((finding) => ({ ...finding, page: pageNumber })),
  );
  for (const material of page.materials) {
    const prior = exam.materials.find(
      (item) => item.key === material.key && item.section === material.section,
    );
    if (prior && material.continuation) {
      appendBlocks(prior.blocks, material.blocks);
      prior.regions.push(...material.regions);
      prior.continuesNextPage = material.continuesNextPage;
    } else if (prior) {
      exam.verification.findings.push({
        page: pageNumber,
        severity: "error",
        code: "duplicate_material",
        message: `Repeated material key ${material.key} requires review.`,
        questionNumber: null,
      });
      exam.materials.push(material);
    } else exam.materials.push(material);
  }
  for (const fragment of page.questions) {
    normalizeTabularOptions(fragment);
    const matches = exam.questions.filter(
      (question) => question.number === fragment.number && question.section === fragment.section,
    );
    const prior = matches.at(-1);
    if (prior && fragment.continuation) {
      appendBlocks(prior.blocks, fragment.blocks);
      prior.regions.push(...fragment.regions);
      prior.materialRefs = [...new Set([...prior.materialRefs, ...fragment.materialRefs])];
      prior.points ??= fragment.points;
      for (const option of fragment.options) {
        const existing = prior.options.find((item) => item.label === option.label);
        if (existing) appendBlocks(existing.blocks, option.blocks);
        else prior.options.push(option);
      }
      for (const part of fragment.parts) {
        const existing = prior.parts.find(
          (item) => item.label === part.label && item.parentLabel === part.parentLabel,
        );
        if (existing) {
          appendBlocks(existing.blocks, part.blocks);
          existing.points ??= part.points;
        } else prior.parts.push(part);
      }
    } else {
      if (prior || fragment.continuation)
        exam.verification.findings.push({
          page: pageNumber,
          severity: "error",
          code: prior ? "duplicate_question" : "orphan_continuation",
          message: prior
            ? `Repeated question ${fragment.number} in section ${fragment.section}.`
            : `Question ${fragment.number} begins before the available pages.`,
          questionNumber: fragment.number,
        });
      const { continuation: _continuation, continuesNextPage: _continues, ...question } = fragment;
      void _continuation;
      void _continues;
      exam.questions.push({ ...question, id: `q-${exam.questions.length + 1}`, status: "ready" });
    }
  }
}

export function normalizeTabularOptions(
  question: Pick<QuestionFragment, "type" | "blocks" | "options">,
) {
  if (question.options.length || !["single_choice", "multiple_choice"].includes(question.type))
    return;
  const index = question.blocks.findIndex(
    (block) =>
      block.type === "table" &&
      block.rows.length >= 3 &&
      /选项|option/i.test(block.rows[0]?.[0] ?? "") &&
      block.rows.slice(1).every((row) => row.length > 1 && /^[A-H][.、．]?$/.test(row[0].trim())),
  );
  if (index < 0) return;
  const table = question.blocks[index];
  if (table.type !== "table") return;
  question.options = table.rows.slice(1).map((row) => ({
    label: row[0].trim().replace(/[.、．]$/, ""),
    blocks: [{ type: "table", rows: [table.rows[0].slice(1), row.slice(1)] }],
  }));
  question.blocks.splice(index, 1);
}

export function finalizeExam(
  exam: DigitalExam,
  unfinished: { number: string; section: string; page: number }[],
) {
  for (const item of unfinished) {
    exam.verification.findings.push({
      page: item.page,
      severity: "error",
      code: "incomplete_question",
      message: `Question ${item.number} continues beyond the available content.`,
      questionNumber: item.number,
    });
  }
  for (const material of exam.materials)
    if (material.continuesNextPage) {
      exam.verification.findings.push({
        page: material.regions.at(-1)!.page,
        severity: "error",
        code: "incomplete_material",
        message: `Shared material ${material.key} is incomplete.`,
        questionNumber: null,
      });
    }
  for (const question of exam.questions) {
    for (const ref of question.materialRefs)
      if (!exam.materials.some((material) => material.key === ref)) {
        exam.verification.findings.push({
          page: question.regions[0].page,
          severity: "error",
          code: "missing_material",
          message: `Question ${question.number} references missing material ${ref}.`,
          questionNumber: question.number,
        });
      }
    if (!question.blocks.length && !question.parts.length && !question.materialRefs.length) {
      exam.verification.findings.push({
        page: question.regions[0].page,
        severity: "error",
        code: "empty_question",
        message: `Question ${question.number} has no question content.`,
        questionNumber: question.number,
      });
    }
    if (
      ["single_choice", "multiple_choice"].includes(question.type) &&
      question.options.length < 2
    ) {
      exam.verification.findings.push({
        page: question.regions[0].page,
        severity: "error",
        code: "missing_options",
        message: `Choice question ${question.number} has fewer than two options.`,
        questionNumber: question.number,
      });
    }
    if (new Set(question.options.map((option) => option.label)).size !== question.options.length) {
      exam.verification.findings.push({
        page: question.regions[0].page,
        severity: "error",
        code: "duplicate_options",
        message: `Question ${question.number} has repeated option labels.`,
        questionNumber: question.number,
      });
    }
    if (
      question.regions.some(
        (region) => exam.pages.find((page) => page.page === region.page)?.status !== "verified",
      ) ||
      exam.verification.findings.some(
        (finding) =>
          blocksQuestionContent(finding.code, finding.severity) &&
          question.regions.some((region) => region.page === finding.page) &&
          (finding.questionNumber === null || finding.questionNumber === question.number),
      )
    )
      question.status = "needs_review";
  }
  // Image cleanliness is part of question readiness, even if the text is legible.
  for (const question of exam.questions) {
    const blocks = [
      ...allQuestionBlocks(question),
      ...exam.materials
        .filter((material) => question.materialRefs.includes(material.key))
        .flatMap((material) => material.blocks),
    ];
    if (
      blocks.some(
        (block) =>
          block.type === "figure" &&
          (block.contaminated || !findFigureAsset(exam.assets, block, "question")?.cleanKey),
      )
    )
      question.status = "needs_review";
  }
  for (const page of exam.pages)
    if (
      page.status === "verified" &&
      exam.verification.findings.some(
        (finding) =>
          finding.page === page.page &&
          finding.questionNumber === null &&
          blocksQuestionContent(finding.code, finding.severity),
      )
    ) {
      page.status = "needs_review";
    }
  exam.verification.status = exam.pages.some((page) => page.status === "failed")
    ? "partial"
    : exam.verification.findings.length ||
        exam.questions.some((question) => question.status === "needs_review")
      ? "needs_review"
      : "verified";
}

export function allQuestionBlocks(question: ExamQuestion): ContentBlock[] {
  return [
    ...question.blocks,
    ...question.options.flatMap((option) => option.blocks),
    ...question.parts.flatMap((part) => part.blocks),
  ];
}
