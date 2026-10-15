import "server-only";
import { stat } from "node:fs/promises";
import type { z } from "zod";
import type { aiInputSchemas } from "@/contracts/platform-ai";
import type { PlatformState } from "@/contracts/platform";
import { AccessError, RequestError } from "@/server/http/errors";
import { assertCanReview, type Db } from "./access";

export type BatchGradingInput = z.infer<typeof aiInputSchemas.BATCH_GRADE>;

export async function batchGradingContext(db: Db, state: PlatformState, input: BatchGradingInput) {
  const assessment = state.assessments.find((a) => a.id === input.assessmentId);
  const paper = state.papers.find((p) => p.id === input.paperId);
  const classroom = state.classrooms.find((c) => c.id === input.classroomId);
  const config = assessment?.papers.find((p) => p.paperId === input.paperId);
  if (
    !assessment ||
    !paper ||
    !classroom ||
    !config ||
    !assessment.classroomIds.includes(classroom.id)
  )
    throw new AccessError(404, "班级或科目不属于本次安排，或没有批改权限。");
  await assertCanReview(db, state.actor, assessment, classroom.id, config.subject);
  if (assessment.published) throw new RequestError(409, "请先撤回成绩发布，再进行批量批改。");
  if (!classroom.students.length)
    throw new RequestError(400, "请先录入这个班级的学生名册，以便识别作业归属。");
  if (!paper.items.length) throw new RequestError(400, "请先添加题目与批改依据。");
  if (input.studentHints.some((hint) => !classroom.students.some((s) => s.id === hint.studentId)))
    throw new RequestError(400, "确认的学生必须属于所选班级。");
  if (input.assetUrls.length) {
    const ids = input.assetUrls.map((url) => url.split("/").at(-1)!);
    const assets = await db.platformAsset.findMany({
      where: {
        id: { in: ids },
        ...(state.actor.role === "ADMIN" ? {} : { ownerId: state.actor.id }),
      },
      select: { path: true },
    });
    if (assets.length !== ids.length) throw new AccessError(404, "批改材料不存在或无权访问。");
    const sizes = await Promise.all(
      assets.map((asset) => stat(asset.path).then((file) => file.size)),
    );
    if (sizes.reduce((n, size) => n + size, 0) > 150_000_000)
      throw new RequestError(413, "本批扫描页超过 150 MB，请拆分材料后提交。");
  }
  const submissions = state.submissions.filter(
    (s) =>
      s.assessmentId === assessment.id &&
      s.paperId === paper.id &&
      classroom.students.some((student) => student.id === s.studentId),
  );
  const pending = submissions.filter((s) => !state.reviews.some((r) => r.submissionId === s.id));
  if (!input.assetUrls.length && !pending.length)
    throw new RequestError(400, "请上传全班作业，或先录入待批改作答。");
  return { assessment, classroom, paper, config, submissions, pending };
}
