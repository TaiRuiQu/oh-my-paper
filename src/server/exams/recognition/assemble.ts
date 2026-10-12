import "server-only";
import type { ContentBlock, DigitalExam } from "@/contracts/exams";
import { regionsEqual } from "@/lib/figure-assets";
import { finalizeExam } from "../assemble";
import { cropRegion } from "../evidence";
import type { PageImage } from "../documents";
import type {
  RecognitionQuestion,
  RecognitionAnnotation,
  RecognitionMetadata,
  RecognitionFigure,
} from "./types";

// Adapt the saved Markdown draft to the editor/grading contract and create its evidence crops.
export async function assembleRecognition({
  exam,
  pages,
  outputDir,
  metadata,
  questions,
  annotations,
  template,
  extractStudentAnswers,
}: {
  exam: DigitalExam;
  pages: PageImage[];
  outputDir: string;
  metadata: RecognitionMetadata;
  questions: Map<string, RecognitionQuestion>;
  annotations: Map<string, RecognitionAnnotation>;
  template?: DigitalExam;
  extractStudentAnswers?: boolean;
}) {
  async function blocks(
    markdown: string,
    figures: RecognitionFigure[],
    role: "question" | "student_answer" = "question",
  ): Promise<ContentBlock[]> {
    const mapped = new Map<string, Extract<ContentBlock, { type: "figure" }>>();
    for (const figure of figures) {
      let asset = exam.assets.find(
        (a) => regionsEqual(a.region, figure.region) && (a.role ?? "question") === role,
      );
      if (!asset) {
        const id = `figure-${exam.assets.length + 1}`,
          key = `figures/${id}.png`;
        await cropRegion(pages, figure.region, outputDir, key);
        asset = {
          id,
          region: figure.region,
          caption: figure.caption,
          contaminated: figure.contaminated,
          evidenceKey: key,
          cleanKey: figure.contaminated ? null : key,
          role,
        };
        exam.assets.push(asset);
      } else if (figure.contaminated) {
        asset.contaminated = true;
        asset.cleanKey = null;
      }
      mapped.set(figure.id, {
        type: "figure",
        caption: figure.caption,
        region: figure.region,
        contaminated: asset.contaminated,
        assetId: asset.id,
      });
    }
    const output: ContentBlock[] = [];
    let cursor = 0;
    for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
      if (match.index > cursor)
        output.push({ type: "text", text: markdown.slice(cursor, match.index) });
      output.push(mapped.get(match[1])!);
      mapped.delete(match[1]);
      cursor = match.index + match[0].length;
    }
    if (cursor < markdown.length) output.push({ type: "text", text: markdown.slice(cursor) });
    // Preserve supplied figures even if the agent omitted their Markdown reference.
    output.push(...mapped.values());
    return output;
  }
  if (!template)
    Object.assign(exam, {
      title: metadata.title,
      subject: metadata.subject,
      grade: metadata.grade,
      instructions: metadata.instructions,
    });
  for (const p of exam.pages)
    p.documentType = metadata.pages.find((i) => i.page === p.page)!.documentType;
  exam.verification.findings.push(...metadata.findings.map((f) => ({ ...f, page: 1 })));
  if (!template) {
    for (const raw of [...questions.values()].sort((a, b) => a.order - b.order)) {
      const id = `q-${exam.questions.length + 1}`,
        crops = [];
      const allMarkdown = [
        raw.markdown,
        ...raw.options.map((o) => o.markdown),
        ...raw.parts.map((p) => p.markdown),
      ].join("\n");
      const referenced = (markdown: string, f: RecognitionFigure) =>
        [...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].some((m) => m[1] === f.id);
      for (const [i, region] of raw.regions.entries()) {
        const crop = await cropRegion(pages, region, outputDir, `questions/${id}-${i + 1}.png`);
        crops.push({ region: crop.region, key: crop.key });
      }
      // The agent produces Markdown. Typed blocks exist only at the legacy editor/grading boundary.
      exam.questions.push({
        id,
        number: raw.number,
        section: raw.section,
        type: raw.type,
        points: raw.points,
        pointsOrigin: raw.pointsOrigin,
        pointsReason: raw.pointsReason,
        regions: raw.regions,
        materialRefs: raw.materialRefs,
        answerTargets: raw.answerTargets,
        crops,
        status: "ready",
        blocks: await blocks(
          raw.markdown,
          raw.figures.filter((f) => referenced(raw.markdown, f) || !referenced(allMarkdown, f)),
        ),
        options: await Promise.all(
          raw.options.map(async (o) => ({
            label: o.label,
            blocks: await blocks(
              o.markdown,
              raw.figures.filter((f) => referenced(o.markdown, f)),
            ),
          })),
        ),
        parts: await Promise.all(
          raw.parts.map(async (p) => ({
            label: p.label,
            parentLabel: p.parentLabel,
            points: p.points,
            blocks: await blocks(
              p.markdown,
              raw.figures.filter((f) => referenced(p.markdown, f)),
            ),
          })),
        ),
      });
      if (raw.pointsOrigin === "inferred")
        exam.verification.findings.push({
          page: raw.regions[0].page,
          severity: "warning",
          code: "points_inferred",
          message: raw.pointsReason,
          questionNumber: raw.number,
        });
      if (
        [
          raw.markdown,
          ...raw.options.map((o) => o.markdown),
          ...raw.parts.map((p) => p.markdown),
        ].some((text) => text.includes("[unreadable]"))
      )
        exam.verification.findings.push({
          page: raw.regions[0].page,
          severity: "warning",
          code: "missing_text",
          message: "部分印刷文字无法辨认，请对照原图核对。",
          questionNumber: raw.number,
        });
    }
    for (const m of metadata.materials)
      exam.materials.push({
        key: m.key,
        title: m.title,
        section: m.section,
        blocks: await blocks(m.markdown, m.figures),
        regions: m.regions,
        continuation: false,
        continuesNextPage: false,
      });
  }
  const responses = [],
    answerCrops = [];
  for (const raw of annotations.values()) {
    const content = await blocks(
      raw.markdown,
      raw.figures,
      raw.kind === "student_answer" ? "student_answer" : "question",
    );
    exam.annotations.push({
      questionNumber: raw.questionNumber,
      section: raw.section,
      partLabel: raw.partLabel,
      kind: raw.kind,
      blocks: content,
      regions: raw.regions,
    });
    if (raw.kind === "student_answer") {
      responses.push({
        sourceId: raw.id,
        questionNumber: raw.questionNumber,
        section: raw.section,
        partLabel: raw.partLabel,
        blocks: content,
        regions: raw.regions,
        blank: !raw.markdown.trim() && !raw.figures.length,
        unreadable: raw.markdown.includes("[unreadable]"),
      });
      for (const [i, region] of raw.regions.entries()) {
        const crop = await cropRegion(
          pages,
          region,
          outputDir,
          `answers/response-${responses.length}-${i + 1}.png`,
        );
        answerCrops.push({ sourceId: raw.id, region: crop.region, key: crop.key });
      }
    }
  }
  if (extractStudentAnswers || template)
    exam.answerDocument = { complete: true, responses, crops: answerCrops, findings: [] };
  if (template)
    for (const q of exam.questions) {
      const matches = responses.filter(
        (r) =>
          r.questionNumber === q.number &&
          (r.section === q.section ||
            (!r.section &&
              exam.questions.filter((other) => other.number === q.number).length === 1)),
      );
      q.regions = matches.flatMap((r) => r.regions);
      if (!q.regions.length) q.regions = [{ page: 1, x: 0, y: 0, width: 1, height: 1 }];
      q.crops = answerCrops
        .filter((c) => matches.some((r) => r.sourceId === c.sourceId))
        .map(({ region, key }) => ({ region, key }));
    }
  if (!template) {
    exam.inventory = {
      title: exam.title,
      subject: exam.subject,
      grade: exam.grade,
      instructions: exam.instructions,
      totalQuestions: exam.questions.length,
      totalPoints: exam.questions.every((q) => q.points !== null)
        ? exam.questions.reduce((s, q) => s + q.points!, 0)
        : null,
      pages: metadata.pages,
      sections: metadata.sections,
      findings: metadata.findings,
      questions: exam.questions.map((q) => ({
        number: q.number,
        section: q.section,
        points: q.points,
        pointsOrigin: q.pointsOrigin as RecognitionQuestion["pointsOrigin"],
        pointsReason: q.pointsReason!,
        pages: [...new Set(q.regions.map((r) => r.page))],
      })),
    };
    finalizeExam(exam, []);
  } else exam.verification.status = exam.verification.findings.length ? "needs_review" : "verified";
}
