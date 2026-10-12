import "server-only";
import { cp, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { z } from "zod";
import type { examEditSchema } from "@/contracts/exam-edits";
import { getDb } from "@/server/db/client";
import { ownedExamTask, taskResult, taskDirectory } from "./tasks";
import { exportExamMarkdown } from "./export";
import { RequestError } from "@/server/http/errors";
import { solutionIssues } from "./solutions";
import { regionsEqual } from "@/lib/figure-assets";
export async function editQuestion(
  userId: string,
  id: string,
  input: z.infer<typeof examEditSchema>,
) {
  const task = await ownedExamTask(userId, id),
    exam = await taskResult(task);
  if (!exam || task.outputKey !== input.outputKey)
    throw new RequestError(409, "识别结果已更新，请刷新页面后再修改。");
  const question = exam.questions.find((q) => q.id === input.questionId);
  if (!question) throw new RequestError(422, "试卷中没有这道题。");
  for (const b of input.blocks)
    if (
      b.type === "figure" &&
      !question.blocks.some(
        (old) =>
          old.type === "figure" &&
          regionsEqual(old.region, b.region) &&
          old.caption === b.caption &&
          old.contaminated === b.contaminated &&
          old.assetId === b.assetId,
      )
    )
      throw new RequestError(422, "配图请保留原图证据。");
  const outputKey = randomUUID(),
    directory = join(taskDirectory(id), outputKey);
  await cp(join(taskDirectory(id), task.outputKey), directory, { recursive: true });
  try {
    const changed =
      JSON.stringify(question.blocks) !== JSON.stringify(input.blocks) ||
      question.points !== input.points;
    if (input.solution) {
      if (input.solution.sufficient && !input.solution.answer.trim())
        throw new RequestError(422, "请填写标准答案。");
      if (
        input.solution.selectedOptions.some(
          (label) => !question.options.some((o) => o.label === label),
        )
      )
        throw new RequestError(422, "标准答案中的选项不存在。");
      const solution = { ...input.solution, model: "teacher", origin: "teacher" as const };
      const issues = solutionIssues(question, solution);
      if (solution.sufficient && issues.length) throw new RequestError(422, issues.join(" "));
      question.solution = solution;
      exam.verification.findings = exam.verification.findings.filter(
        (f) =>
          !(
            f.code === "solution_unavailable" &&
            f.questionNumber === question.number &&
            question.regions.some((r) => r.page === f.page)
          ),
      );
    } else if (changed && question.solution) {
      question.solution = {
        ...question.solution,
        sufficient: false,
        issues: ["题目已修改，请重新核对并保存标准答案。"],
      };
    }
    question.blocks = input.blocks;
    if (question.points !== input.points) {
      question.pointsOrigin = "teacher";
      question.pointsReason = "用户已修改分值。";
    }
    question.points = input.points;
    if (input.confirmed) question.status = "ready";
    exam.verification.corrections.push({
      page: question.regions[0].page,
      changes: [`用户已修正第 ${question.number} 题（${new Date().toISOString()}）。`],
    });
    await writeFile(join(directory, "exam.json"), JSON.stringify(exam, null, 2), { mode: 0o600 });
    await writeFile(join(directory, "exam.md"), exportExamMarkdown(exam), { mode: 0o600 });
    await writeFile(
      join(directory, "verification.json"),
      JSON.stringify(exam.verification, null, 2),
      { mode: 0o600 },
    );
    if (
      !(
        await getDb().examTask.updateMany({
          where: { id, userId, status: "COMPLETED", outputKey: task.outputKey },
          data: { outputKey },
        })
      ).count
    )
      throw new RequestError(409, "试卷已更新，请刷新页面。此次修改未覆盖新版本。");
  } catch (e) {
    await rm(directory, { recursive: true, force: true });
    throw e;
  }
}
