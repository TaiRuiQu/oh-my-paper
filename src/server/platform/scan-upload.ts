import "server-only";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { AccessError, RequestError } from "@/server/http/errors";
import { loadState, executeCommand } from "./service";
import { logError } from "@/server/logger";
import { resolveScanSources } from "./scan-sources";
import { saveImage } from "./assets";
import { cropWorkbook, processCardScan } from "./scan";
import { boxSchema } from "./schemas";
import { cardPageHasHeader } from "./cards";
import type { ScanSubmission, SubmissionAnswer } from "./types";
import { rosterStudentsForPaper } from "@/lib/assessment-roster";
import { getDb } from "@/server/db/client";

const workbookBoxes = z
  .array(boxSchema.safeExtend({ itemId: z.string().min(1) }))
  .min(1)
  .max(500);

export async function uploadScans(actorId: string, form: FormData) {
  const state = await loadState({ id: actorId });
  if (state.actor.role === "STUDENT") throw new AccessError(403, "需要教师权限。");
  const assessmentId = String(form.get("assessmentId") || "");
  const paperId = String(form.get("paperId") || "");
  const assessment = state.assessments.find((assessment) => assessment.id === assessmentId);
  const paper = state.papers.find((paper) => paper.id === paperId);
  if (!assessment || !paper || !assessment.papers.some((entry) => entry.paperId === paperId))
    throw new AccessError(404, "考试科目不存在。");
  if (assessment.published) throw new RequestError(409, "请先撤回发布，再修改答卷。");
  if (await getDb().homeworkAssignment.findUnique({ where: { assessmentId } }))
    throw new RequestError(409, "作业已开放线上收交，请核对学生提交，不能用扫描件替换原始作答。");
  const rosterRevision = Number(form.get("rosterRevision"));
  if (!Number.isInteger(rosterRevision) || rosterRevision < 1)
    throw new RequestError(400, "请携带当前参试名单版本后上传。");
  if (assessment.rosterStatus !== "CONFIRMED")
    throw new RequestError(409, "请先核对并确认本次参试名单。");
  if (rosterRevision !== assessment.rosterRevision)
    throw new RequestError(409, "参试名单已更新，请刷新名单后重新上传。");
  if (!["CARD", "WORKBOOK"].includes(String(form.get("kind"))))
    throw new RequestError(400, "扫描类型无效。");
  const kind = form.get("kind") === "WORKBOOK" ? "WORKBOOK" : "CARD";
  if (assessment.kind === "HOMEWORK" && kind !== "WORKBOOK")
    throw new RequestError(400, "作业必须使用练习册录入。");
  const template = state.templates.find(
    (template) => template.id === form.get("templateId") && template.paperId === paperId,
  );
  if (kind === "CARD" && !template) throw new RequestError(400, "请选择这套试卷的答题卡模板。");
  const students = rosterStudentsForPaper(assessment, paperId);
  const override = String(form.get("studentId") || "");
  if (override && !students.some((student) => student.id === override))
    throw new RequestError(400, "该学生不在本次科目的应考名单中。");
  const files = await resolveScanSources(actorId, form);
  let boxes: z.infer<typeof workbookBoxes> = [];
  if (kind === "WORKBOOK") {
    if (!override) throw new RequestError(400, "练习册扫描需要选择学生。");
    try {
      boxes = workbookBoxes.parse(JSON.parse(String(form.get("boxes") || "[]")));
    } catch {
      throw new RequestError(400, "请为练习册中每一道题框选作答区域。");
    }
    if (
      new Set(boxes.map((box) => box.itemId)).size !== paper.items.length ||
      paper.items.some((item) => boxes.filter((box) => box.itemId === item.id).length > 30) ||
      boxes.some(
        (box) => !paper.items.some((item) => item.id === box.itemId) || box.page > files.length,
      )
    )
      throw new RequestError(400, "练习册作答区域必须完整覆盖每道题，并引用正确页码。");
  }
  const temporary = await mkdtemp(join(tmpdir(), "omp-upload-"));
  const groups = new Map<
    string,
    {
      sourceFiles: string[];
      answers: (SubmissionAnswer & { regionOrder?: number })[];
      alignment: Record<string, unknown>;
      pages: Set<number>;
    }
  >();
  const issues: { file: string; error: string; sourceUrl?: string }[] = [];
  const issueMessage = (error: unknown): string => {
    if (error instanceof RequestError || error instanceof AccessError) return error.message;
    if (
      error instanceof Error &&
      (/^(REGISTRATION_MARKS_|CARD_PAGE_|CARD_TEMPLATE_MISMATCH:)/.test(error.message) ||
        error.message.startsWith("扫描处理失败"))
    )
      return error.message;
    const { errorId } = logError("platform.scan.upload.failed", error, { actorId });
    return `扫描保存失败，请重试或联系管理员（${errorId}）。`;
  };
  try {
    let batchStudentId: string | undefined;
    for (const [index, file] of files.entries()) {
      const page = kind === "CARD" ? (index % template!.layout.pageCount) + 1 : index + 1;
      if (kind === "CARD" && page === 1) batchStudentId = undefined;
      let sourceUrl: string | undefined;
      try {
        const source = file.assetUrl
          ? { url: file.assetUrl, buffer: file.buffer }
          : await saveImage(actorId, file.buffer, file.name);
        sourceUrl = source.url;
        const inputPath = join(temporary, `input-${index}.png`);
        await writeFile(inputPath, source.buffer);
        // Multi-page cards are uploaded in contiguous page order per student.
        const pageRegions = boxes.filter((box) => box.page === page);
        const result =
          kind === "CARD"
            ? await processCardScan({
                inputPath,
                template: template!,
                page,
                outputDir: join(temporary, `result-${index}`),
              })
            : pageRegions.length
              ? await cropWorkbook({
                  inputPath,
                  regions: pageRegions,
                  outputDir: join(temporary, `result-${index}`),
                })
              : {
                  studentNumber: null,
                  answers: [] as SubmissionAnswer[],
                  alignment: { manual: true, corrected: false, uncropped: true },
                  needsReview: false,
                };
        if (
          kind === "WORKBOOK" &&
          (result.answers.length !== pageRegions.length ||
            result.answers.some((answer, i) => answer.itemId !== pageRegions[i].itemId))
        )
          throw new RequestError(422, "本页作答区域裁切不完整，请重新上传。");
        const hasHeader = kind === "CARD" && cardPageHasHeader(template!.layout, page);
        const matches = override
          ? students.filter((student) => student.id === override)
          : kind === "CARD" && !hasHeader
            ? students.filter((student) => student.id === batchStudentId)
            : students.filter(
                (student) => student.studentNumber.padStart(6, "0") === result.studentNumber,
              );
        if (matches.length !== 1)
          throw new RequestError(422, "学号无法唯一匹配。请查看原图，选择学生后重传。");
        const student = matches[0];
        if (kind === "CARD") {
          if (page > 1 && student.id !== batchStudentId)
            throw new RequestError(
              422,
              "同一份答题卡的学生身份不一致，请按每位学生的页码顺序重新上传。",
            );
          batchStudentId = student.id;
        }
        const group = groups.get(student.id) || {
          sourceFiles: [],
          answers: [],
          alignment: {},
          pages: new Set<number>(),
        };
        if (group.pages.has(page))
          throw new RequestError(409, "同一学生出现重复页，请核对批次顺序。");
        group.pages.add(page);
        group.sourceFiles.push(source.url);
        group.alignment[String(page)] = { ...result.alignment, needsReview: result.needsReview };
        for (const [answerIndex, answer] of result.answers.entries()) {
          const images: string[] = [];
          for (const image of answer.images) {
            images.push(
              (
                await saveImage(
                  actorId,
                  await readFile(image),
                  `${student.studentNumber}-${answer.itemId}.png`,
                )
              ).url,
            );
          }
          group.answers.push({
            itemId: answer.itemId,
            text: answer.text,
            images,
            box: answer.box,
            sourcePage: source.url,
            ...(kind === "WORKBOOK"
              ? { regionOrder: boxes.indexOf(pageRegions[answerIndex]) }
              : {}),
          });
        }
        groups.set(student.id, group);
      } catch (error) {
        issues.push({ file: file.name, error: issueMessage(error), sourceUrl });
      }
    }
    const ids: string[] = [];
    for (const [studentId, group] of groups) {
      if (
        (kind === "CARD" && group.pages.size !== template!.layout.pageCount) ||
        (kind === "WORKBOOK" && group.pages.size !== files.length) ||
        group.answers.length !== (kind === "WORKBOOK" ? boxes.length : paper.items.length) ||
        new Set(group.answers.map((answer) => answer.itemId)).size !== paper.items.length
      ) {
        issues.push({
          file: students.find((student) => student.id === studentId)!.name,
          error: "答卷页数或题目区域不完整，请按每位学生的页码顺序重新上传。",
        });
        continue;
      }
      const existing = state.submissions.find(
        (submission) =>
          submission.assessmentId === assessmentId &&
          submission.paperId === paperId &&
          submission.studentId === studentId,
      );
      const submission: Pick<
        ScanSubmission,
        "assessmentId" | "paperId" | "studentId" | "kind" | "sourceFiles" | "answers" | "alignment"
      > & { id?: string; templateId?: string; rosterRevision: number } = {
        ...(existing ? { id: existing.id } : {}),
        assessmentId,
        rosterRevision,
        paperId,
        studentId,
        kind,
        sourceFiles: group.sourceFiles,
        answers:
          kind === "WORKBOOK"
            ? paper.items.map((item) => {
                const fragments = group.answers
                  .filter((answer) => answer.itemId === item.id)
                  .sort((a, b) => a.regionOrder! - b.regionOrder!);
                return {
                  itemId: item.id,
                  text: fragments
                    .map((answer) => answer.text)
                    .filter(Boolean)
                    .join("\n"),
                  images: fragments.flatMap((answer) => answer.images),
                  box: fragments[0].box,
                  sourcePage: fragments[0].sourcePage,
                };
              })
            : group.answers,
        alignment:
          kind === "WORKBOOK" ? { ...group.alignment, workbookRegions: boxes } : group.alignment,
        ...(template ? { templateId: template.id } : {}),
      };
      try {
        ids.push(
          (await executeCommand({ id: actorId }, { type: "submission.save", submission })).id,
        );
      } catch (error) {
        issues.push({
          file: students.find((student) => student.id === studentId)!.name,
          error: issueMessage(error),
          sourceUrl: group.sourceFiles[0],
        });
      }
    }
    return { ids, imported: ids.length, issues };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
