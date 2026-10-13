import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnvironment } from "./load-env.mjs";
import { modelStreamResponse } from "../tests/model-stream-response";
loadEnvironment();

async function main() {
  const schema = `paper_test_${randomUUID().replaceAll("-", "")}`;
  const root = await mkdtemp(join(tmpdir(), "paper-integration-"));
  const connectionString = process.env.DATABASE_URL!;
  const sql = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  const { PrismaClient } = await import("../src/generated/prisma/client");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }),
  });
  const originalFetch = globalThis.fetch;
  const originalStorage = process.env.STORAGE_ROOT;
  const originalQueueSchema = process.env.QUEUE_SCHEMA;
  const queueSchema = `${schema}_jobs`;
  process.env.QUEUE_SCHEMA = queueSchema;
  const globalDb = globalThis as typeof globalThis & {
    paperDb?: InstanceType<typeof PrismaClient>;
  };
  globalDb.paperDb = db;
  process.env.STORAGE_ROOT = root;
  let retained = false;
  try {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    for (const folder of (await readdir("prisma/migrations"))
      .filter((folder) => /^\d/.test(folder))
      .sort()) {
      if (folder === "20261012080000_exam_question_hierarchy") {
        await sql.query(
          `INSERT INTO users (id, name, email, "updatedAt") VALUES ('migration-user', '迁移测试', 'migration-test@example.com', CURRENT_TIMESTAMP)`,
        );
        await sql.query(
          `INSERT INTO exams (id, "userId", name, "totalScore") VALUES ('migration-exam', 'migration-user', '旧试卷', 5)`,
        );
        await sql.query(
          `INSERT INTO exam_questions (id, "examId", position, description, materials, score) VALUES ('migration-question', 'migration-exam', 1, '1. 旧题干', '[]', 5)`,
        );
        await sql.query(`INSERT INTO exam_answers ("examId") VALUES ('migration-exam')`);
        await sql.query(
          `INSERT INTO question_answers ("questionId", "examId", solution, "gradingCriteria") VALUES ('migration-question', 'migration-exam', '旧答案', '旧评分标准')`,
        );
        await sql.query(
          `INSERT INTO submissions (id, "examId", "studentId") VALUES ('migration-submission', 'migration-exam', 'migration-user')`,
        );
        await sql.query(
          `INSERT INTO submission_answers ("submissionId", "examId", "questionId", answer, correct, score) VALUES ('migration-submission', 'migration-exam', 'migration-question', '旧作答', true, 5)`,
        );
      }
      if (folder === "20261012120000_management_workflows") {
        await sql.query(
          `INSERT INTO exam_tasks (id, "userId", "examId", name, status, "inputFiles", "providerSnapshot", "jobId") VALUES ('migration-source', 'migration-user', 'migration-exam', '旧试卷', 'COMPLETED', '{}', '{}', 'migration-source-job')`,
        );
        await sql.query(
          `INSERT INTO exam_agent_tasks (id, "examId", kind, name, status, "inputFiles", "providerSnapshot", "jobId") VALUES ('migration-answer', 'migration-exam', 'ANSWER', '标准答案', 'COMPLETED', '{}', '{}', 'migration-answer-job'), ('migration-grade', 'migration-exam', 'GRADING', '旧报告', 'COMPLETED', '{}', '{}', 'migration-grade-job')`,
        );
      }
      await sql.query(await readFile(join("prisma/migrations", folder, "migration.sql"), "utf8"));
    }
    console.log("✓ All migrations apply in an isolated schema");
    const legacy = await db.exam.findUniqueOrThrow({
      where: { id: "migration-exam" },
      include: {
        sections: { include: { questions: { include: { answer: true, submissions: true } } } },
      },
    });
    assert.equal(legacy.sections[0].title, "题目");
    const legacyQuestion = legacy.sections[0].questions[0];
    assert.equal(legacyQuestion.id, "migration-question");
    assert.equal(legacyQuestion.description, "1. 旧题干");
    assert.equal(legacyQuestion.number, 1);
    assert.deepEqual(legacyQuestion.subquestions, []);
    assert.equal(legacyQuestion.answer?.solution, "旧答案");
    assert.equal(legacyQuestion.submissions[0].answer, "旧作答");
    assert.equal(legacyQuestion.submissions[0].score, 5);
    const migratedWorkflow = await db.gradingWorkflow.findUniqueOrThrow({
      where: { id: "migration-grade" },
    });
    assert.equal(migratedWorkflow.status, "COMPLETED");
    assert.equal(migratedWorkflow.answerTaskId, "migration-answer");
    assert.equal(migratedWorkflow.gradingTaskId, "migration-grade");
    await db.user.delete({ where: { id: "migration-user" } });
    console.log("✓ Hierarchy migration preserves existing questions, answers and submissions");
    const { saveProvider, listProviders, activateModel, getActiveProvider } =
      await import("../src/server/ai/settings");
    const { getAuth } = await import("../src/server/auth");
    const signup = await getAuth().api.signUpEmail({
      body: {
        name: "测试老师",
        email: "paper-test@example.com",
        password: "paper-integration-1234",
      },
    });
    const userId = signup.user.id;
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits.toFixed(8),
      "100.00000000",
    );
    await db.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
    const providerId = await saveProvider({
      name: "测试提供商",
      apiType: "openai_chat",
      baseURL: "https://example.invalid/v1",
      apiKey: "test-key",
      structuredOutputs: true,
      maxOutputTokens: 16000,
      timeoutSeconds: 60,
      maxConcurrency: 3,
      models: [
        { name: "vision-one", displayName: "轻量解析", reasoningEfforts: ["default", "high"] },
        { name: "vision-two", displayName: "深度解答", reasoningEfforts: ["low", "medium"] },
      ],
    });
    const providers = await listProviders(),
      provider = providers[0];
    assert.equal(provider.models.length, 2);
    assert.equal(JSON.stringify(providers).includes("encryptedApiKey"), false);
    assert.equal(JSON.stringify(providers).includes("test-key"), false);
    await activateModel(providerId, provider.models[0].id, "high");
    await assert.rejects(activateModel(providerId, provider.models[1].id, "high"));
    const snapshot = await getActiveProvider();
    assert.equal(snapshot.model, "vision-one");
    assert.equal(snapshot.displayName, "轻量解析");
    assert.equal(snapshot.reasoningEffort, "high");
    const purposeMigration = await readFile(
      "prisma/migrations/20261012200000_ai_purpose_settings/migration.sql",
      "utf8",
    );
    await sql.query(purposeMigration);
    assert.equal((await getActiveProvider("answer")).model, "vision-one");
    assert.equal((await getActiveProvider("grading")).reasoningEffort, "high");
    await activateModel(providerId, provider.models[1].id, "medium", "grading");
    await sql.query(purposeMigration);
    assert.equal((await getActiveProvider("grading")).model, "vision-two");
    await assert.rejects(activateModel(providerId, provider.models[1].id, "high", "answer"));
    // Removing an active effort selects another supported effort atomically.
    await saveProvider(
      {
        name: provider.name,
        apiType: provider.apiType,
        baseURL: provider.baseURL,
        structuredOutputs: provider.structuredOutputs,
        maxOutputTokens: provider.maxOutputTokens,
        timeoutSeconds: provider.timeoutSeconds,
        maxConcurrency: provider.maxConcurrency,
        apiKey: "",
        models: provider.models.map((model, index) =>
          index === 0 ? { ...model, reasoningEfforts: ["default"] } : model,
        ),
      },
      providerId,
    );
    assert.equal((await getActiveProvider()).reasoningEffort, "default");
    assert.equal((await getActiveProvider("answer")).reasoningEffort, "default");
    assert.equal((await getActiveProvider("grading")).reasoningEffort, "medium");
    await activateModel(providerId, provider.models[1].id, "medium", "answer");
    const gradingProviderId = await saveProvider({
      name: "批改提供商",
      apiType: provider.apiType,
      baseURL: provider.baseURL,
      structuredOutputs: provider.structuredOutputs,
      maxOutputTokens: provider.maxOutputTokens,
      timeoutSeconds: provider.timeoutSeconds,
      maxConcurrency: provider.maxConcurrency,
      apiKey: "grading-test-key",
      models: [
        { name: "grading-vision", displayName: "精细批改", reasoningEfforts: ["default", "high"] },
      ],
    });
    const gradingProvider = (await listProviders()).find((item) => item.id === gradingProviderId)!;
    await activateModel(gradingProvider.id, gradingProvider.models[0].id, "high", "grading");
    assert.equal((await getActiveProvider()).model, "vision-one");
    assert.equal((await getActiveProvider("answer")).model, "vision-two");
    assert.equal((await getActiveProvider("grading")).model, "grading-vision");
    const independentSelections = await listProviders();
    assert.equal(
      independentSelections.find((item) => item.id === providerId)?.selections.answer?.modelId,
      provider.models[1].id,
    );
    assert.equal(
      independentSelections.find((item) => item.id === gradingProviderId)?.selections.grading
        ?.reasoningEffort,
      "high",
    );
    assert.equal(JSON.stringify(independentSelections).includes("grading-test-key"), false);
    console.log(
      "✓ Independent purpose models, cross-provider selection, migration preservation and effort updates",
    );
    const { processExamTask, taskResult, taskDirectory } =
      await import("../src/server/exams/tasks");
    const id = randomUUID(),
      jobId = randomUUID();
    await mkdir(join(taskDirectory(id), "inputs"), { recursive: true });
    const { default: sharp } = await import("sharp");
    await sharp({ create: { width: 600, height: 800, channels: 3, background: "white" } })
      .png()
      .toFile(join(taskDirectory(id), "inputs/1.upload"));
    const parsed = {
      name: "数学测试卷",
      totalScore: 10,
      layout: { paperSize: "A3", columns: 2, orientation: "landscape" },
      sections: [
        {
          number: "一",
          title: "计算题",
          description: "本题共1小题，共5分。",
          score: 5,
          questions: [
            {
              number: 1,
              description: "**计算** $1+1$。",
              materials: [],
              score: 5,
              subquestions: [],
            },
          ],
        },
        {
          number: "四",
          title: "解答题",
          description: "解答应写出演算步骤。",
          score: 5,
          questions: [
            {
              number: 15,
              description: "如图，矩形长为 $3$，宽为 $2$。",
              materials: [{ page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.2 }],
              score: 5,
              subquestions: [
                { number: "(1)", description: "求矩形面积。", materials: [], score: null },
                {
                  number: "(2)",
                  description: "解释下图。",
                  materials: [{ page: 1, x: 0.5, y: 0.5, width: 0.2, height: 0.2 }],
                  score: null,
                },
              ],
            },
          ],
        },
      ],
    };
    let calls = 0;
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.model, snapshot.model);
      assert.equal(request.stream, true);
      assert.deepEqual(request.stream_options, { include_usage: true });
      assert.equal(request.reasoning_effort, "high");
      const steps = [
        { name: "read_pages", args: { pages: [1] } },
        {
          name: "inspect_image",
          args: {
            region: { page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
            scale: 2,
            sharpen: false,
          },
        },
        { name: "report_exam_meta", args: { total: 2, paperSize: "A3", columns: 2 } },
        ...parsed.sections.map((section) => ({
          name: "append_questions",
          args: { ...parsed, sections: [section] },
        })),
        { name: "submit_exam", args: { name: parsed.name, totalScore: parsed.totalScore } },
      ];
      if (calls === 3 || calls === 4 || calls === 5) {
        const progress = await db.examTask.findUniqueOrThrow({ where: { id } });
        assert.equal(progress.totalQuestions, 2);
        assert.equal(progress.parsedQuestions, calls - 3);
      }
      const next = steps[calls++];
      assert.ok(next, "Unexpected extra model call");
      return modelStreamResponse({
        id: `test-completion-${calls}`,
        object: "chat.completion",
        created: 1,
        model: snapshot.model,
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 100,
          total_tokens: 1100,
          prompt_tokens_details: { cached_tokens: 200 },
        },
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: `tool-${calls}`,
                  type: "function",
                  function: { name: next.name, arguments: JSON.stringify(next.args) },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      });
    };
    await db.examTask.create({
      data: {
        id,
        userId,
        jobId,
        name: "input.png",
        inputFiles: ["inputs/1.upload"],
        providerSnapshot: snapshot,
      },
    });
    await processExamTask(id, jobId, new AbortController().signal);
    const task = await db.examTask.findUniqueOrThrow({ where: { id } });
    assert.equal(task.status, "COMPLETED");
    const exam = (await taskResult(task))!;
    assert.deepEqual(exam.layout, { paperSize: "A3", columns: 2, orientation: "landscape" });
    assert.equal(exam.sections.length, 2);
    const questions = exam.sections.flatMap((section) => section.questions);
    assert.deepEqual(
      questions.map((question) => question.number),
      [1, 15],
    );
    assert.deepEqual(
      questions[1].subquestions.map((part) => part.number),
      ["(1)", "(2)"],
    );
    assert.deepEqual(
      questions[1].subquestions.map((part) => part.score),
      [null, null],
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(taskDirectory(id), task.outputKey!, "exam.json"), "utf8")),
      parsed,
    );
    assert.ok(
      (await readFile(join(taskDirectory(id), task.outputKey!, "materials/2-2-1.jpg"))).length > 0,
    );
    assert.equal(exam.totalScore, 10);
    await processExamTask(id, jobId, new AbortController().signal);
    assert.equal(calls, 6);
    assert.equal(await db.exam.count(), 1);
    const { readActivity } = await import("../src/server/exams/activity");
    const events = await readActivity(join(taskDirectory(id), task.attempt!));
    assert.deepEqual(
      events.filter((event) => event.type === "tool_call").map((event) => event.tool),
      [
        "read_pages",
        "inspect_image",
        "report_exam_meta",
        "append_questions",
        "append_questions",
        "submit_exam",
      ],
    );
    assert.equal(events.at(-1)?.type, "completed");
    const failedId = randomUUID(),
      failedJobId = randomUUID();
    await mkdir(join(taskDirectory(failedId), "inputs"), { recursive: true });
    await writeFile(
      join(taskDirectory(failedId), "inputs/1.upload"),
      await readFile(join(taskDirectory(id), "inputs/1.upload")),
    );
    const failures: string[] = [],
      originalConsoleError = console.error;
    console.error = (...args) => {
      failures.push(String(args[0]));
    };
    try {
      globalThis.fetch = async () =>
        Response.json(
          { error: { message: "Unauthorized", type: "authentication_error" } },
          { status: 401 },
        );
      await db.examTask.create({
        data: {
          id: failedId,
          userId,
          jobId: failedJobId,
          name: "failed.png",
          inputFiles: ["inputs/1.upload"],
          providerSnapshot: snapshot,
        },
      });
      await processExamTask(failedId, failedJobId, new AbortController().signal);
      const failed = await db.examTask.findUniqueOrThrow({ where: { id: failedId } });
      assert.equal(failed.status, "FAILED");
      assert.match(failed.error!, /HTTP 401/);
      assert.match(failed.error!, /错误编号/);
      assert.equal(
        (await readActivity(join(taskDirectory(failedId), failed.attempt!))).at(-1)?.type,
        "failed",
      );
      assert.ok(
        failures.some(
          (line) => line.includes("exam.parse.failed") && line.includes("model_recognition"),
        ),
      );
      assert.equal(failures.join("\n").includes("test-key"), false);
    } finally {
      console.error = originalConsoleError;
    }
    console.log("✓ Real SDK tool activity and persisted provider failure diagnostics");
    const questionId = questions[0].id;
    const otherExam = await db.exam.create({
      data: {
        userId,
        name: "other",
        totalScore: null,
        sections: {
          create: { position: 1, number: "一", title: "题目", description: "", score: null },
        },
      },
      include: { sections: true },
    });
    const otherQuestion = await db.examQuestion.create({
      data: {
        examId: otherExam.id,
        sectionId: otherExam.sections[0].id,
        position: 1,
        number: 1,
        description: "other question",
        materials: [],
        score: null,
        subquestions: [],
      },
    });
    await assert.rejects(
      db.examQuestion.create({
        data: {
          examId: exam.id,
          sectionId: otherExam.sections[0].id,
          position: 3,
          number: 16,
          description: "wrong section",
          materials: [],
          score: null,
          subquestions: [],
        },
      }),
    );
    await db.examAnswer.create({ data: { examId: exam.id } });
    await db.questionAnswer.create({
      data: { examId: exam.id, questionId, solution: "2", gradingCriteria: "答案正确得 5 分。" },
    });
    await assert.rejects(
      db.questionAnswer.create({
        data: {
          examId: exam.id,
          questionId: otherQuestion.id,
          solution: "invalid",
          gradingCriteria: "invalid",
        },
      }),
    );
    const submission = await db.submission.create({ data: { examId: exam.id, studentId: userId } });
    await db.submission.create({ data: { examId: exam.id, studentId: userId } });
    await db.submissionAnswer.create({
      data: {
        submissionId: submission.id,
        examId: exam.id,
        questionId,
        answer: "2",
        correct: true,
        score: 5,
      },
    });
    await assert.rejects(
      db.submissionAnswer.create({
        data: {
          submissionId: submission.id,
          examId: exam.id,
          questionId: otherQuestion.id,
          answer: "invalid",
        },
      }),
    );
    await assert.rejects(
      db.submissionAnswer.create({
        data: {
          submissionId: submission.id,
          examId: otherExam.id,
          questionId: otherQuestion.id,
          answer: "invalid",
        },
      }),
    );
    await assert.rejects(
      db.examQuestion.update({ where: { id: questionId }, data: { score: -1 } }),
    );
    assert.equal(await db.submission.count({ where: { examId: exam.id } }), 2);
    console.log(
      "✓ Parsing publishes questions once; cross-exam answers and submissions are rejected",
    );
    await db.exam.delete({ where: { id: otherExam.id } });
    assert.equal(await db.examQuestion.count({ where: { examId: otherExam.id } }), 0);
    assert.equal(await db.examSection.count({ where: { examId: otherExam.id } }), 0);
    console.log("✓ Exam deletion cascades to its questions");
    const { processAgentTask, agentTaskDirectory, ownedAgentTask } =
      await import("../src/server/exams/agent-tasks");
    const answerId = randomUUID(),
      answerJob = randomUUID();
    const answerItems = questions.map((question) => ({
      questionId: question.id,
      solution: `第${question.number}题解答`,
      gradingCriteria: "正确得5分，步骤错误酌情扣分。",
    }));
    let agentCalls = 0;
    function installAgentModel(
      rounds: { name: string; args: unknown }[],
      before?: (round: number) => Promise<void>,
      expectedModel = snapshot.model,
    ) {
      agentCalls = 0;
      globalThis.fetch = async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        assert.equal(request.model, expectedModel);
        assert.equal(request.stream, true);
        assert.deepEqual(request.stream_options, { include_usage: true });
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          `Bearer ${expectedModel === "grading-vision" ? "grading-test-key" : "test-key"}`,
        );
        await before?.(agentCalls);
        const next = rounds[agentCalls++];
        return modelStreamResponse({
          id: `agent-${agentCalls}`,
          object: "chat.completion",
          created: 1,
          model: expectedModel,
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 100,
            total_tokens: 1100,
            prompt_tokens_details: { cached_tokens: 200 },
          },
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: next ? null : "stopped",
                ...(next
                  ? {
                      tool_calls: [
                        {
                          id: `agent-tool-${agentCalls}`,
                          type: "function",
                          function: { name: next.name, arguments: JSON.stringify(next.args) },
                        },
                      ],
                    }
                  : {}),
              },
              finish_reason: next ? "tool_calls" : "stop",
            },
          ],
        });
      };
    }
    await db.examAgentTask.create({
      data: {
        id: answerId,
        jobId: answerJob,
        examId: exam.id,
        kind: "ANSWER",
        totalQuestions: questions.length,
        name: "标准答案",
        inputFiles: [],
        providerSnapshot: snapshot,
      },
    });
    await assert.rejects(
      db.examAgentTask.create({
        data: {
          jobId: randomUUID(),
          examId: exam.id,
          kind: "ANSWER",
          name: "重复运行",
          inputFiles: [],
          providerSnapshot: snapshot,
        },
      }),
    );
    installAgentModel(
      [
        { name: "list_questions", args: {} },
        { name: "read_question", args: { questionId } },
        { name: "append_answers", args: { questions: [answerItems[0]] } },
        { name: "read_question", args: { questionId: questions[1].id } },
        { name: "append_answers", args: { questions: [answerItems[1]] } },
        { name: "submit_answers", args: {} },
      ],
      async (round) => {
        if (round === 3) {
          const draft = await db.examAgentTask.findUniqueOrThrow({ where: { id: answerId } });
          assert.equal(draft.totalQuestions, 2);
          assert.equal((draft.result as { questions: unknown[] }).questions.length, 1);
          assert.deepEqual(
            (await db.examAgentTask.findUniqueOrThrow({ where: { id: answerId } })).result,
            { questions: [answerItems[0]] },
          );
        }
      },
    );
    await processAgentTask(answerId, answerJob, new AbortController().signal);
    assert.equal(
      (await db.examAgentTask.findUniqueOrThrow({ where: { id: answerId } })).status,
      "COMPLETED",
    );
    assert.equal(
      (await db.questionAnswer.findUniqueOrThrow({ where: { questionId } })).solution,
      answerItems[0].solution,
    );
    assert.equal(await db.questionAnswer.count({ where: { examId: exam.id } }), 2);
    await processAgentTask(answerId, answerJob, new AbortController().signal);
    assert.equal(agentCalls, 6);
    await assert.rejects(ownedAgentTask(userId, failedId, answerId));
    const gradeId = randomUUID(),
      gradeJob = randomUUID();
    await mkdir(join(agentTaskDirectory(gradeId), "inputs"), { recursive: true });
    await writeFile(
      join(agentTaskDirectory(gradeId), "inputs/1.upload"),
      await readFile(join(taskDirectory(id), "inputs/1.upload")),
    );
    const gradeItems = questions.map((question, index) => ({
      questionId: question.id,
      answer: index ? "未完整作答" : "2",
      correct: index ? false : true,
      score: index ? 2 : 5,
      feedback: index ? "第一小问正确，第二小问缺失，得2分。" : "正确，得5分。",
    }));
    await db.examAgentTask.create({
      data: {
        id: gradeId,
        jobId: gradeJob,
        examId: exam.id,
        kind: "GRADING",
        totalQuestions: questions.length,
        name: "student.png",
        inputFiles: ["inputs/1.upload"],
        reference: answerItems,
        providerSnapshot: snapshot,
      },
    });
    installAgentModel([
      { name: "read_pages", args: { pages: [1] } },
      { name: "read_question", args: { questionId } },
      { name: "append_grades", args: { questions: [gradeItems[0]] } },
      { name: "append_grades", args: { questions: [gradeItems[1]] } },
      { name: "submit_grading", args: {} },
    ]);
    await processAgentTask(gradeId, gradeJob, new AbortController().signal);
    const gradedTask = await db.examAgentTask.findUniqueOrThrow({ where: { id: gradeId } });
    assert.equal(gradedTask.status, "COMPLETED");
    assert.ok(gradedTask.submissionId);
    const graded = await db.submissionAnswer.findMany({
      where: { submissionId: gradedTask.submissionId! },
      orderBy: { score: "desc" },
    });
    assert.deepEqual(
      graded.map((item) => item.score),
      [5, 2],
    );
    assert.equal(graded[1].feedback, gradeItems[1].feedback);
    await processAgentTask(gradeId, gradeJob, new AbortController().signal);
    assert.equal(await db.submission.count({ where: { id: gradedTask.submissionId! } }), 1);
    const interruptedId = randomUUID(),
      interruptedJob = randomUUID();
    await db.examAgentTask.create({
      data: {
        id: interruptedId,
        jobId: interruptedJob,
        examId: exam.id,
        kind: "ANSWER",
        totalQuestions: questions.length,
        name: "中断答案",
        inputFiles: [],
        providerSnapshot: snapshot,
      },
    });
    installAgentModel([
      {
        name: "append_answers",
        args: { questions: [{ ...answerItems[0], solution: "修订答案" }] },
      },
    ]);
    await processAgentTask(interruptedId, interruptedJob, new AbortController().signal);
    const interrupted = await db.examAgentTask.findUniqueOrThrow({ where: { id: interruptedId } });
    assert.equal(interrupted.status, "FAILED");
    assert.deepEqual(interrupted.result, {
      questions: [{ ...answerItems[0], solution: "修订答案" }],
    });
    assert.equal(
      (await db.questionAnswer.findUniqueOrThrow({ where: { questionId } })).solution,
      answerItems[0].solution,
    );
    const resumedJob = randomUUID();
    await db.examAgentTask.update({
      where: { id: interruptedId },
      data: { jobId: resumedJob, status: "QUEUED" },
    });
    await processAgentTask(interruptedId, interruptedJob, new AbortController().signal);
    assert.equal(agentCalls, 2);
    installAgentModel([
      { name: "append_answers", args: { questions: [answerItems[1]] } },
      { name: "submit_answers", args: {} },
    ]);
    await processAgentTask(interruptedId, resumedJob, new AbortController().signal);
    assert.equal(
      (await db.examAgentTask.findUniqueOrThrow({ where: { id: interruptedId } })).status,
      "COMPLETED",
    );
    assert.equal(
      (await db.questionAnswer.findUniqueOrThrow({ where: { questionId } })).solution,
      "修订答案",
    );
    assert.deepEqual(gradedTask.reference, answerItems);
    console.log(
      "✓ Answer and grading agents persist batches, publish once, retain references and resume failed drafts",
    );
    const { processWorkflow, ownedWorkflow } = await import("../src/server/exams/workflows");
    const workflow = await db.gradingWorkflow.create({
      data: {
        userId,
        sourceId: id,
        kind: "GRADING",
        name: "学生答卷",
        status: "RUNNING",
        answerTaskId: answerId,
        gradingTaskId: gradeId,
        inputFiles: [],
        jobId: randomUUID(),
      },
    });
    await processWorkflow(workflow.id, workflow.jobId);
    assert.equal(
      (await db.gradingWorkflow.findUniqueOrThrow({ where: { id: workflow.id } })).status,
      "COMPLETED",
    );
    const submissionsBefore = await db.submission.count({ where: { examId: exam.id } });
    await processWorkflow(workflow.id, workflow.jobId);
    await processWorkflow(workflow.id, randomUUID());
    assert.equal(await db.submission.count({ where: { examId: exam.id } }), submissionsBefore);
    await assert.rejects(ownedWorkflow("another-user", workflow.id));
    console.log(
      "✓ Existing grading history migrates; coordinator publishes once and enforces ownership",
    );
    const { getJobProducer } = await import("../src/server/jobs/client");
    const boss = await getJobProducer();
    try {
      const heartbeat = await db.workerHeartbeat.create({ data: { id: randomUUID() } });
      const { createAgentTask } = await import("../src/server/exams/agent-tasks");
      const quickFlow = await db.gradingWorkflow.create({
        data: {
          userId,
          sourceId: id,
          kind: "QUICK",
          name: "快速作答",
          inputFiles: [],
          jobId: randomUUID(),
        },
      });
      // Existing standard answer is linked without launching a duplicate generator.
      await processWorkflow(quickFlow.id, quickFlow.jobId);
      let queuedFlow = await db.gradingWorkflow.findUniqueOrThrow({ where: { id: quickFlow.id } });
      assert.ok(queuedFlow.answerTaskId);
      assert.notEqual(queuedFlow.jobId, quickFlow.jobId);
      await processWorkflow(quickFlow.id, queuedFlow.jobId);
      queuedFlow = await db.gradingWorkflow.findUniqueOrThrow({ where: { id: quickFlow.id } });
      assert.ok(queuedFlow.gradingTaskId);
      const queuedGrade = await db.examAgentTask.findUniqueOrThrow({
        where: { id: queuedFlow.gradingTaskId! },
      });
      assert.equal((queuedGrade.providerSnapshot as { model: string }).model, "grading-vision");
      assert.equal(queuedGrade.status, "QUEUED");
      assert.deepEqual(
        await readFile(join(agentTaskDirectory(queuedGrade.id), queuedGrade.inputFiles[0])),
        await readFile(join(taskDirectory(id), "inputs/1.upload")),
      );
      assert.equal((await boss.getJobById("exam.agent.v1", queuedGrade.jobId))?.state, "created");
      await assert.rejects(
        createAgentTask(new Request("http://localhost"), userId, id, "GRADING", {
          id: quickFlow.id,
          jobId: quickFlow.jobId,
          files: [join(taskDirectory(id), "inputs/1.upload")],
        }),
      );
      installAgentModel(
        [
          ...gradeItems.map((item) => ({ name: "append_grades", args: { questions: [item] } })),
          { name: "submit_grading", args: {} },
        ],
        undefined,
        "grading-vision",
      );
      await processAgentTask(queuedGrade.id, queuedGrade.jobId, new AbortController().signal);
      await processWorkflow(quickFlow.id, queuedFlow.jobId);
      assert.equal(
        (await db.gradingWorkflow.findUniqueOrThrow({ where: { id: quickFlow.id } })).status,
        "COMPLETED",
      );
      assert.equal(
        await db.examAgentTask.count({ where: { examId: exam.id, kind: "GRADING" } }),
        2,
      );
      // Run all three stages from a real multipart upload, with no existing reference.
      const { createExamTask } = await import("../src/server/exams/tasks");
      const keyImage = await sharp({
        create: { width: 240, height: 320, channels: 3, background: "green" },
      })
        .png()
        .toBuffer();
      for (const { quick, suppliedReference } of [
        { quick: true, suppliedReference: false },
        { quick: true, suppliedReference: true },
        { quick: false, suppliedReference: true },
      ]) {
        await activateModel(providerId, provider.models[1].id, "medium", "answer");
        const form = new FormData();
        form.append(
          "files",
          new File(
            [new Uint8Array(await readFile(join(taskDirectory(id), "inputs/1.upload")))],
            "作答试卷.png",
            { type: "image/png" },
          ),
        );
        if (suppliedReference)
          form.append(
            "answerFiles",
            new File([new Uint8Array(keyImage)], "标准答案.png", { type: "image/png" }),
          );
        const uploadedSource = await createExamTask(
          new Request(quick ? "http://localhost/api/quick-grade" : "http://localhost/api/exams", {
            method: "POST",
            body: form,
          }),
          userId,
          quick,
        );
        let uploadedTask = await db.examTask.findUniqueOrThrow({
          where: { id: uploadedSource.id },
        });
        assert.equal((uploadedTask.providerSnapshot as { model: string }).model, "vision-one");
        assert.equal(uploadedTask.inputFiles.length, 1);
        if (!quick) {
          const waitingFlow = await db.gradingWorkflow.findFirstOrThrow({
            where: { sourceId: uploadedTask.id, kind: "ANSWER_UPLOAD" },
          });
          await processWorkflow(waitingFlow.id, waitingFlow.jobId);
          let waiting = await db.gradingWorkflow.findUniqueOrThrow({
            where: { id: waitingFlow.id },
          });
          assert.equal(waiting.answerTaskId, null);
          await db.examTask.update({
            where: { id: uploadedTask.id },
            data: { status: "FAILED", error: "Interrupted recognition" },
          });
          await processWorkflow(waiting.id, waiting.jobId);
          assert.equal(
            (await db.gradingWorkflow.findUniqueOrThrow({ where: { id: waiting.id } })).status,
            "FAILED",
          );
          const { retryExamTask } = await import("../src/server/exams/tasks");
          await retryExamTask(userId, uploadedTask.id);
          waiting = await db.gradingWorkflow.findUniqueOrThrow({ where: { id: waiting.id } });
          assert.equal(waiting.status, "QUEUED");
          assert.equal(waiting.referenceFiles.length, 1);
          uploadedTask = await db.examTask.findUniqueOrThrow({ where: { id: uploadedTask.id } });
        }
        installAgentModel([
          { name: "report_exam_meta", args: { total: 2, paperSize: "A3", columns: 2 } },
          { name: "append_questions", args: parsed },
          { name: "submit_exam", args: { name: parsed.name, totalScore: parsed.totalScore } },
        ]);
        await processExamTask(uploadedTask.id, uploadedTask.jobId, new AbortController().signal);
        let bundled = await db.gradingWorkflow.findFirstOrThrow({
          where: { sourceId: uploadedTask.id },
        });
        assert.equal(bundled.referenceFiles.length, suppliedReference ? 1 : 0);
        if (!quick) {
          const { answerUploadState } = await import("../src/server/exams/workflows");
          assert.ok(await answerUploadState(userId, uploadedTask.id));
          await assert.rejects(
            createAgentTask(new Request("http://localhost"), userId, uploadedTask.id, "ANSWER"),
          );
        }
        await processWorkflow(bundled.id, bundled.jobId);
        bundled = await db.gradingWorkflow.findUniqueOrThrow({ where: { id: bundled.id } });
        assert.ok(bundled.answerTaskId);
        assert.equal(bundled.gradingTaskId, null);
        const newQuestions = await db.examQuestion.findMany({
          where: { exam: { task: { id: uploadedTask.id } } },
          orderBy: { position: "asc" },
        });
        let newAnswer = await db.examAgentTask.findUniqueOrThrow({
          where: { id: bundled.answerTaskId! },
        });
        assert.equal((newAnswer.providerSnapshot as { model: string }).model, "vision-two");
        assert.equal(newAnswer.inputFiles.length, suppliedReference ? 1 : 0);
        if (suppliedReference)
          assert.deepEqual(
            await readFile(join(agentTaskDirectory(newAnswer.id), newAnswer.inputFiles[0])),
            keyImage,
          );
        const matchedAnswers = newQuestions.map((question, index) => ({
          ...answerItems[index],
          questionId: question.id,
          solution: suppliedReference ? `上传标准答案 ${index + 1}` : answerItems[index].solution,
        }));
        // A retry picks the current answer configuration and leaves other purposes intact.
        await db.examAgentTask.update({ where: { id: newAnswer.id }, data: { status: "FAILED" } });
        await activateModel(providerId, provider.models[0].id, "default", "answer");
        const { retryAgentTask } = await import("../src/server/exams/agent-tasks");
        await retryAgentTask(userId, uploadedTask.id, newAnswer.id);
        newAnswer = await db.examAgentTask.findUniqueOrThrow({ where: { id: newAnswer.id } });
        assert.equal((newAnswer.providerSnapshot as { model: string }).model, "vision-one");
        assert.equal((await getActiveProvider("grading")).model, "grading-vision");
        installAgentModel([
          ...(suppliedReference ? [{ name: "read_pages", args: { pages: [1] } }] : []),
          ...matchedAnswers.map((item) => ({
            name: "append_answers",
            args: { questions: [item] },
          })),
          { name: "submit_answers", args: {} },
        ]);
        await processAgentTask(newAnswer.id, newAnswer.jobId, new AbortController().signal);
        await processWorkflow(bundled.id, bundled.jobId);
        bundled = await db.gradingWorkflow.findUniqueOrThrow({ where: { id: bundled.id } });
        if (!quick) {
          assert.equal(bundled.status, "COMPLETED");
          assert.equal(bundled.gradingTaskId, null);
          const { listWorkflows, answerUploadState } =
            await import("../src/server/exams/workflows");
          assert.equal(
            (await listWorkflows(userId)).some((item) => item.id === bundled.id),
            false,
          );
          assert.equal(await answerUploadState(userId, uploadedTask.id), null);
          console.log(
            "✓ Paper and key upload waits for recognition, resumes after a failure and runs a separate answer agent without grading",
          );
          continue;
        }
        assert.ok(bundled.gradingTaskId);
        const newGrade = await db.examAgentTask.findUniqueOrThrow({
          where: { id: bundled.gradingTaskId! },
        });
        assert.equal((newGrade.providerSnapshot as { model: string }).model, "grading-vision");
        assert.deepEqual(newGrade.reference, matchedAnswers);
        assert.deepEqual(
          await readFile(join(agentTaskDirectory(newGrade.id), newGrade.inputFiles[0])),
          await readFile(join(taskDirectory(id), "inputs/1.upload")),
        );
        installAgentModel(
          [
            { name: "read_pages", args: { pages: [1] } },
            ...newQuestions.map((question, index) => ({
              name: "append_grades",
              args: { questions: [{ ...gradeItems[index], questionId: question.id }] },
            })),
            { name: "submit_grading", args: {} },
          ],
          undefined,
          "grading-vision",
        );
        await processAgentTask(newGrade.id, newGrade.jobId, new AbortController().signal);
        await processWorkflow(bundled.id, bundled.jobId);
        assert.equal(
          (await db.gradingWorkflow.findUniqueOrThrow({ where: { id: bundled.id } })).status,
          "COMPLETED",
        );
        console.log(
          suppliedReference
            ? "✓ Quick grading parses supplied answers and grades only the student's pages"
            : "✓ Quick grading without supplied answers generates its own reference",
        );
      }
      // Standalone answer upload replaces the current reference without altering previous grading snapshots.
      const previousReferences = await db.examAgentTask.findMany({
        where: { examId: exam.id, kind: "GRADING" },
        select: { id: true, reference: true },
      });
      const manualForm = new FormData();
      manualForm.append(
        "files",
        new File([new Uint8Array(keyImage)], "独立标准答案.png", { type: "image/png" }),
      );
      const manual = await createAgentTask(
        new Request("http://localhost/api/exams/answers/upload", {
          method: "POST",
          body: manualForm,
        }),
        userId,
        id,
        "ANSWER",
        undefined,
        true,
      );
      assert.equal(manual.answerSource, "UPLOAD");
      const manualTask = await db.examAgentTask.findUniqueOrThrow({ where: { id: manual.id } });
      assert.deepEqual(
        await readFile(join(agentTaskDirectory(manual.id), manualTask.inputFiles[0])),
        keyImage,
      );
      const manualAnswers = answerItems.map((item, index) => ({
        ...item,
        solution: `独立上传的标准答案 ${index + 1}`,
      }));
      installAgentModel([
        { name: "read_pages", args: { pages: [1] } },
        ...manualAnswers.map((item) => ({ name: "append_answers", args: { questions: [item] } })),
        { name: "submit_answers", args: {} },
      ]);
      await processAgentTask(manualTask.id, manualTask.jobId, new AbortController().signal);
      assert.equal(
        (await db.examAgentTask.findUniqueOrThrow({ where: { id: manual.id } })).status,
        "COMPLETED",
      );
      for (const item of manualAnswers)
        assert.equal(
          (await db.questionAnswer.findUniqueOrThrow({ where: { questionId: item.questionId } }))
            .solution,
          item.solution,
        );
      assert.deepEqual(
        await db.examAgentTask.findMany({
          where: { examId: exam.id, kind: "GRADING" },
          select: { id: true, reference: true },
        }),
        previousReferences,
      );
      console.log(
        "✓ Standalone uploaded answer parsing updates the reference and preserves previous reports",
      );
      const { requireCredits, taskCreditMeter } = await import("../src/server/ai/credits");
      const { userAiSettings, selectUserModel, getUserProvider } =
        await import("../src/server/ai/user-settings");
      const { usageDashboard } = await import("../src/server/ai/usage");
      const { creditUnits, creditAmount } = await import("../src/lib/credits");
      const charges = await db.creditUsage.findMany({ where: { userId } });
      assert.ok(charges.length > 10);
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits.toFixed(8),
        "100.00000000",
      );
      await db.user.update({ where: { id: userId }, data: { credits: -100 } });
      await requireCredits(userId);
      assert.equal((await userAiSettings(userId)).unlimited, true);
      await db.user.update({ where: { id: userId }, data: { role: "USER", credits: 100 } });
      // Two callbacks from different workers settle atomically; replay has no cost.
      const meter = taskCreditMeter({
        userId,
        taskId: manual.id,
        taskKind: "ANSWER",
        attempt: manualTask.attempt ?? "meter-test",
        model: "vision-one",
        modelId: provider.models[0].id,
        providerId,
        providerName: provider.name,
        multiplier: 2.5,
      });
      const tokenUsage = {
        inputTokens: 1000,
        outputTokens: 1000,
        totalTokens: 2000,
        inputTokenDetails: { noCacheTokens: 500, cacheReadTokens: 500, cacheWriteTokens: 0 },
        outputTokenDetails: { textTokens: 900, reasoningTokens: 100 },
      };
      const beforeBalance = (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits;
      const firstCall = randomUUID(),
        secondCall = randomUUID();
      await Promise.all([
        meter.record(firstCall, tokenUsage),
        meter.record(secondCall, tokenUsage),
        meter.record(firstCall, tokenUsage),
      ]);
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits.toFixed(8),
        beforeBalance.minus("2.8").toFixed(8),
      );
      assert.equal(
        await db.creditUsage.count({ where: { id: { in: [firstCall, secondCall] } } }),
        2,
      );
      const beforeFailure = await db.creditUsage.count();
      const beforeFailureBalance = (
        await db.user.findUniqueOrThrow({ where: { id: userId } })
      ).credits.toFixed(8);
      const missingTask = taskCreditMeter({
        userId,
        taskId: randomUUID(),
        taskKind: "ANSWER",
        attempt: "missing",
        model: "vision-one",
        providerId,
        providerName: provider.name,
        multiplier: 1,
      });
      await assert.rejects(missingTask.record(randomUUID(), tokenUsage));
      assert.equal(await db.creditUsage.count(), beforeFailure);
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits.toFixed(8),
        beforeFailureBalance,
      );
      console.log(
        "✓ Exact credit debit, concurrent settlement, callback replay and transaction rollback",
      );
      const publicUser = await db.user.create({
        data: { id: randomUUID(), name: "公众用户", email: "public-credit@example.com" },
      });
      assert.equal(publicUser.credits.toFixed(8), "100.00000000");
      assert.equal((await userAiSettings(publicUser.id)).models.length, 0);
      await assert.rejects(selectUserModel(publicUser.id, "exam", provider.models[0].id));
      await assert.rejects(getUserProvider(publicUser.id));
      await db.aiModel.update({ where: { id: provider.models[0].id }, data: { isPublic: true } });
      await db.aiModel.update({
        where: { id: provider.models[1].id },
        data: { isPublic: true, creditMultiplier: 2.5 },
      });
      const safe = await userAiSettings(publicUser.id);
      assert.equal(safe.models.length, 2);
      assert.ok(safe.models.some((model) => model.name === "轻量解析"));
      assert.equal(JSON.stringify(safe).includes("vision-one"), false);
      assert.equal(JSON.stringify(safe).includes("baseURL"), false);
      assert.equal(JSON.stringify(safe).includes("ApiKey"), false);
      await selectUserModel(publicUser.id, "answer", provider.models[1].id);
      assert.equal((await getUserProvider(publicUser.id, "answer")).model, "vision-two");
      assert.equal((await getUserProvider(publicUser.id, "exam")).model, "vision-one");
      assert.equal((await getUserProvider(publicUser.id, "answer")).creditMultiplier, 2.5);
      assert.equal(
        (await getUserProvider(publicUser.id, "answer", provider.models[0].id)).model,
        "vision-one",
      );
      assert.equal((await getUserProvider(publicUser.id, "answer")).model, "vision-two");
      await assert.rejects(getUserProvider(publicUser.id, "answer", gradingProvider.models[0].id));
      await db.aiModel.update({ where: { id: provider.models[1].id }, data: { isPublic: false } });
      await assert.rejects(getUserProvider(publicUser.id, "answer"));
      await selectUserModel(publicUser.id, "answer", null);
      assert.equal((await getUserProvider(publicUser.id, "answer")).model, "vision-one");
      await db.aiModel.update({ where: { id: provider.models[1].id }, data: { isPublic: true } });
      console.log(
        "✓ Public model selection, per-purpose independence, secret redaction and withdrawal enforcement",
      );
      await selectUserModel(userId, "answer", provider.models[1].id);
      await db.user.update({ where: { id: userId }, data: { credits: 0 } });
      await requireCredits(userId); // A zero balance is permitted by the debt policy.
      await db.user.update({ where: { id: userId }, data: { credits: "0.01" } });
      const debtTask = await createAgentTask(new Request("http://localhost"), userId, id, "ANSWER");
      const debtStored = await db.examAgentTask.findUniqueOrThrow({ where: { id: debtTask.id } });
      installAgentModel(
        [
          ...answerItems.map((item) => ({ name: "append_answers", args: { questions: [item] } })),
          { name: "submit_answers", args: {} },
        ],
        async (round) => {
          if (round === 0)
            await db.aiModel.update({
              where: { id: provider.models[1].id },
              data: { creditMultiplier: 8 },
            });
          else {
            assert.ok(
              (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits.lessThan(0),
            );
            await assert.rejects(
              createAgentTask(new Request("http://localhost"), userId, id, "ANSWER"),
              (error: unknown) =>
                error instanceof Error && "code" in error && error.code === "CREDITS_EXHAUSTED",
            );
          }
        },
        "vision-two",
      );
      await processAgentTask(debtStored.id, debtStored.jobId, new AbortController().signal);
      const debtComplete = await db.examAgentTask.findUniqueOrThrow({ where: { id: debtTask.id } });
      assert.equal(debtComplete.status, "COMPLETED");
      assert.equal(debtComplete.creditsSpent.toFixed(8), "1.00500000");
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits.toFixed(8),
        "-0.99500000",
      );
      const debtRows = await db.creditUsage.findMany({ where: { taskId: debtTask.id } });
      assert.equal(debtRows.length, 3);
      assert.ok(debtRows.every((row) => row.creditMultiplier.toNumber() === 2.5));
      await assert.rejects(requireCredits(userId));
      const dashboard = await usageDashboard();
      const allRows = await db.creditUsage.findMany();
      assert.equal(
        dashboard.totals.credits,
        creditAmount(allRows.reduce((sum, row) => sum + creditUnits(row.credits.toFixed(8)), 0n)),
      );
      assert.equal(
        dashboard.totals.inputTokens,
        allRows.reduce((sum, row) => sum + row.inputTokens, 0),
      );
      assert.equal(
        dashboard.totals.cachedTokens,
        allRows.reduce((sum, row) => sum + row.cachedTokens, 0),
      );
      assert.equal(
        dashboard.totals.outputTokens,
        allRows.reduce((sum, row) => sum + row.outputTokens, 0),
      );
      assert.equal(dashboard.users.find((item) => item.id === userId)!.balance, "-0.99500000");
      assert.equal(dashboard.users.find((item) => item.id === publicUser.id)!.credits, "0");
      assert.equal(
        dashboard.models.find((item) => item.id === provider.models[1].id)!.credits,
        "1.00500000",
      );
      assert.equal(
        dashboard.models.reduce((sum, row) => sum + creditUnits(row.credits), 0n),
        creditUnits(dashboard.totals.credits),
      );
      assert.equal(
        dashboard.users.reduce((sum, row) => sum + creditUnits(row.credits), 0n),
        creditUnits(dashboard.totals.credits),
      );
      console.log(
        "✓ Current agent finishes in debt, new agents are blocked, immutable pricing and usage rankings match the ledger",
      );
      await db.user.update({ where: { id: userId }, data: { role: "ADMIN", credits: -100 } });
      await requireCredits(userId);
      const adminBefore = await db.user.findUniqueOrThrow({ where: { id: userId } });
      await meter.record(randomUUID(), tokenUsage);
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: userId } })).credits.toFixed(8),
        adminBefore.credits.toFixed(8),
      );
      const { grantCredits } = await import("../src/server/ai/credit-grants");
      const grantId = randomUUID();
      await Promise.all([
        grantCredits(userId, publicUser.id, { requestId: grantId, amount: 25.5 }),
        grantCredits(userId, publicUser.id, { requestId: grantId, amount: 25.5 }),
      ]);
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: publicUser.id } })).credits.toFixed(8),
        "125.50000000",
      );
      assert.equal(await db.creditGrant.count({ where: { id: grantId } }), 1);
      await assert.rejects(
        grantCredits(publicUser.id, publicUser.id, { requestId: randomUUID(), amount: 5 }),
      );
      await assert.rejects(grantCredits(userId, publicUser.id, { requestId: grantId, amount: 50 }));
      await assert.rejects(grantCredits(userId, userId, { requestId: randomUUID(), amount: 50 }));
      console.log(
        "✓ Administrators have unlimited credit without debits, grants are atomic, audited and idempotent",
      );
      const chosenForm = new FormData();
      chosenForm.append(
        "files",
        new File([new Uint8Array(keyImage)], "模型选择.png", { type: "image/png" }),
      );
      chosenForm.append(
        "models",
        JSON.stringify({
          exam: provider.models[1].id,
          answer: provider.models[0].id,
          grading: provider.models[1].id,
          reasoningEfforts: { exam: "medium", answer: "default", grading: "low" },
        }),
      );
      const chosen = await createExamTask(
        new Request("http://localhost/api/quick-grade", { method: "POST", body: chosenForm }),
        userId,
        true,
      );
      const chosenSource = await db.examTask.findUniqueOrThrow({ where: { id: chosen.id } });
      const chosenFlow = await db.gradingWorkflow.findFirstOrThrow({
        where: { sourceId: chosen.id },
      });
      assert.equal((chosenSource.providerSnapshot as { model: string }).model, "vision-two");
      assert.equal(
        (chosenSource.providerSnapshot as { reasoningEffort: string }).reasoningEffort,
        "medium",
      );
      assert.equal(
        (chosenFlow.modelSnapshots as { grading: { reasoningEffort: string } }).grading
          .reasoningEffort,
        "low",
      );
      assert.equal(
        (chosenFlow.modelSnapshots as { answer: { model: string }; grading: { model: string } })
          .answer.model,
        "vision-one",
      );
      assert.equal(
        (chosenFlow.modelSnapshots as { grading: { model: string } }).grading.model,
        "vision-two",
      );
      assert.equal((await getUserProvider(userId)).model, "vision-one");
      assert.equal((await getUserProvider(userId, "answer")).model, "vision-two");
      await selectUserModel(publicUser.id, "answer", provider.models[1].id, "medium");
      assert.equal((await userAiSettings(publicUser.id)).reasoningSelections?.answer, "medium");
      assert.equal((await getUserProvider(publicUser.id, "answer")).reasoningEffort, "medium");
      assert.equal(
        (await getUserProvider(publicUser.id, "answer", undefined, "low")).reasoningEffort,
        "low",
      );
      await assert.rejects(getUserProvider(publicUser.id, "answer", undefined, "high"));
      await assert.rejects(selectUserModel(publicUser.id, "answer", provider.models[1].id, "high"));
      assert.equal(
        (await getUserProvider(userId, "answer", provider.models[0].id, "default")).reasoningEffort,
        "default",
      );
      console.log(
        "✓ Supported account/task reasoning overrides persist and unsupported strengths are rejected",
      );

      const { listUsers, updateUser, resetUserPassword } =
        await import("../src/server/admin/users");
      const { listAllExams, reviewExam } = await import("../src/server/admin/exams");
      const resetAccount = await getAuth().api.signUpEmail({
        body: {
          name: "密码测试用户",
          email: "password-test@example.com",
          password: "original-password-123",
        },
      });
      assert.ok(await db.session.count({ where: { userId: resetAccount.user.id } }));
      const oldHash = (
        await db.account.findFirstOrThrow({
          where: { userId: resetAccount.user.id, providerId: "credential" },
        })
      ).password;
      await assert.rejects(
        resetUserPassword(publicUser.id, resetAccount.user.id, "new-password-456"),
      );
      assert.equal(
        (
          await db.account.findFirstOrThrow({
            where: { userId: resetAccount.user.id, providerId: "credential" },
          })
        ).password,
        oldHash,
      );
      await resetUserPassword(userId, resetAccount.user.id, "new-password-456");
      assert.equal(await db.session.count({ where: { userId: resetAccount.user.id } }), 0);
      await assert.rejects(
        getAuth().api.signInEmail({
          body: { email: "password-test@example.com", password: "original-password-123" },
        }),
      );
      await getAuth().api.signInEmail({
        body: { email: "password-test@example.com", password: "new-password-456" },
      });
      await updateUser(userId, resetAccount.user.id, { name: "已更新用户", role: "ADMIN" });
      assert.equal(await db.session.count({ where: { userId: resetAccount.user.id } }), 0);
      assert.equal((await listUsers("password-test", 1)).items[0].role, "ADMIN");
      await updateUser(userId, resetAccount.user.id, { name: "已更新用户", role: "USER" });
      await assert.rejects(updateUser(userId, userId, { name: "测试老师", role: "USER" }));
      const allExams = await listAllExams("", 1);
      assert.ok(allExams.total >= 1);
      assert.ok(
        (await listAllExams("paper-test@example.com", 1)).items.every(
          (task) => task.owner.id === userId,
        ),
      );
      const reviewed = await reviewExam(id);
      assert.equal(reviewed.task.owner.id, userId);
      assert.ok(reviewed.exam?.sections.length);
      assert.ok(reviewed.agents.some((agent) => agent.kind === "ANSWER"));
      assert.equal(JSON.stringify(reviewed).includes("encryptedApiKey"), false);
      console.log(
        "✓ Global paper/user review, password login replacement, session revocation and last-admin protection",
      );
      const answerOverride = await createAgentTask(
        new Request("http://localhost"),
        userId,
        id,
        "ANSWER",
        undefined,
        false,
        provider.models[0].id,
      );
      assert.equal(
        (
          (await db.examAgentTask.findUniqueOrThrow({ where: { id: answerOverride.id } }))
            .providerSnapshot as { model: string }
        ).model,
        "vision-one",
      );
      console.log(
        "✓ Per-task model selections override account/system defaults and persist across sequential agent stages",
      );

      await db.user.update({ where: { id: userId }, data: { credits: 100 } });
      await selectUserModel(userId, "answer", null);
      await db.workerHeartbeat.delete({ where: { id: heartbeat.id } });
      console.log(
        "✓ Quick grading links its reference, copies original uploads, enqueues once and completes the report",
      );
      {
        const { editExam, deleteExamTask } = await import("../src/server/exams/edit");
        const { listExamTasks } = await import("../src/server/exams/tasks");
        const { reviewExam } = await import("../src/server/admin/exams");
        const { parsedExamSchema } = await import("../src/contracts/exams");
        const editableId = randomUUID();
        const savedExam = await db.exam.create({
          data: {
            userId,
            name: "编辑删除测试",
            totalScore: 5,
            sections: {
              create: {
                position: 1,
                number: "一",
                title: "计算题",
                description: "请作答",
                score: 5,
              },
            },
          },
          include: { sections: true },
        });
        const question = await db.examQuestion.create({
          data: {
            examId: savedExam.id,
            sectionId: savedExam.sections[0].id,
            position: 1,
            number: 1,
            description: "计算 $1+1$",
            score: 5,
            materials: [],
          },
        });
        await db.examTask.create({
          data: {
            id: editableId,
            userId,
            examId: savedExam.id,
            name: savedExam.name,
            status: "COMPLETED",
            inputFiles: [],
            providerSnapshot: {},
            jobId: randomUUID(),
          },
        });
        const original = (await taskResult(
          await db.examTask.findUniqueOrThrow({ where: { id: editableId } }),
        ))!;
        const payload = {
          revision: 0,
          exam: parsedExamSchema.parse({
            name: original.name,
            totalScore: original.totalScore,
            layout: { paperSize: "A4", columns: 3, orientation: "portrait" },
            sections: original.sections.map((section) => ({
              number: section.number,
              title: section.title,
              description: section.description,
              score: section.score,
              questions: section.questions.map((item) => ({
                number: item.number,
                description: item.description,
                score: item.score,
                materials: item.materials,
                subquestions: item.subquestions,
              })),
            })),
          }),
        };
        payload.exam.name = "已修改的试卷";
        payload.exam.sections[0].questions[0].description = "计算 $1+2$";
        await assert.rejects(editExam("another-owner", editableId, payload));
        const updated = (await editExam(userId, editableId, payload))!;
        assert.equal(updated.name, payload.exam.name);
        assert.equal(updated.revision, 1);
        assert.deepEqual(updated.layout, { paperSize: "A4", columns: 3, orientation: "portrait" });
        assert.equal(updated.sections[0].questions[0].id, question.id);
        assert.equal(updated.sections[0].questions[0].description, "计算 $1+2$");
        await assert.rejects(editExam(userId, editableId, payload), /其他页面修改/);
        const activeTask = await db.examAgentTask.create({
          data: {
            examId: savedExam.id,
            examRevision: 1,
            kind: "ANSWER",
            name: "并发测试",
            status: "QUEUED",
            inputFiles: [],
            providerSnapshot: {},
            jobId: randomUUID(),
          },
        });
        await assert.rejects(
          editExam(userId, editableId, { ...payload, revision: 1 }),
          /正在生成答案或批改/,
        );
        await db.examAgentTask.update({
          where: { id: activeTask.id },
          data: { status: "COMPLETED" },
        });
        await assert.rejects(deleteExamTask("another-owner", editableId));
        await deleteExamTask(userId, editableId);
        await deleteExamTask(userId, editableId);
        assert.equal(
          (await listExamTasks(userId)).some((task) => task.id === editableId),
          false,
        );
        const review = await reviewExam(editableId);
        assert.ok(review.task.deletedAt);
        assert.equal(review.exam?.sections[0].questions[0].id, question.id);
        assert.ok(review.agents.some((task) => task.id === activeTask.id));
        await assert.rejects(editExam(userId, editableId, { ...payload, revision: 1 }), /已删除/);
        console.log(
          "✓ Owned edits preserve question IDs, reject stale/active writes; soft deletion hides lists and preserves admin review",
        );
      }
    } finally {
      await boss.stop();
    }
    if (process.argv.includes("--keep")) {
      // A retained fixture is for local browser verification only; the main schema is untouched.
      const url = new URL(connectionString);
      url.searchParams.set("schema", schema);
      url.searchParams.set("options", `-c search_path=${schema}`);
      await writeFile(
        join(root, "browser-env.json"),
        JSON.stringify({
          DATABASE_URL: url.toString(),
          STORAGE_ROOT: root,
          BETTER_AUTH_URL: "http://localhost:3101",
          QUEUE_SCHEMA: queueSchema,
        }),
        { mode: 0o600 },
      );
      await writeFile(
        "/tmp/oh-my-paper-browser-fixture.json",
        JSON.stringify({ schema, queueSchema, root, taskId: id, workflowId: workflow.id }),
        { mode: 0o600 },
      );
      retained = true;
      console.log(
        "✓ Browser fixture retained; configuration stored in /tmp/oh-my-paper-browser-fixture.json",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    process.env.STORAGE_ROOT = originalStorage;
    process.env.QUEUE_SCHEMA = originalQueueSchema;
    globalDb.paperDb = undefined;
    await db.$disconnect();
    if (!retained) {
      await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.query(`DROP SCHEMA IF EXISTS "${queueSchema}" CASCADE`);
      await rm(root, { recursive: true, force: true });
    }
    await sql.end();
  }
}
main().catch((error) => {
  let message = error instanceof Error ? error.message : "Unknown error";
  for (const key of ["DATABASE_URL", "BETTER_AUTH_SECRET", "PROVIDER_KEY_ENCRYPTION_KEY"]) {
    if (process.env[key]) message = message.replaceAll(process.env[key]!, "[redacted]");
  }
  console.error(message);
  console.error("Integration check failed; inspect migrations and PostgreSQL access.");
  process.exitCode = 1;
});
