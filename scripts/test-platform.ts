import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnvironment } from "./load-env.mjs";
import type { BankQuestion, PlatformCommand, QuestionType } from "../src/server/platform/types";
loadEnvironment();
async function main() {
  const schema = `platform_test_${randomUUID().replaceAll("-", "")}`;
  const connectionString = process.env.DATABASE_URL!;
  const sql = new Client({ connectionString });
  const { PrismaClient } = await import("../src/generated/prisma/client");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }),
  });
  const globalDb = globalThis as typeof globalThis & {
    paperDb?: InstanceType<typeof PrismaClient>;
  };
  const previous = globalDb.paperDb;
  globalDb.paperDb = db;
  try {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    for (const folder of (await readdir("prisma/migrations")).filter((f) => /^\d/.test(f)).sort())
      await sql.query(await readFile(join("prisma/migrations", folder, "migration.sql"), "utf8"));
    console.log(
      "✓ Every historical and platform migration applies in an isolated PostgreSQL schema",
    );
    const { executeCommand, loadState } = await import("../src/server/platform/service");
    const { generateCardTemplate } = await import("../src/server/platform/cards");
    const ids = {
      teacher: "teacher",
      second: "second",
      arbiter: "arbiter",
      outside: "outside",
      admin: "admin",
      student: "account1",
      student2: "account2",
    };
    for (const [key, id] of Object.entries(ids))
      await db.user.create({
        data: {
          id,
          name: key,
          email: `${key}@test.invalid`,
          role: key === "admin" ? "ADMIN" : key.startsWith("student") ? "STUDENT" : "TEACHER",
        },
      });
    const actor = { id: ids.teacher };
    const cmd = (command: PlatformCommand) => executeCommand(actor, command);
    await assert.rejects(
      executeCommand(
        { id: ids.student, role: "ADMIN" },
        { type: "classroom.save", classroom: { name: "越权", grade: "高一" } },
      ),
      /教师权限/,
    );
    console.log("✓ Database roles override spoofed actor roles; student commands are rejected");
    const classId = (
      await cmd({
        type: "classroom.save",
        classroom: { name: "高一一班", grade: "高一" },
      })
    ).id;
    await db.teachingAssignment.createMany({
      data: [ids.teacher, ids.second, ids.arbiter].flatMap((userId) =>
        ["化学", "生物", "数学"].map((subject) => ({
          userId,
          role: "SUBJECT_TEACHER",
          subject,
          classroomId: classId,
        })),
      ),
    });
    const student1 = (
      await cmd({
        type: "student.save",
        student: { classroomId: classId, name: "甲", studentNumber: "000001", userId: ids.student },
      })
    ).id;
    const student2 = (
      await cmd({
        type: "student.save",
        student: {
          classroomId: classId,
          name: "乙",
          studentNumber: "000002",
          userId: ids.student2,
        },
      })
    ).id;
    await assert.rejects(
      cmd({
        type: "student.save",
        student: { classroomId: classId, name: "重复", studentNumber: "000001" },
      }),
      /相同卡号/,
    );
    const content = (type: QuestionType): BankQuestion["content"] => ({
      stem: `${type}原题`,
      options:
        type === "SINGLE" || type === "MULTIPLE"
          ? [
              { label: "A", text: "甲" },
              { label: "B", text: "乙" },
              { label: "C", text: "丙" },
            ]
          : [],
      answers:
        type === "SINGLE"
          ? ["A"]
          : type === "MULTIPLE"
            ? ["A", "C"]
            : type === "BLANK"
              ? ["氢", "氧"]
              : ["参考解法"],
      explanation: "解析",
      rubric: "合理方法酌情给分",
      images: [],
      parts:
        type === "MIXED"
          ? [
              {
                id: "1",
                type: "BLANK",
                stem: "写元素",
                options: [],
                answers: ["H"],
                explanation: "",
                rubric: "4分",
                knowledgeTags: ["元素"],
                score: 4,
              },
              {
                id: "2",
                type: "SUBJECTIVE",
                stem: "解释实验",
                options: [],
                answers: ["实验依据"],
                explanation: "",
                rubric: "6分",
                knowledgeTags: ["实验"],
                score: 6,
              },
            ]
          : [],
    });
    const chemistry: string[] = [];
    for (const type of ["SINGLE", "MULTIPLE", "BLANK", "SUBJECTIVE", "MIXED"] as const)
      chemistry.push(
        (
          await cmd({
            type: "question.save",
            question: {
              type,
              subject: "化学",
              grade: "高一",
              difficulty: 0.5,
              knowledgeTags: ["元素"],
              content: content(type),
            },
          })
        ).id,
      );
    const biology = (
      await cmd({
        type: "question.save",
        question: {
          type: "SUBJECTIVE",
          subject: "生物",
          grade: "高一",
          difficulty: 0.5,
          knowledgeTags: ["遗传"],
          content: content("SUBJECTIVE"),
        },
      })
    ).id;
    const recommend = (
      await cmd({
        type: "question.save",
        question: {
          type: "BLANK",
          subject: "化学",
          grade: "高一",
          difficulty: 0.3,
          knowledgeTags: ["元素"],
          content: { ...content("BLANK"), stem: "另一道元素题" },
        },
      })
    ).id;
    const paperCommand = (name: string, subject: string, questions: string[]): PlatformCommand => ({
      type: "paper.save",
      paper: {
        name,
        kind: "EXAM",
        subject,
        grade: "高一",
        instructions: "认真作答",
        layout: { paperSize: "A4", columns: 1 },
        items: questions.map((questionId, i) => ({
          questionId,
          score: 10,
          section: i < 2 ? "选择" : "综合",
        })),
      },
    });
    const chemistryPaper = (await cmd(paperCommand("化学卷", "化学", [...chemistry].reverse()))).id;
    const biologyPaper = (await cmd(paperCommand("生物卷", "生物", [biology]))).id;
    let state = await loadState(actor);
    const chem = state.papers.find((p) => p.id === chemistryPaper)!,
      bio = state.papers.find((p) => p.id === biologyPaper)!;
    assert.deepEqual(
      chem.items.map((i) => i.questionId),
      [...chemistry].reverse(),
    );
    const changed = state.questions.find((q) => q.id === chemistry[0])!;
    await cmd({
      type: "question.save",
      question: { ...changed, content: { ...changed.content, stem: "题库已更新" } },
    });
    assert.equal(
      (await loadState(actor)).papers.find((p) => p.id === chemistryPaper)!.items.at(-1)!.snapshot
        .content.stem,
      "SINGLE原题",
    );
    console.log(
      "✓ All five question types persist, blank answers and mixed parts remain structured, selected order and paper snapshots survive question edits",
    );
    const documentQuestion = state.questions.find((q) => q.id === chemistry[0])!;
    const edited = await cmd({
      type: "paper.save",
      paper: {
        name: "可视化编辑验收",
        kind: "HOMEWORK",
        subject: "化学",
        grade: "高一",
        instructions: "在本页作答",
        layout: {
          paperSize: "A4",
          columns: 1,
          marginMm: 22,
          fontSizePt: 12,
          lineHeight: 2,
          questionLayouts: { [documentQuestion.id]: { answerSpaceMm: 56, pageBreakBefore: true } },
        },
        items: [
          {
            questionId: documentQuestion.id,
            score: 6,
            section: "练习",
            content: { ...documentQuestion.content, stem: "本练习册独立题干", answers: ["B"] },
          },
        ],
      },
    });
    const documentState = await loadState(actor);
    const editedPaper = documentState.papers.find((p) => p.id === edited.id)!;
    assert.equal(editedPaper.items[0].snapshot.content.stem, "本练习册独立题干");
    assert.deepEqual(editedPaper.items[0].snapshot.content.answers, ["B"]);
    assert.equal(editedPaper.layout.questionLayouts?.[documentQuestion.id].answerSpaceMm, 56);
    assert.equal(
      documentState.questions.find((q) => q.id === documentQuestion.id)!.content.stem,
      "题库已更新",
    );
    await assert.rejects(
      cmd({
        type: "template.save",
        template: {
          paperId: edited.id,
          name: "无效作业答题卡",
          subject: editedPaper.subject,
          layout: generateCardTemplate(editedPaper).layout,
        },
      }),
      /作业使用练习册/,
    );
    console.log(
      "✓ Visual document edits persist independent question snapshots and print geometry; homework rejects answer cards",
    );
    const generated = generateCardTemplate(chem);
    const templateId = (
      await cmd({
        type: "template.save",
        template: {
          paperId: chem.id,
          name: generated.name,
          subject: generated.subject,
          layout: generated.layout,
        },
      })
    ).id;
    assert.equal((await loadState(actor)).templates.filter((t) => t.preset).length, 9);
    const bands = { enabled: true, bands: [{ upperPercent: 100, min: 40, max: 100 }] };
    const assessmentId = (
      await cmd({
        type: "assessment.save",
        assessment: {
          name: "生化联考",
          kind: "EXAM",
          reviewScope: "CLASSROOM",
          classroomIds: [classId],
          papers: [
            {
              paperId: chem.id,
              subject: "化学",
              gradingMode: "DOUBLE",
              arbitrationThreshold: 1,
              conversion: bands,
            },
            {
              paperId: bio.id,
              subject: "生物",
              gradingMode: "SINGLE",
              arbitrationThreshold: 0,
              conversion: bands,
            },
          ],
        },
      })
    ).id;
    await assert.rejects(
      cmd({ type: "assessment.publish", id: assessmentId, published: true }),
      /评阅完成/,
    );
    const lateStudent = (
      await cmd({
        type: "student.save",
        student: {
          classroomId: classId,
          name: "新转入",
          studentNumber: "000003",
          userId: null,
        },
      })
    ).id;
    assert(
      (await loadState(actor)).analytics.results.some(
        (result) => result.assessmentId === assessmentId && result.studentId === lateStudent,
      ),
    );
    await cmd({ type: "student.delete", id: lateStudent });
    await assert.rejects(
      cmd({
        type: "paper.save",
        paper: {
          ...chem,
          items: chem.items.map((i) => ({
            questionId: i.questionId,
            score: i.score,
            section: i.section,
          })),
        },
      }),
      /另存新卷/,
    );
    const submissions: { id: string; studentId: string; paperId: string }[] = [];
    for (const studentId of [student1, student2])
      for (const paper of [chem, bio]) {
        const id = (
          await cmd({
            type: "submission.save",
            submission: {
              assessmentId,
              paperId: paper.id,
              studentId,
              templateId: paper.id === chem.id ? templateId : null,
              kind: paper.id === chem.id ? "CARD" : "WORKBOOK",
              sourceFiles: [],
              answers: paper.items.map((i) => ({
                itemId: i.id,
                text: studentId === student1 ? "实际答案甲" : "实际答案乙",
                images: [],
              })),
            },
          })
        ).id;
        submissions.push({ id, studentId, paperId: paper.id });
      }
    await assert.rejects(
      cmd({
        type: "submission.save",
        submission: {
          assessmentId,
          paperId: chem.id,
          studentId: lateStudent,
          templateId,
          kind: "CARD",
          sourceFiles: [],
          answers: [],
        },
      }),
      /参试班级/,
    );
    await assert.rejects(
      executeCommand(
        { id: ids.outside },
        {
          type: "review.save",
          review: {
            submissionId: submissions[0].id,
            itemId: chem.items[0].id,
            round: "FIRST",
            score: 10,
            feedback: "越权",
          },
        },
      ),
      /无权访问/,
    );
    assert.equal((await loadState({ id: ids.outside })).assessments.length, 0);
    assert.equal((await loadState({ id: ids.second })).submissions.length, 4);
    for (const s of submissions) {
      const paper = s.paperId === chem.id ? chem : bio;
      for (const [i, item] of paper.items.entries()) {
        const partsFor = (score: number) =>
          item.snapshot.type === "MIXED"
            ? item.snapshot.content.parts.map((part) => ({
                partId: part.id,
                score:
                  (score * part.score) /
                  item.snapshot.content.parts.reduce((n, p) => n + p.score, 0),
                feedback: "逐小问评阅",
              }))
            : undefined;
        const first =
          s.paperId === chem.id
            ? s.studentId === student1
              ? 5
              : 8
            : s.studentId === student1
              ? 8
              : 6;
        await cmd({
          type: "review.save",
          review: {
            submissionId: s.id,
            itemId: item.id,
            round: "FIRST",
            score: first,
            partScores: partsFor(first),
            feedback: "第一评",
          },
        });
        if (s.paperId === chem.id) {
          await assert.rejects(
            cmd({
              type: "review.save",
              review: {
                submissionId: s.id,
                itemId: item.id,
                round: "SECOND",
                score: first,
                partScores: partsFor(first),
                feedback: "同人双评",
              },
            }),
            /不同教师/,
          );
          const second = s.studentId === student1 && i === 0 ? 2 : first;
          await executeCommand(
            { id: ids.second },
            {
              type: "review.save",
              review: {
                submissionId: s.id,
                itemId: item.id,
                round: "SECOND",
                score: second,
                partScores: partsFor(second),
                feedback: "第二评",
              },
            },
          );
          if (second !== first) {
            state = await loadState(actor);
            assert.equal(
              state.analytics.results
                .find((r) => r.studentId === student1)!
                .subjects.find((s) => s.paperId === chem.id)!.grades[0].status,
              "ARBITRATION",
            );
            await assert.rejects(
              executeCommand(
                { id: ids.second },
                {
                  type: "review.save",
                  review: {
                    submissionId: s.id,
                    itemId: item.id,
                    round: "ARBITRATION",
                    score: 4,
                    partScores: partsFor(4),
                    feedback: "",
                  },
                },
              ),
              /第三位教师/,
            );
            await executeCommand(
              { id: ids.arbiter },
              {
                type: "review.save",
                review: {
                  submissionId: s.id,
                  itemId: item.id,
                  round: "ARBITRATION",
                  score: 4,
                  partScores: partsFor(4),
                  feedback: "第三评确定",
                },
              },
            );
          }
        }
      }
    }
    state = await loadState(actor);
    const results = state.analytics.results.filter((r) => r.assessmentId === assessmentId);
    assert.deepEqual(
      results.map((r) => r.total),
      [140, 140],
    );
    assert.deepEqual(
      results.map((r) => r.rank),
      [1, 1],
    );
    assert.deepEqual(
      results.map((r) => r.classRank),
      [1, 1],
    );
    assert.equal(results[0].subjects.find((s) => s.subject === "化学")!.rawScore, 24.5);
    assert.equal(results[0].subjects.find((s) => s.subject === "化学")!.score, 40);
    assert.equal(results[1].subjects.find((s) => s.subject === "化学")!.score, 100);
    assert(
      state.analytics.students
        .find((s) => s.studentId === student1)!
        .recommendations.some((q) => q.id === recommend),
    );
    console.log(
      "✓ Shared teacher reviews, independent double marking, tolerance arbitration, biological/chemical rank conversion and tied combined/class rankings work in real transactions",
    );
    const before = await loadState({ id: ids.student });
    assert.equal(before.assessments.length, 0);
    assert.equal(before.submissions.length, 0);
    await cmd({ type: "assessment.publish", id: assessmentId, published: true });
    const studentState = await loadState({ id: ids.student });
    assert.equal(studentState.analytics.results.length, 1);
    assert.equal(studentState.analytics.results[0].rank, 1);
    assert.equal(studentState.analytics.results[0].total, 140);
    assert(studentState.submissions.every((s) => s.studentId === student1));
    assert.equal(studentState.reviews.length, 0);
    assert.equal(studentState.users.length, 0);
    assert.equal(studentState.questions.length, 0);
    assert(studentState.classrooms.every((c) => c.students.every((s) => s.userId === ids.student)));
    assert(studentState.analytics.students[0].wrongQuestions.length > 0);
    await assert.rejects(
      cmd({
        type: "review.save",
        review: {
          submissionId: submissions[0].id,
          itemId: chem.items[0].id,
          round: "FIRST",
          score: 8,
          feedback: "发布后修改",
        },
      }),
      /已发布成绩/,
    );
    console.log(
      "✓ Publishing requires every class participant and subject to finish; students only see their own published results, mistakes and knowledge weaknesses",
    );
    await cmd({ type: "assessment.publish", id: assessmentId, published: false });
    assert.equal((await loadState({ id: ids.student })).analytics.results.length, 0);
    const homeworkPaper = (
      await cmd({
        type: "paper.save",
        paper: {
          name: "练习册作业",
          kind: "HOMEWORK",
          subject: "生物",
          grade: "高一",
          instructions: "",
          layout: { paperSize: "A4", columns: 1 },
          items: [{ questionId: biology, score: 10, section: "作业" }],
        },
      })
    ).id;
    const homework = (
      await cmd({
        type: "assessment.save",
        assessment: {
          name: "晚间作业",
          kind: "HOMEWORK",
          reviewScope: "CLASSROOM",
          classroomIds: [classId],
          papers: [
            {
              paperId: homeworkPaper,
              subject: "生物",
              gradingMode: "SINGLE",
              arbitrationThreshold: 0,
              conversion: { enabled: false, bands: [] },
            },
          ],
        },
      })
    ).id;
    assert.equal(
      (await loadState(actor)).assessments.find((a) => a.id === homework)!.kind,
      "HOMEWORK",
    );
    await assert.rejects(
      cmd({
        type: "question.save",
        question: { ...changed, content: { ...changed.content, images: ["file:///etc/passwd"] } },
      }),
      /先上传/,
    );
    const foreignAsset = await db.platformAsset.create({
      data: {
        ownerId: ids.outside,
        name: "foreign",
        contentType: "image/png",
        path: "/tmp/foreign.png",
      },
    });
    await assert.rejects(
      cmd({
        type: "question.save",
        question: {
          ...changed,
          content: { ...changed.content, images: [`/api/platform/assets/${foreignAsset.id}`] },
        },
      }),
      /无权访问/,
    );
    const adminState = await loadState({ id: ids.admin });
    assert.equal(adminState.classrooms.length, 1);
    assert(adminState.questions.length >= 7);
    console.log(
      "✓ Homework uses the same domain with a distinct presentation kind; ownership checks reject arbitrary image paths and foreign assets; administrator has teacher visibility",
    );
    const otherClass = (
      await cmd({ type: "classroom.save", classroom: { name: "二班", grade: "高一" } })
    ).id;
    const otherStudent = (
      await cmd({
        type: "student.save",
        student: {
          classroomId: otherClass,
          name: "丙",
          studentNumber: "000010",
          userId: ids.student2,
        },
      })
    ).id;
    const sharedAssessment = (
      await cmd({
        type: "assessment.save",
        assessment: {
          name: "跨班考试",
          kind: "EXAM",
          reviewScope: "CLASSROOM",
          classroomIds: [classId, otherClass],
          papers: [
            {
              paperId: bio.id,
              subject: "生物",
              gradingMode: "SINGLE",
              arbitrationThreshold: 0,
              conversion: { enabled: false, bands: [] },
            },
          ],
        },
      })
    ).id;
    const foreignSubmission = (
      await cmd({
        type: "submission.save",
        submission: {
          assessmentId: sharedAssessment,
          paperId: bio.id,
          studentId: otherStudent,
          kind: "WORKBOOK",
          sourceFiles: [],
          answers: bio.items.map((i) => ({ itemId: i.id, text: "丙答案", images: [] })),
        },
      })
    ).id;
    assert(
      !(await loadState({ id: ids.second })).submissions.some((s) => s.id === foreignSubmission),
    );
    await assert.rejects(
      executeCommand(
        { id: ids.second },
        {
          type: "review.save",
          review: {
            submissionId: foreignSubmission,
            itemId: bio.items[0].id,
            round: "FIRST",
            score: 8,
            feedback: "跨班越权",
          },
        },
      ),
      /无权访问/,
    );
    // Class-scoped arrangements do not configure or freeze student IDs.
    await assert.rejects(cmd({ type: "student.delete", id: lateStudent }), /无权访问/);
    await cmd({ type: "assessment.publish", id: assessmentId, published: true });
    console.log(
      "✓ Shared reviewers cannot read or grade another class, and class-scoped arrangements follow the class roster",
    );
    const unboundClass = (
      await cmd({ type: "classroom.save", classroom: { name: "补绑定验收班", grade: "高一" } })
    ).id;
    await db.teachingAssignment.create({
      data: {
        userId: ids.teacher,
        role: "SUBJECT_TEACHER",
        classroomId: unboundClass,
        subject: "生物",
      },
    });
    const unboundStudent = (
      await cmd({
        type: "student.save",
        student: {
          classroomId: unboundClass,
          name: "已考试未注册",
          studentNumber: "000020",
          userId: null,
        },
      })
    ).id;
    const unboundAssessment = (
      await cmd({
        type: "assessment.save",
        assessment: {
          name: "补绑定历史考试",
          kind: "EXAM",
          reviewScope: "CLASSROOM",
          classroomIds: [unboundClass],
          papers: [
            {
              paperId: bio.id,
              subject: "生物",
              gradingMode: "SINGLE",
              arbitrationThreshold: 0,
              conversion: { enabled: false, bands: [] },
            },
          ],
        },
      })
    ).id;
    const unboundSubmission = (
      await cmd({
        type: "submission.save",
        submission: {
          assessmentId: unboundAssessment,
          paperId: bio.id,
          studentId: unboundStudent,
          kind: "WORKBOOK",
          sourceFiles: [],
          answers: bio.items.map((item) => ({ itemId: item.id, text: "完成", images: [] })),
        },
      })
    ).id;
    for (const item of bio.items)
      await cmd({
        type: "review.save",
        review: {
          submissionId: unboundSubmission,
          itemId: item.id,
          round: "FIRST",
          score: 9,
          feedback: "已完成历史评分",
        },
      });
    await cmd({ type: "assessment.publish", id: unboundAssessment, published: true });
    const boundAccount = await db.user.create({
      data: {
        id: "post-exam-account",
        name: "已考试未注册",
        email: "post-exam@test.invalid",
        role: "STUDENT",
      },
    });
    assert.equal((await loadState({ id: boundAccount.id })).assessments.length, 0);
    await cmd({
      type: "student.save",
      student: {
        id: unboundStudent,
        classroomId: unboundClass,
        name: "已考试未注册",
        studentNumber: "000020",
        userId: boundAccount.id,
      },
    });
    const boundState = await loadState({ id: boundAccount.id });
    assert.equal(
      boundState.analytics.results.find((row) => row.assessmentId === unboundAssessment)!.total,
      9,
    );
    assert.equal(boundState.submissions[0].studentId, unboundStudent);
    await assert.rejects(
      cmd({
        type: "student.save",
        student: {
          id: unboundStudent,
          classroomId: unboundClass,
          name: "改名",
          studentNumber: "000020",
          userId: boundAccount.id,
        },
      }),
      /身份不能更改/,
    );
    await assert.rejects(
      cmd({
        type: "student.save",
        student: {
          id: unboundStudent,
          classroomId: unboundClass,
          name: "已考试未注册",
          studentNumber: "000021",
          userId: boundAccount.id,
        },
      }),
      /身份不能更改/,
    );
    await assert.rejects(
      cmd({
        type: "student.save",
        student: {
          id: unboundStudent,
          classroomId: unboundClass,
          name: "已考试未注册",
          studentNumber: "000020",
          userId: null,
        },
      }),
      /身份不能更改/,
    );
    await assert.rejects(
      cmd({
        type: "student.save",
        student: {
          id: unboundStudent,
          classroomId: unboundClass,
          name: "已考试未注册",
          studentNumber: "000020",
          userId: ids.student,
        },
      }),
      /身份不能更改/,
    );
    console.log(
      "✓ An existing unbound examinee can bind a newly registered student account and read their historic published scores; rename, renumber, rebind and unbind remain blocked",
    );
    const bankCount = await db.question.count();
    const localQuestion = {
      type: "SUBJECTIVE" as const,
      subject: "数学",
      grade: "初中四年级",
      difficulty: 0.5,
      knowledgeTags: ["写作"],
      content: {
        stem: "自主编写一道解答题",
        options: [],
        answers: [],
        parts: [],
        images: [],
        explanation: "",
        rubric: "按步骤评分",
      },
    };
    const localPaperId = (
      await cmd({
        type: "paper.save",
        paper: {
          name: "独立题目与逐题双评",
          kind: "EXAM",
          subject: "数学",
          grade: "初中四年级",
          instructions: "",
          layout: {
            paperSize: "A3",
            orientation: "landscape",
            columns: 4,
            fontFamily: "NSimSun",
            textBlocks: [{ id: "reading", text: "阅读材料", beforeQuestionId: "local-question" }],
          },
          items: [
            { questionId: "local-question", question: localQuestion, score: 10, section: "解答" },
            { questionId: "local-single", question: localQuestion, score: 10, section: "单评" },
          ],
        },
      })
    ).id;
    assert.equal(
      await db.question.count(),
      bankCount,
      "Paper-only questions must not create bank records",
    );
    const localPaper = (await loadState(actor)).papers.find((p) => p.id === localPaperId)!;
    const doubleItem = localPaper.items[0],
      singleItem = localPaper.items[1];
    const localExamId = (
      await cmd({
        type: "assessment.save",
        assessment: {
          name: "逐题规则验证",
          kind: "EXAM",
          reviewScope: "CLASSROOM",
          classroomIds: [classId],
          papers: [
            {
              paperId: localPaperId,
              subject: "数学",
              gradingMode: "SINGLE",
              arbitrationThreshold: 0,
              questionRules: {
                [doubleItem.id]: { doubleReview: true, arbitrationEnabled: true, maxDifference: 2 },
                [singleItem.id]: {
                  doubleReview: false,
                  arbitrationEnabled: false,
                  maxDifference: 0,
                },
              },
              conversion: { enabled: false, bands: [] },
            },
          ],
        },
      })
    ).id;
    const localSubmissionId = (
      await cmd({
        type: "submission.save",
        submission: {
          assessmentId: localExamId,
          paperId: localPaperId,
          studentId: student1,
          kind: "WORKBOOK",
          sourceFiles: [],
          answers: [],
        },
      })
    ).id;
    const scoreLocal = (
      userId: string,
      round: "FIRST" | "SECOND" | "ARBITRATION",
      score: number,
      itemId = doubleItem.id,
    ) =>
      executeCommand(
        { id: userId },
        {
          type: "review.save",
          review: {
            submissionId: localSubmissionId,
            itemId,
            round,
            score,
            feedback: `评分 ${score}`,
          },
        },
      );
    await scoreLocal(ids.second, "SECOND", 1);
    await assert.rejects(scoreLocal(ids.second, "FIRST", 9), /不同教师/);
    await scoreLocal(ids.teacher, "FIRST", 8);
    await scoreLocal(ids.teacher, "FIRST", 9);
    assert.equal(
      await db.reviewEvent.count({
        where: { submissionId: localSubmissionId, itemId: doubleItem.id },
      }),
      3,
    );
    assert.equal(
      await db.review.count({ where: { submissionId: localSubmissionId, itemId: doubleItem.id } }),
      2,
    );
    await scoreLocal(ids.arbiter, "ARBITRATION", 7);
    await scoreLocal(ids.teacher, "FIRST", 6, singleItem.id);
    await assert.rejects(scoreLocal(ids.second, "SECOND", 6, singleItem.id), /无需第二评/);
    const localState = await loadState(actor),
      localResult = localState.analytics.results.find(
        (r) => r.assessmentId === localExamId && r.studentId === student1,
      )!;
    assert.equal(localResult.subjects[0].grades[0].score, 8);
    assert.equal(localResult.subjects[0].grades[1].score, 6);
    assert.equal(
      localState.reviewHistory!.filter((r) => r.submissionId === localSubmissionId).length,
      5,
    );
    assert.equal((await loadState({ id: ids.student })).reviewHistory!.length, 0);
    console.log(
      "✓ Paper-only questions/text, A3 landscape four-column storage, second-before-first, independent teachers, per-question arbitration, closer-score average and immutable revisions pass",
    );
    const bankBefore = await db.question.count({ where: { ownerId: ids.teacher } });
    await db.question.createMany({
      data: Array.from({ length: 10000 }, (_, i) => ({
        id: `scale-${String(i).padStart(5, "0")}`,
        ownerId: ids.teacher,
        ...localQuestion,
        content: { ...localQuestion.content, stem: `规模验证 ${i}` },
        createdAt: new Date(2000000000000 + i * 1000),
        updatedAt: new Date(2000000000000 + i * 1000),
      })),
    });
    await db.question.update({
      where: { id: "scale-00000" },
      data: { updatedAt: new Date(2100000000000) },
    });
    const { queryQuestionBank } = await import("../src/server/platform/question-bank");
    const { loadPageState } = await import("../src/server/platform/page-state");
    const { questionStatistics } = await import("../src/server/platform/question-stats");
    const started = performance.now();
    const page1 = await queryQuestionBank(
        db,
        (await loadState(actor, db, { questionLimit: 0 })).actor,
        {},
      ),
      page2 = await queryQuestionBank(
        db,
        { id: ids.teacher, role: "TEACHER", name: "Teacher" },
        {},
        2,
      );
    assert.equal(page1.total, bankBefore + 10000);
    assert.equal(page1.questions.length, 20);
    assert.equal(page1.questions[0].id, "scale-09999");
    assert.equal(page1.questions[19].id, "scale-09980");
    assert.equal(page2.questions[0].id, "scale-09979");
    assert(
      !page1.questions.some((q) => q.id === "scale-00000"),
      "Editing an old question must not move it to the top",
    );
    const isolated = await queryQuestionBank(
      db,
      { id: ids.outside, role: "TEACHER", name: "Outside" },
      { q: "规模验证" },
    );
    assert.equal(isolated.total, 0);
    const filtered = await queryQuestionBank(
      db,
      { id: ids.teacher, role: "TEACHER", name: "Teacher" },
      { q: "规模验证 9999", grade: "初中四年级" },
    );
    assert.equal(filtered.total, 1);
    const pageState = await loadPageState(actor, "exams");
    assert.equal(pageState.questions.length, 0);
    assert.equal(pageState.questionCount, bankBefore + 10000);
    const stats = await questionStatistics(db, ids.teacher);
    assert.equal(stats.total, bankBefore + 10000);
    assert(stats.tags.some((t) => t.tag === "写作" && t.count === 10000));
    console.log(
      `✓ 10,000-question bank: 20-row descending creation pagination, edit stability, search/grade, ownership, exact statistics, zero bank bodies in workbench state (${Math.round(performance.now() - started)}ms)`,
    );
    console.log("Platform non-AI domain acceptance passed.");
  } finally {
    globalDb.paperDb = previous;
    await db.$disconnect();
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await sql.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
