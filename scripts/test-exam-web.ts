import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { loadEnvironment } from "./load-env.mjs";

loadEnvironment();
const live = process.argv.includes("--live");
const keep = process.argv.includes("--keep");
const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const origin = new URL(base).origin;

export async function createTestExamImage() {
  // Synthetic content with deliberately wrong and right student answers.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1000"><rect width="1200" height="1000" fill="white"/><g font-family="Noto Sans CJK SC" fill="#111" font-size="32"><text x="80" y="100">数学测试卷（合成测试资料）</text><text x="80" y="160">一、计算与选择题</text><text x="80" y="250">1. 计算：2 + 3 = ____。（5分）</text><text x="100" y="320" fill="#234a9f">学生作答：4</text><text x="80" y="430">2. 下列数中，哪一个是偶数？（5分）</text><text x="100" y="500">A. 3     B. 4     C. 5     D. 7</text><text x="100" y="570" fill="#234a9f">学生作答：B</text><text x="80" y="730">请保留原题，不要将学生答案填入题干。</text></g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  const { getDb, disconnectDatabase } = await import("../src/server/db/client");
  const { getStoragePaths } = await import("../src/server/config/env");
  const { taskDirectory } = await import("../src/server/exams/tasks");
  const users: string[] = [],
    providers: string[] = [],
    tasks: string[] = [],
    classrooms: string[] = [],
    calls: string[] = [];
  let retained = false;
  const previous = await getDb().aiSetting.findUnique({
    where: { id: "exam" },
  });
  const previousGrading = await getDb().aiSetting.findUnique({
    where: { id: "grading" },
  });
  const region = { page: 1, x: 0.06, y: 0.2, width: 0.8, height: 0.16 };
  const sample = {
    documentType: "question_paper",
    title: "合成测试卷",
    subject: "数学",
    grade: null,
    instructions: [],
    materials: [],
    findings: [],
    questions: [
      {
        number: "1",
        section: "一、计算与选择题",
        type: "fill_blank",
        continuation: false,
        continuesNextPage: false,
        points: 5,
        blocks: [{ type: "text", text: "计算：2 + 3 = ____。" }],
        options: [],
        parts: [],
        materialRefs: [],
        regions: [region],
      },
    ],
    annotations: [
      {
        questionNumber: "1",
        section: "一、计算与选择题",
        partLabel: null,
        kind: "student_answer",
        blocks: [{ type: "text", text: "4" }],
        regions: [region],
      },
    ],
  };
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    const name = input.text?.format?.name;
    calls.push(name);
    const output =
      name === "vision_connection_test"
        ? { color: "red" }
        : name === "exam_orientation"
          ? { clockwiseDegrees: "0" }
          : name === "exam_inventory"
            ? {
                title: sample.title,
                subject: sample.subject,
                grade: null,
                instructions: [],
                totalQuestions: 1, totalPoints: 5,
                pages: [{ page: 1, documentType: "question_paper" }],
                sections: [{ title: "一、计算与选择题", points: 5 }],
                questions: [
                  {
                    number: "1",
                    section: "一、计算与选择题",
                    points: 5,
                    pages: [1], pointsOrigin: "printed", pointsReason: "printed",
                  },
                ],
                findings: [],
              }
            : name === "exam_question_bounds"
              ? { regions: [region], figures: [], findings: [] }
            : name === "exam_question_transcription"
              ? { type: "fill_blank", blocks: sample.questions[0].blocks, options: [], parts: [], answerTargets: [{ key:"main",partLabel:null,parentLabel:null,blankIndex:1 }], findings: [] }
            : name === "exam_answer_layout"
              ? { pages:[{page:1,documentType:"answer_sheet"}],responses:[{id:"a1",questionNumber:"1",section:"一、计算与选择题",regions:[region]}],findings:[] }
            : name === "exam_answer_transcription"
              ? { responses:[{sourceId:"a1",questionNumber:"1",section:"一、计算与选择题",partLabel:null,blocks:[{type:"text",text:"4"},{type:"figure",caption:"手写作答证据",region,contaminated:true}],blank:false,unreadable:false}],findings:[] }
            : name === "exam_solution"
              ? {
                  answer: "5",
                  selectedOptions: [],
                  explanation: "2+3=5。",
                  rubric: "结果为5得5分，其他结果0分。",
                  sufficient: true,
                  issues: [],
                  units: [{ targetKey:"main",answer:"5",selectedOptions:[],explanation:"2+3=5。" }],
                }
              : name === "exam_grade_question"
                ? {
                    matchedSourceIds:["a1"],studentAnswer:"4",studentAnswerBlocks:[{type:"text",text:"4"},{type:"figure",caption:"手写作答证据",region,contaminated:true,assetId:"figure-1"}],answerStatus:"answered",
                    verdict: "incorrect",
                    score: 0,
                    feedback: "2+3=5，学生作答4错误。",
                    criteria: [
                      {
                        description: "计算结果",
                        maxPoints: 5,
                        awardedPoints: 0,
                        explanation: "正确结果为5",
                      },
                    ],
                    needsReview: false,
                    issues: [],
                  }
                : sample;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "fixture",
        object: "response",
        created_at: 1,
        model: "fixture-vision",
        status: "completed",
        output: [
          {
            type: "message",
            id: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify(output),
                annotations: [],
              },
            ],
          },
        ],
        usage: {
          input_tokens: 12,
          output_tokens: 8,
          total_tokens: 20,
          input_tokens_details: { cached_tokens: 4 },
        },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const temporary = join(getStoragePaths().temp, "exam-web-test");
  await mkdir(temporary, { recursive: true, mode: 0o700 });

  async function request(path: string, cookie = "", init: RequestInit = {}) {
    return fetch(new URL(path, base), {
      ...init,
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(60_000),
      redirect: "manual",
    });
  }
  const json = (body: unknown): RequestInit => ({
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  async function account(label: string) {
    const response = await request("/api/auth/sign-up/email", "", {
      method: "POST",
      ...json({
        name: label,
        email: `exam-test-${randomUUID()}@example.com`,
        password: `Exam-${randomUUID()}`,
      }),
    });
    assert.equal(response.status, 200, "test registration");
    const data = await response.json();
    users.push(data.user.id);
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    return { id: data.user.id as string, cookie };
  }
  try {
    const admin = await account("识别功能测试管理员"),
      other = await account("隔离测试用户");
    assert.equal(
      (await request("/api/admin/ai/providers", admin.cookie)).status,
      403,
    );
    await getDb().user.update({
      where: { id: admin.id },
      data: { role: "ADMIN" },
    });
    const apiKey = live
      ? process.env.DEEPSEEK_API_KEY
      : "fixture-secret-api-key";
    assert.ok(apiKey && !apiKey.startsWith("REPLACE_"), "live key configured");
    const input = {
      name: live ? "DeepSeek 实测（临时）" : "测试提供商（临时）",
      apiType: "openai_responses",
      apiKey,
      baseURL: live
        ? (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com")
        : `http://127.0.0.1:${address.port}`,
      model: live ? "deepseek-flash" : "fixture-vision",
      promptPreset: "deepseek",
      maxOutputTokens: 16000,
      timeoutSeconds: 240,
      maxConcurrency: 2,
    };
    assert.equal(
      (
        await request("/api/admin/ai/providers", other.cookie, {
          method: "POST",
          ...json(input),
        })
      ).status,
      403,
    );
    const create = await request("/api/admin/ai/providers", admin.cookie, {
      method: "POST",
      ...json(input),
    });
    assert.equal(create.status, 201);
    const { id: providerId } = await create.json();
    providers.push(providerId);
    const stored = await getDb().aiProvider.findUniqueOrThrow({
      where: { id: providerId },
    });
    assert.notEqual(stored.encryptedApiKey, apiKey);
    assert.equal(stored.maxConcurrency, 2, "provider concurrency persisted");
    const listing = await (
      await request("/api/admin/ai/providers", admin.cookie)
    ).text();
    assert.ok(
      JSON.parse(listing).providers.some(
        (p: { id: string; maxConcurrency: number }) =>
          p.id === providerId && p.maxConcurrency === 2,
      ),
      "provider listing exposes concurrency",
    );
    assert.ok(!listing.includes(apiKey));
    assert.ok(!listing.includes(stored.encryptedApiKey));
    assert.equal(
      (
        await request(`/api/admin/ai/providers/${providerId}`, admin.cookie, {
          method: "PATCH",
          ...json({ ...input, apiKey: "" }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await getDb().aiProvider.findUniqueOrThrow({
          where: { id: providerId },
        })
      ).maxConcurrency,
      2,
      "editing preserves concurrency",
    );
    assert.equal(
      (
        await getDb().aiProvider.findUniqueOrThrow({
          where: { id: providerId },
        })
      ).encryptedApiKey,
      stored.encryptedApiKey,
    );
    assert.equal(
      (
        await request(
          `/api/admin/ai/providers/${providerId}/activate`,
          admin.cookie,
          { method: "POST", headers: { Origin: "https://evil.test" } },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          `/api/admin/ai/providers/${providerId}/activate`,
          admin.cookie,
          { method: "POST" },
        )
      ).status,
      200,
    );
    const test = await request("/api/admin/ai/test", admin.cookie, {
      method: "POST",
      ...json({ ...input, apiKey: "", id: providerId }),
    });
    assert.equal(test.status, 200, "vision connection test");
    const invalid = new FormData();
    invalid.append(
      "files",
      new Blob(["invalid"], { type: "image/png" }),
      "fake.png",
    );
    assert.equal(
      (
        await request("/api/exams", admin.cookie, {
          method: "POST",
          body: invalid,
        })
      ).status,
      422,
    );
    const brokenUpload = new FormData();
    brokenUpload.append(
      "files",
      new Blob(["%PDF-1.7\nDeliberately broken test fixture\n%%EOF"], {
        type: "application/pdf",
      }),
      "broken-first.pdf",
    );
    const brokenResponse = await request("/api/exams", admin.cookie, {
      method: "POST",
      body: brokenUpload,
    });
    assert.equal(brokenResponse.status, 202);
    const brokenId = (await brokenResponse.json()).task.id;
    tasks.push(brokenId);
    let brokenStatus = "";
    for (let i = 0; i < 30; i++) {
      brokenStatus = (
        await (await request(`/api/exams/${brokenId}`, admin.cookie)).json()
      ).task.status;
      if (brokenStatus === "FAILED") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(
      brokenStatus,
      "FAILED",
      "the first task fails without stopping its consumer",
    );
    const image = await createTestExamImage();
    await writeFile(join(temporary, "synthetic-exam.png"), image, {
      mode: 0o600,
    });
    const upload = new FormData();
    upload.append(
      "files",
      new Blob([new Uint8Array(image)], { type: "image/png" }),
      "合成数学试卷.png",
    );
    const submitted = await request("/api/exams", admin.cookie, {
      method: "POST",
      body: upload,
    });
    assert.equal(submitted.status, 202);
    const { task } = await submitted.json();
    tasks.push(task.id);
    const snapshot = (
      await getDb().examTask.findUniqueOrThrow({ where: { id: task.id } })
    ).providerSnapshot as { maxConcurrency: number; providerId: string };
    assert.equal(
      snapshot.maxConcurrency,
      2,
      "task retains provider concurrency snapshot",
    );
    assert.equal(snapshot.providerId, providerId);
    console.log(
      `Submitted ${live ? "live DeepSeek" : "fixture"} exam; checking persistent worker progress.`,
    );
    assert.equal(
      (await request(`/api/exams/${task.id}`, other.cookie)).status,
      404,
    );
    assert.equal(
      (
        await request(`/api/exams/${task.id}/retry`, other.cookie, {
          method: "POST",
        })
      ).status,
      404,
    );
    const deadline = Date.now() + 10 * 60_000;
    let result;
    let phase = "";
    while (Date.now() < deadline) {
      const response = await request(`/api/exams/${task.id}`, admin.cookie);
      assert.equal(response.status, 200);
      result = await response.json();
      if (result.task.phase !== phase) {
        phase = result.task.phase;
        console.log(`Exam phase: ${phase}.`);
      }
      if (["COMPLETED", "FAILED"].includes(result.task.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    assert.equal(
      result?.task.status,
      "COMPLETED",
      "background parsing completes",
    );
    assert.ok(result.exam.questions.length > 0);
    assert.ok(result.exam.verification.promptVersion.includes("crop-agents"));
    assert.equal(
      (await request(`/api/exams/${task.id}/files/exam.json`, other.cookie))
        .status,
      404,
    );
    assert.equal(
      (
        await request(
          `/api/exams/${task.id}/files/checkpoints/1.json`,
          admin.cookie,
        )
      ).status,
      404,
    );
    assert.equal(
      (await request(`/api/exams/${task.id}/files/exam.md`, admin.cookie))
        .status,
      200,
    );
    assert.equal(
      (await request(`/api/exams/${task.id}/files/exam.html`, admin.cookie))
        .status,
      200,
    );
    assert.equal(
      (
        await request(
          `/api/exams/${task.id}/files/${result.exam.pages[0].key}`,
          admin.cookie,
        )
      ).status,
      200,
    );

    // Exercise the teacher workflow against the real API and persistent worker.
    if (!live) {
      const payload = (data: unknown) => ({ method: "POST", ...json(data) });
      const classroomResponse = await request(
        "/api/classes",
        admin.cookie,
        payload({ name: "题套流程测试班" }),
      );
      assert.equal(classroomResponse.status, 201);
      const classroom = await classroomResponse.json();
      classrooms.push(classroom.id);
      const studentResponse = await request(
        "/api/classes/students",
        admin.cookie,
        payload({ classroomId: classroom.id, name: "合成学生", number: "01" }),
      );
      assert.equal(studentResponse.status, 201);
      const student = await studentResponse.json();
      assert.equal(
        (
          await request(
            "/api/classes/batches",
            other.cookie,
            payload({
              classroomId: classroom.id,
              name: "越权批次",
              templateId: task.id,
            }),
          )
        ).status,
        404,
      );
      const batchResponse = await request(
        "/api/classes/batches",
        admin.cookie,
        payload({
          classroomId: classroom.id,
          name: "模板复用验收",
          templateId: task.id,
        }),
      );
      assert.equal(batchResponse.status, 201);
      const batch = await batchResponse.json();
      assert.equal(batch.templateOutputKey, result.task.outputKey);
      const edit = await request(`/api/exams/${task.id}`, admin.cookie, {
        method: "PATCH",
        ...json({
          outputKey: result.task.outputKey,
          questionId: result.exam.questions[0].id,
          blocks: result.exam.questions[0].blocks,
          points: 5,
          confirmed: true,
          solution: {
            answer: "6",
            selectedOptions: [],
            explanation: "测试后续修正",
            units: [{targetKey:"main",answer:"6",selectedOptions:[],explanation:"测试后续修正"}],
            rubric: "结果为6得5分",
            sufficient: true,
            issues: [],
          },
        }),
      });
      assert.equal(edit.status, 200);
      assert.equal(
        (
          await request(`/api/exams/${task.id}`, admin.cookie, {
            method: "PATCH",
            ...json({
              outputKey: result.task.outputKey,
              questionId: result.exam.questions[0].id,
              blocks: result.exam.questions[0].blocks,
              points: 5,
              confirmed: true,
            }),
          })
        ).status,
        409,
        "stale edits do not overwrite newer output",
      );
      assert.equal(
        (
          await request(
            `/api/admin/ai/providers/${providerId}/activate`,
            admin.cookie,
            payload({ purpose: "grading" }),
          )
        ).status,
        200,
      );
      const before = calls.length;
      const answers = new FormData();
      answers.append(
        "files",
        new Blob([new Uint8Array(image)], { type: "image/png" }),
        "学生答题卡.png",
      );
      const answerResponse = await request(
        `/api/classes/batches/${batch.id}?studentId=${student.id}`,
        admin.cookie,
        { method: "POST", body: answers },
      );
      assert.equal(answerResponse.status, 202);
      const studentTask = (await answerResponse.json()).task;
      tasks.push(studentTask.id);
      let details:
        | {
            classes: {
              batches: {
                exams: { id: string; gradeId: string | null; status: string }[];
              }[];
            }[];
          }
        | undefined;
      const batchDeadline = Date.now() + 60_000;
      while (Date.now() < batchDeadline) {
        details = await (await request("/api/classes", admin.cookie)).json();
        const graded = details!.classes
          .flatMap((c) => c.batches)
          .flatMap((b) => b.exams)
          .find((e) => e.id === studentTask.id);
        if (graded?.status === "批改完成") break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const graded = details!.classes
        .flatMap((c) => c.batches)
        .flatMap((b) => b.exams)
        .find((e) => e.id === studentTask.id);
      assert.equal(graded?.status, "批改完成");
      const grade = await (
        await request(`/api/grades/${graded!.gradeId}`, admin.cookie)
      ).json();
      assert.equal(
        grade.result.questions[0].expectedAnswer,
        "5",
        "batch reuses frozen template even after teacher changes it to 6",
      );
      const studentEvidence = await (await request(`/api/exams/${studentTask.id}`,admin.cookie)).json();
      assert.equal(grade.result.questions[0].score, 0, JSON.stringify({ reasons:grade.result.questions[0].reviewReasons,failed:grade.result.questions[0].failed,answer:grade.result.questions[0].studentAnswerBlocks,sources:studentEvidence.exam.answerDocument?.responses }));
      const answerImage = grade.result.questions[0].studentAnswerBlocks.find((b: {type:string}) => b.type === "figure");
      assert.ok(answerImage?.assetId,"grading preserves non-text answer assets");
      const evidenceURL = `/api/grades/${graded!.gradeId}/evidence?region=${encodeURIComponent(JSON.stringify(answerImage.region))}&assetId=${answerImage.assetId}`;
      assert.equal((await request(evidenceURL,admin.cookie)).status,200);
      assert.equal((await request(evidenceURL,other.cookie)).status,404);
      assert.equal((await request(`/api/grades/${graded!.gradeId}/download?format=html`,admin.cookie)).status,200);

      assert.equal(
        grade.result.usage.calls,
        1,
        "grading only assesses, never re-solves",
      );
      assert.ok(calls.slice(before).includes("exam_answer_layout"));
      assert.ok(calls.slice(before).includes("exam_answer_transcription"));
      assert.ok(
        !calls.slice(before).includes("exam_inventory") &&
          !calls.slice(before).includes("exam_solution"),
      );
      const studentExam = await (
        await request(`/api/exams/${studentTask.id}`, admin.cookie)
      ).json();
      assert.equal(
        studentExam.exam.template.outputKey,
        batch.templateOutputKey,
      );
      assert.equal(
        (
          await request(
            `/api/exams/${task.id}/files/${result.exam.questions[0].crops[0].key}`,
            admin.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            `/api/exams/${task.id}/files/${result.exam.questions[0].crops[0].key}`,
            other.cookie,
          )
        ).status,
        404,
      );
      const learning = await (
        await request("/api/learning", admin.cookie)
      ).json();
      assert.ok(
        learning.entries.some(
          (e: { studentName?: string }) => e.studentName === "合成学生",
        ),
      );
      console.log(
        "Teacher workflow passed: template binding, answer cards, frozen answers, grading reuse, authenticated crops, stale edit prevention and student learning.",
      );
    }
    if (!live) {
      const body = new FormData();
      body.append("files", new Blob([new Uint8Array(image)], { type: "image/png" }), "不预生成答案.png");
      const created = await request("/api/exams?generateAnswers=false", admin.cookie, { method: "POST", body });
      assert.equal(created.status, 202);
      const noAnswerId = (await created.json()).task.id;
      tasks.push(noAnswerId);
      const waitExam = async () => {
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          const detail = await (await request(`/api/exams/${noAnswerId}`, admin.cookie)).json();
          if (detail.task.status === "COMPLETED") return detail;
          assert.notEqual(detail.task.status, "FAILED");
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        throw new Error("Solution task did not finish");
      };
      const beforeSolve = await waitExam();
      assert.equal(beforeSolve.task.generateAnswers, false);
      assert.equal(beforeSolve.exam.questions[0].solution, undefined);
      assert.equal((await request(`/api/exams/${noAnswerId}/grades`, admin.cookie, {method:"POST",...json({submissions:[{
        questionId:beforeSolve.exam.questions[0].id,answer:"4",referenceAnswer:"",rubric:"",maxPoints:5,
      }]})})).status,409,"missing standards block grading before a task is enqueued");
      assert.equal((await request(`/api/exams/${noAnswerId}`,admin.cookie,{method:"PATCH",...json({
        outputKey:beforeSolve.task.outputKey,questionId:beforeSolve.exam.questions[0].id,
        blocks:[{type:"text",text:"计算：2 + 3 + 0 = ____。"}],points:5,confirmed:true,
      })})).status,200);
      const edited = await waitExam();
      const callsBefore = calls.length;
      assert.equal((await request(`/api/exams/${noAnswerId}/solutions`,other.cookie,{method:"POST"})).status,404);
      assert.equal((await request(`/api/exams/${noAnswerId}/solutions`,admin.cookie,{method:"POST"})).status,202);
      const solved = await waitExam();
      assert.notEqual(solved.task.outputKey,edited.task.outputKey);
      assert.equal(solved.exam.questions[0].blocks[0].text,"计算：2 + 3 + 0 = ____。");
      assert.equal(solved.exam.questions[0].solution.answer,"5");
      assert.equal(solved.exam.questions[0].solution.sufficient,true);
      assert.deepEqual(calls.slice(callsBefore),["exam_solution"],"saved edits are solved without re-reading the upload");
      console.log("Optional standards passed: disabled generation, grading prerequisite, saved-edit preservation and solution-only queue.");
    }
    const report = JSON.stringify(
      {
        live,
        taskId: task.id,
        userId: admin.id,
        providerId,
        users,
        providers,
        tasks,
        classrooms,
        previousGradingProviderId: previousGrading?.providerId ?? null,
        previousProviderId: previous?.providerId ?? null,
        questions: result.exam.questions.length,
        status: result.exam.verification.status,
        usage: result.exam.verification.usage,
      },
      null,
      2,
    );
    await writeFile(join(temporary, "report.json"), report, { mode: 0o600 });
    if (live)
      await writeFile(join(temporary, "live-report.json"), report, {
        mode: 0o600,
      });
    const cookies = admin.cookie.split("; ").map((value) => {
      const equal = value.indexOf("=");
      return {
        name: value.slice(0, equal),
        value: value.slice(equal + 1),
        domain: new URL(base).hostname,
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      };
    });
    await writeFile(
      join(temporary, "admin-state.json"),
      JSON.stringify({ cookies, origins: [] }),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        passed: true,
        live,
        questions: result.exam.questions.length,
        status: result.exam.verification.status,
        usage: result.exam.verification.usage,
      }),
    );
    if (keep) {
      retained = true;
      console.log(
        "Browser fixtures retained. Run with --cleanup after browser verification.",
      );
    }
  } finally {
    if (!retained) {
      await getDb().aiSetting.upsert({
        where: { id: "exam" },
        create: { id: "exam", providerId: previous?.providerId ?? null },
        update: { providerId: previous?.providerId ?? null },
      });
      await getDb().aiSetting.upsert({
        where: { id: "grading" },
        create: {
          id: "grading",
          providerId: previousGrading?.providerId ?? null,
        },
        update: { providerId: previousGrading?.providerId ?? null },
      });
      await getDb().classroom.deleteMany({ where: { id: { in: classrooms } } });
      await getDb().aiProvider.deleteMany({ where: { id: { in: providers } } });
      await getDb().user.deleteMany({ where: { id: { in: users } } });
      await Promise.all(
        tasks.map((id) =>
          rm(taskDirectory(id), { recursive: true, force: true }),
        ),
      );
      await rm(join(temporary, "admin-state.json"), { force: true });
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectDatabase();
  }
}

async function cleanup() {
  const { readFile } = await import("node:fs/promises");
  const { getDb, disconnectDatabase } = await import("../src/server/db/client");
  const { getStoragePaths } = await import("../src/server/config/env");
  const { taskDirectory } = await import("../src/server/exams/tasks");
  const temporary = join(getStoragePaths().temp, "exam-web-test");
  const report = JSON.parse(
    await readFile(join(temporary, "report.json"), "utf8"),
  );
  try {
    await getDb().aiSetting.updateMany({
      where: { id: "exam", providerId: { in: report.providers } },
      data: { providerId: report.previousProviderId },
    });
    await getDb().aiSetting.updateMany({
      where: { id: "grading", providerId: { in: report.providers } },
      data: { providerId: report.previousGradingProviderId ?? null },
    });
    await getDb().classroom.deleteMany({
      where: { id: { in: report.classrooms ?? [] } },
    });
    await getDb().aiProvider.deleteMany({
      where: { id: { in: report.providers } },
    });
    await getDb().user.deleteMany({ where: { id: { in: report.users } } });
    await Promise.all(
      report.tasks.map((id: string) =>
        rm(taskDirectory(id), { recursive: true, force: true }),
      ),
    );
    await rm(join(temporary, "admin-state.json"), { force: true });
    console.log("Browser test fixtures cleaned up.");
  } finally {
    await disconnectDatabase();
  }
}

if (process.argv[1]?.endsWith("test-exam-web.ts"))
  (process.argv.includes("--cleanup") ? cleanup() : main()).catch(
    (error: unknown) => {
      const message =
        error instanceof assert.AssertionError
          ? `Exam web assertion failed: ${error.message}`
          : "Exam web test failed; inspect server health and worker status.";
      console.error(
        process.env.DEEPSEEK_API_KEY
          ? message.replaceAll(process.env.DEEPSEEK_API_KEY, "[redacted]")
          : message,
      );
      process.exitCode = 1;
    },
  );
