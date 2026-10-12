import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnvironment } from "./load-env.mjs";
import { defaultSubmissions } from "../src/lib/grading-defaults";
import type { DigitalExam } from "../src/contracts/exams";
import type { GradeSubmission, GradeTaskDetail } from "../src/contracts/grading";

loadEnvironment();
const keep = process.argv.includes("--keep");

async function main() {
  const { getDb, disconnectDatabase } = await import("../src/server/db/client");
  const { getStoragePaths } = await import("../src/server/config/env");
  const temporary = join(getStoragePaths().temp, "exam-web-test");
  const fixture = JSON.parse(await readFile(join(temporary, "report.json"), "utf8"));
  const { cookies } = JSON.parse(await readFile(join(temporary, "admin-state.json"), "utf8"));
  const adminCookie = cookies.map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join("; ");
  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000", origin = new URL(base).origin;
  const previous = await getDb().aiSetting.findUnique({ where: { id: "grading" } });
  const gradeIds: string[] = []; let providerId: string | undefined; let otherUserId: string | undefined; let retained = false;
  async function request(path: string, cookie = adminCookie, init: RequestInit = {}) {
    return fetch(new URL(path, base), { ...init, headers: { Origin: origin, Cookie: cookie, ...init.headers }, signal: AbortSignal.timeout(60_000), redirect: "manual" });
  }
  const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  async function wait(id: string) {
    const deadline = Date.now() + 8 * 60_000; let detail: GradeTaskDetail | undefined; let phase = "";
    while (Date.now() < deadline) {
      const response = await request(`/api/grades/${id}`); assert.equal(response.status, 200);
      detail = await response.json();
      if (detail!.task.phase !== phase) { phase = detail!.task.phase; console.log(`Grading phase: ${phase}, ${detail!.task.progress}/${detail!.task.total}.`); }
      if (["COMPLETED", "FAILED"].includes(detail!.task.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    assert.equal(detail?.task.status, "COMPLETED", "grading worker completes"); assert.ok(detail?.result);
    await writeFile(join(temporary, `${id}.grading.json`), JSON.stringify(detail, null, 2), { mode: 0o600 });
    return detail!;
  }
  try {
    assert.ok(process.env.DEEPSEEK_API_KEY && !process.env.DEEPSEEK_API_KEY.startsWith("REPLACE_"));
    const source = await (await request(`/api/exams/${fixture.taskId}`)).json(); const exam = source.exam as DigitalExam;
    assert.equal(exam.questions.length, 2, "use the live synthetic two-question exam fixture");
    const setupPage = await request(`/exams/${fixture.taskId}/grade`);
    assert.equal(setupPage.status, 200, "grading setup SSR renders math data");
    assert.ok(!(await setupPage.text()).includes("暂时无法打开页面"), "grading setup has no RSC boundary failure");
    const profile = { name: "DeepSeek 批改实测（临时）", apiType: "openai_responses", baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY, model: "deepseek-flash", promptPreset: "deepseek", maxOutputTokens: 12000, timeoutSeconds: 240 };
    const create = await request("/api/admin/ai/providers", adminCookie, { method: "POST", ...json(profile) }); assert.equal(create.status, 201);
    providerId = (await create.json()).id;
    assert.equal((await request(`/api/admin/ai/providers/${providerId}/activate`, adminCookie, { method: "POST", ...json({ purpose: "grading" }) })).status, 200);
    const signup = await request("/api/auth/sign-up/email", "", { method: "POST", ...json({ name: "批改隔离测试", email: `grading-${randomUUID()}@example.com`, password: `Grading-${randomUUID()}` }) });
    assert.equal(signup.status, 200); otherUserId = (await signup.json()).user.id;
    const otherCookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const submissions: GradeSubmission[] = defaultSubmissions(exam).map((s, index) => ({ ...s,
      answer: index === 0 ? "4" : "B", referenceAnswer: index === 0 ? "5" : "B", maxPoints: 5, unreadable: false, questionConfirmed: true,
      rubric: index === 0 ? "结果为5得5分，其他结果0分。" : "选择B得5分，其他选择0分；不设部分分。" }));
    assert.equal((await request(`/api/exams/${fixture.taskId}/grades`, otherCookie, { method: "POST", ...json({ submissions }) })).status, 404);
    assert.equal((await request(`/api/exams/${fixture.taskId}/grades`, adminCookie, { method: "POST", ...json({ submissions: [{ ...submissions[0], questionId: "foreign-question" }] }) })).status, 400);
    const parallel = await Promise.all([1, 2].map(() => request(`/api/exams/${fixture.taskId}/grades`, adminCookie, { method: "POST", ...json({ submissions }) })));
    assert.deepEqual(parallel.map((r) => r.status).sort(), [202, 409], "concurrent submissions do not duplicate active grading");
    const primaryId = (await parallel.find((r) => r.status === 202)!.json()).task.id as string; gradeIds.push(primaryId);
    assert.equal((await request(`/api/grades/${primaryId}`, otherCookie)).status, 404);
    assert.equal((await request(`/api/grades/${primaryId}/download`, otherCookie)).status, 404);
    const primary = await wait(primaryId);
    const reportPage = await request(`/grades/${primaryId}`);
    assert.equal(reportPage.status, 200, "grading report SSR renders math data");
    assert.ok(!(await reportPage.text()).includes("暂时无法打开页面"), "grading report has no RSC boundary failure");
    assert.equal(primary.result!.questions[0].score, 0, "wrong arithmetic earns zero");
    assert.equal(primary.result!.questions[1].score, 5, "correct choice earns full marks");
    assert.equal(primary.result!.totals.awardedPoints, 5); assert.equal(primary.result!.totals.gradedMaxPoints, 10); assert.equal(primary.result!.totals.pendingQuestions, 0);
    assert.equal((await request(`/api/grades/${primaryId}/download?format=markdown`)).status, 200);
    assert.equal((await request(`/api/grades/${primaryId}/source/1`)).status, 200);
    assert.equal((await request(`/api/grades/${primaryId}/source/1`, otherCookie)).status, 404);
    const review = { questionId: submissions[1].questionId, score: 5, maxPoints: 5, note: "已人工核对选择题与参考答案。" };
    assert.equal((await request(`/api/grades/${primaryId}`, otherCookie, { method: "PATCH", ...json(review) })).status, 404);
    assert.equal((await request(`/api/grades/${primaryId}`, adminCookie, { method: "PATCH", ...json({ ...review, score: 6 }) })).status, 400);
    assert.equal((await request(`/api/grades/${primaryId}`, adminCookie, { method: "PATCH", ...json(review) })).status, 200);
    const provisionalSubmission = { ...submissions[0], referenceAnswer: "", rubric: "" };
    const provisionalRequest = await request(`/api/exams/${fixture.taskId}/grades`, adminCookie, { method: "POST", ...json({ submissions: [provisionalSubmission] }) }); assert.equal(provisionalRequest.status, 202);
    const provisionalId = (await provisionalRequest.json()).task.id as string; gradeIds.push(provisionalId);
    const provisional = await wait(provisionalId);
    assert.equal(provisional.result!.questions[0].referenceOrigin, "model");
    assert.equal(provisional.result!.questions[0].needsReview, true); assert.equal(provisional.result!.questions[0].score, null);
    assert.equal(provisional.result!.questions[0].suggestedScore, 0); assert.equal(provisional.result!.totals.gradedMaxPoints, 0);
    const confirmation = { questionId: submissions[0].questionId, score: 0, maxPoints: 5, note: "已独立确认2+3=5，学生作答4不正确。" };
    assert.equal((await request(`/api/grades/${provisionalId}`, adminCookie, { method: "PATCH", ...json(confirmation) })).status, 200);
    const confirmed = await (await request(`/api/grades/${provisionalId}`)).json();
    assert.equal(confirmed.result.totals.pendingQuestions, 0); assert.equal(confirmed.result.totals.gradedMaxPoints, 5);
    assert.equal(confirmed.result.questions[0].reviewHistory.length, 1);
    const report = { primaryId, provisionalId, providerId, gradeIds, previousProviderId: previous?.providerId ?? null,
      primary: { total: primary.result!.totals, usage: primary.result!.usage }, provisional: { totalBeforeReview: provisional.result!.totals, usage: provisional.result!.usage } };
    await writeFile(join(temporary, "grading-report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
    // After proving the review API, retain the pre-review snapshot for browser
    // interaction testing. This touches only this script's own fixture record.
    if (keep) await getDb().gradeTask.updateMany({ where: { id: provisionalId, examTaskId: fixture.taskId }, data: { result: JSON.parse(JSON.stringify(provisional.result)) } });
    console.log(JSON.stringify({ passed: true, suppliedReferenceScore: "5/10", independentReferenceReview: true, primaryUsage: primary.result!.usage, independentUsage: provisional.result!.usage }));
    retained = keep;
  } finally {
    if (!retained) {
      if (providerId) await getDb().aiSetting.updateMany({ where: { id: "grading", providerId }, data: { providerId: previous?.providerId ?? null } });
      if (providerId) await getDb().aiProvider.deleteMany({ where: { id: providerId } });
      await getDb().gradeTask.deleteMany({ where: { id: { in: gradeIds } } });
    }
    if (otherUserId) await getDb().user.deleteMany({ where: { id: otherUserId } });
    await disconnectDatabase();
  }
}

async function cleanup() {
  const { getDb, disconnectDatabase } = await import("../src/server/db/client");
  const { getStoragePaths } = await import("../src/server/config/env");
  const report = JSON.parse(await readFile(join(getStoragePaths().temp, "exam-web-test", "grading-report.json"), "utf8"));
  try {
    await getDb().aiSetting.updateMany({ where: { id: "grading", providerId: report.providerId }, data: { providerId: report.previousProviderId } });
    await getDb().aiProvider.deleteMany({ where: { id: report.providerId } });
    await getDb().gradeTask.deleteMany({ where: { id: { in: report.gradeIds } } });
    console.log("Grading browser fixtures cleaned up.");
  } finally { await disconnectDatabase(); }
}

(process.argv.includes("--cleanup") ? cleanup() : main()).catch((error: unknown) => {
  const message = error instanceof assert.AssertionError ? `Grading assertion failed: ${error.message}` : "Grading integration failed. Run test:exam-web --live --keep first and ensure the worker is running.";
  console.error(process.env.DEEPSEEK_API_KEY ? message.replaceAll(process.env.DEEPSEEK_API_KEY, "[redacted]") : message);
  process.exitCode = 1;
});
