import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { loadEnvironment } from "./load-env.mjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { executeCommand, loadState } from "../src/server/platform/service";
import { saveImage, readOwnedAsset } from "../src/server/platform/assets";
import { uploadScans } from "../src/server/platform/scan-upload";
import { generateCardTemplate, choiceBubbles } from "../src/server/platform/cards";
import { renderCardSvg } from "../src/server/platform/print";
import type { CardTemplate, Paper } from "../src/server/platform/types";

async function main() {
  loadEnvironment();
  const teacherId = `scan-acceptance-${randomUUID()}`;
  const schema = `scan_test_${randomUUID().replaceAll("-", "")}`;
  const connectionString = process.env.DATABASE_URL!;
  const sql = new Client({ connectionString });
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }),
  });
  const globalDb = globalThis as typeof globalThis & { paperDb?: PrismaClient };
  const previous = globalDb.paperDb;
  globalDb.paperDb = db;
  const temp = await mkdtemp(join(tmpdir(), "omp-scan-acceptance-"));
  const report: string[] = [];
  try {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    for (const folder of (await readdir("prisma/migrations")).filter((f) => /^\d/.test(f)).sort())
      await sql.query(await readFile(join("prisma/migrations", folder, "migration.sql"), "utf8"));
    report.push("所有迁移在独立 PostgreSQL schema 应用成功");
    await db.user.create({
      data: {
        id: teacherId,
        name: "扫描验收教师",
        email: `${teacherId}@example.test`,
        role: "TEACHER",
      },
    });
    const actor = { id: teacherId };
    const command = (input: unknown) => executeCommand(actor, input);
    const classroomId = (
      await command({ type: "classroom.save", classroom: { name: "扫描验收班", grade: "高一" } })
    ).id;
    const students = [];
    for (const [index, studentNumber] of ["012345", "654321"].entries()) {
      const studentId = (
        await command({
          type: "student.save",
          student: { classroomId, studentNumber, name: `验收学生${index + 1}` },
        })
      ).id;
      students.push({ id: studentId, studentNumber });
    }
    const material = await saveImage(
      teacherId,
      await sharp({ create: { width: 200, height: 100, channels: 3, background: "#eee" } })
        .png()
        .toBuffer(),
      "题目配图.png",
    );
    assert.equal(
      (await readOwnedAsset(teacherId, material.url)).buffer.length,
      material.buffer.length,
    );
    const questionIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = (
        await command({
          type: "question.save",
          question: {
            type: i === 0 ? "SINGLE" : i === 1 ? "MULTIPLE" : "SUBJECTIVE",
            subject: "数学",
            grade: "高一",
            difficulty: 0.5,
            knowledgeTags: ["函数"],
            content: {
              stem: `第 ${i + 1} 题：求解 $x^2=4$`,
              options: i < 2 ? ["A", "B", "C", "D"].map((label) => ({ label, text: label })) : [],
              answers: i === 0 ? ["B"] : i === 1 ? ["A", "C"] : ["2 或 -2"],
              explanation: "平方根",
              rubric: "过程及结果",
              parts: [],
              images: i === 5 ? [material.url] : [],
            },
          },
        })
      ).id;
      questionIds.push(id);
    }
    const paperId = (
      await command({
        type: "paper.save",
        paper: {
          name: "扫描验收数学",
          kind: "EXAM",
          subject: "数学",
          grade: "高一",
          instructions: "完成各题",
          layout: { paperSize: "A4", columns: 1 },
          items: questionIds.map((questionId) => ({ questionId, score: 10, section: "数学" })),
        },
      })
    ).id;
    let state = await loadState(actor);
    const paper = state.papers.find((p) => p.id === paperId)!;
    const template = generateCardTemplate(paper);
    assert.ok(template.layout.pageCount > 1, "验收必须覆盖多页卡");
    const templateId = (
      await command({
        type: "template.save",
        template: {
          paperId,
          name: template.name,
          subject: template.subject,
          layout: template.layout,
        },
      })
    ).id;
    template.id = templateId;
    const assessmentId = (
      await command({
        type: "assessment.save",
        assessment: {
          name: "扫描验收考试",
          kind: "EXAM",
          classroomIds: [classroomId],
          papers: [
            {
              paperId,
              subject: "数学",
              gradingMode: "SINGLE",
              arbitrationThreshold: 2,
              conversion: { enabled: false, bands: [] },
            },
          ],
        },
      })
    ).id;
    function form(kind = "CARD") {
      const f = new FormData();
      f.set("assessmentId", assessmentId);
      f.set("paperId", paperId);
      f.set("kind", kind);
      if (kind === "CARD") f.set("templateId", templateId);
      return f;
    }
    async function filled(
      card: CardTemplate,
      p: Paper,
      studentNumber: string,
      page: number,
    ): Promise<Buffer> {
      const n = card.layout.studentNumber;
      let fills = Array.from(
        studentNumber,
        (value, column) =>
          `<circle cx="${(n.x + column * n.cellWidth) * 794}" cy="${(n.y + Number(value) * n.cellHeight) * 1123}" r="5" fill="black"/>`,
      ).join("");
      for (const region of card.layout.regions.filter((r) => r.page === page)) {
        const item = p.items.find((item) => item.id === region.itemId)!;
        fills += choiceBubbles(region)
          .filter((b) => item.snapshot.content.answers.includes(b.value))
          .map((b) => `<circle cx="${b.x}" cy="${b.y}" r="7" fill="black"/>`)
          .join("");
      }
      // Replace remote materials with self-contained data URIs for raster test fixtures.
      const svg = renderCardSvg(card, page)
        .replaceAll(material.url, `data:image/png;base64,${material.buffer.toString("base64")}`)
        .replace("</svg>", `${fills}</svg>`);
      const input = join(temp, `${studentNumber}-${page}-source.png`),
        output = join(temp, `${studentNumber}-${page}.png`);
      await sharp(Buffer.from(svg)).png().toFile(input);
      if (studentNumber === "012345") {
        await promisify(execFile)(resolve(".venv/bin/python"), [
          "-c",
          "import cv2,numpy as np,sys; im=cv2.imread(sys.argv[1]); h,w=im.shape[:2]; src=np.float32([[0,0],[w,0],[w,h],[0,h]]); dst=np.float32([[100,50],[890,120],[820,1250],[40,1160]]); out=cv2.warpPerspective(im,cv2.getPerspectiveTransform(src,dst),(1000,1300),borderValue=(255,255,255)); cv2.imwrite(sys.argv[2],out)",
          input,
          output,
        ]);
      } else await sharp(input).rotate(180).png().toFile(output);
      return readFile(output);
    }
    const allCards: File[] = [];
    for (const student of students)
      for (let page = 1; page <= template.layout.pageCount; page++)
        allCards.push(
          new File(
            [new Uint8Array(await filled(template, paper, student.studentNumber, page))],
            `${student.studentNumber}-${page}.png`,
            { type: "image/png" },
          ),
        );
    const batch = form();
    for (const file of allCards) batch.append("files", file);
    const imported = await uploadScans(teacherId, batch);
    assert.equal(imported.imported, 2, JSON.stringify(imported.issues));
    assert.deepEqual(imported.issues, []);
    state = await loadState(actor);
    const persisted = state.submissions.filter((s) => s.assessmentId === assessmentId);
    assert.equal(persisted.length, 2);
    for (const submission of persisted) {
      assert.equal(submission.answers.length, paper.items.length);
      assert.equal(submission.sourceFiles.length, template.layout.pageCount);
      assert.equal(submission.answers.find((a) => a.itemId === paper.items[0].id)?.text, "B");
      assert.equal(submission.answers.find((a) => a.itemId === paper.items[1].id)?.text, "A,C");
      for (const answer of submission.answers) {
        assert.equal(answer.images.length, 1);
        assert.match(answer.images[0], /^\/api\/platform\/assets\//);
        const stored = await readOwnedAsset(teacherId, answer.images[0]);
        assert.ok(stored.buffer.length > 0);
        assert.ok((await sharp(stored.buffer).metadata()).width! > 600);
      }
    }
    report.push("批量透视/旋转卡 → 六位卡号匹配两个学生 → 全题切片与来源图片持久化");
    const absent = form();
    absent.append(
      "files",
      new File(
        [
          new Uint8Array(
            await sharp({ create: { width: 794, height: 1123, channels: 3, background: "white" } })
              .png()
              .toBuffer(),
          ),
        ],
        "missing-markers.png",
        { type: "image/png" },
      ),
    );
    const failed = await uploadScans(teacherId, absent);
    assert.equal(failed.imported, 0);
    assert.ok(failed.issues[0].error.includes("REGISTRATION_MARKS_MISSING"));
    assert.ok(failed.issues[0].sourceUrl);
    assert.ok(
      !failed.issues[0].error.includes("Traceback") &&
        !failed.issues[0].error.includes("/tmp/") &&
        !failed.issues[0].error.includes("scan.py"),
    );
    report.push("缺失定位点 → 可追踪原图的失败 issue");
    const incomplete = form();
    incomplete.append("files", allCards[0]);
    const rejected = await uploadScans(teacherId, incomplete);
    assert.equal(rejected.imported, 0);
    assert.ok(rejected.issues.some((issue) => issue.error.includes("不完整")));
    report.push("缺少多页卡后续页 → 不保存不完整答卷");
    const invalidOrder = form();
    invalidOrder.append("files", allCards[0]);
    invalidOrder.append("files", allCards[template.layout.pageCount]);
    const badOrder = await uploadScans(teacherId, invalidOrder);
    assert.equal(badOrder.imported, 0);
    assert.ok(badOrder.issues.length > 0);
    report.push("错误页顺序或跨学生拼接 → 不生成完整答卷");
    const reversePages = form();
    for (const file of allCards.slice(0, template.layout.pageCount).reverse())
      reversePages.append("files", file);
    const reversed = await uploadScans(teacherId, reversePages);
    assert.equal(reversed.imported, 0);
    assert.ok(
      reversed.issues.some((issue) => issue.error.includes("CARD_PAGE_ORDER")),
      JSON.stringify(reversed),
    );
    report.push("同一学生多页倒序 → 通过印刷识别码拒收");
    // A second assessment uses the same paper to verify free-form worksheet scanning.
    const workAssessmentId = (
      await command({
        type: "assessment.save",
        assessment: {
          name: "非规范页面验收",
          kind: "EXAM",
          classroomIds: [classroomId],
          papers: [
            {
              paperId,
              subject: "数学",
              gradingMode: "SINGLE",
              arbitrationThreshold: 2,
              conversion: { enabled: false, bands: [] },
            },
          ],
        },
      })
    ).id;
    const workbook = new FormData();
    workbook.set("assessmentId", workAssessmentId);
    workbook.set("paperId", paperId);
    workbook.set("kind", "WORKBOOK");
    workbook.set("studentId", students[0].id);
    workbook.set(
      "boxes",
      JSON.stringify(
        paper.items.map((item, index) => ({
          itemId: item.id,
          page: 1,
          x: 0.1,
          y: 0.05 + index * 0.14,
          width: 0.7,
          height: 0.12,
        })),
      ),
    );
    workbook.append(
      "files",
      new File(
        [
          new Uint8Array(
            await sharp({
              create: { width: 1000, height: 1400, channels: 3, background: "#fafafa" },
            })
              .png()
              .toBuffer(),
          ),
        ],
        "workbook.png",
        { type: "image/png" },
      ),
    );
    const cropped = await uploadScans(teacherId, workbook);
    assert.equal(cropped.imported, 1, JSON.stringify(cropped.issues));
    assert.deepEqual(cropped.issues, []);
    const work = (await loadState(actor)).submissions.find(
      (s) => s.assessmentId === workAssessmentId,
    )!;
    assert.equal(work.kind, "WORKBOOK");
    assert.equal(work.answers.length, 6);
    assert.equal((work.alignment?.["1"] as { manual: boolean }).manual, true);
    const image = await readOwnedAsset(teacherId, work.answers[0].images[0]);
    assert.equal((await sharp(image.buffer).metadata()).width, 700);
    report.push("非规范练习册 → 人工坐标裁切 → 学生与题目绑定持久化");
    await command({
      type: "review.save",
      review: {
        submissionId: persisted[0].id,
        itemId: paper.items[0].id,
        round: "FIRST",
        score: 10,
        feedback: "已阅卷保护",
      },
    });
    const partial = form();
    for (const file of allCards) partial.append("files", file);
    const partialResult = await uploadScans(teacherId, partial);
    assert.equal(partialResult.imported, 1);
    assert.ok(partialResult.issues.some((issue) => issue.error.includes("已评阅")));
    report.push("批量重传中已评阅答卷保护 → 返回单个issue且其他学生正常保存");
    const lateId = (
      await command({
        type: "student.save",
        student: { classroomId, studentNumber: "000099", name: "后加入学生" },
      })
    ).id;
    const lateForm = form();
    lateForm.set("studentId", lateId);
    lateForm.append("files", allCards[0]);
    await assert.rejects(uploadScans(teacherId, lateForm), /不在本次考试/);
    report.push("考试后新增学生 → 扫描层遵守参试名单快照");
    console.log(JSON.stringify({ ok: true, evidence: report }, null, 2));
  } finally {
    const assets = await db.platformAsset.findMany({
      where: { ownerId: teacherId },
      select: { id: true, path: true },
    });
    await Promise.all(assets.map((asset) => rm(asset.path, { force: true })));
    await rm(temp, { recursive: true, force: true });
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
