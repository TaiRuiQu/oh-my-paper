import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { loadEnvironment } from "./load-env.mjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { executeCommand, loadState } from "../src/server/platform/service";
import { saveImage, readOwnedAsset, saveUploadedDocument } from "../src/server/platform/assets";
import { uploadScans } from "../src/server/platform/scan-upload";
import { generateCardTemplate, choiceBubbles } from "../src/server/platform/cards";
import { resolveScanSources } from "../src/server/platform/scan-sources";
import { processCardScan } from "../src/server/platform/scan";
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
      await command({
        type: "classroom.save",
        classroom: { name: "扫描验收班", stage: "高中", cohort: "2027届" },
      })
    ).id;
    await db.teachingAssignment.create({
      data: { userId: actor.id, role: "SUBJECT_TEACHER", classroomId, subject: "数学" },
    });
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
          reviewScope: "CLASSROOM",
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
    async function form(kind = "CARD") {
      const f = new FormData();
      f.set("assessmentId", assessmentId);
      f.set(
        "rosterRevision",
        String(
          (await db.assessment.findUniqueOrThrow({ where: { id: assessmentId } })).rosterRevision,
        ),
      );
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
          `<circle cx="${(n.x + column * n.cellWidth) * card.layout.width}" cy="${(n.y + Number(value) * n.cellHeight) * card.layout.height}" r="5" fill="black"/>`,
      ).join("");
      for (const region of card.layout.regions.filter((r) => r.page === page)) {
        const item = p.items.find((item) => item.id === region.itemId)!;
        fills += choiceBubbles(region, card.layout)
          .filter((b) => item.snapshot.content.answers.includes(b.value))
          .map((b) => `<circle cx="${b.x}" cy="${b.y}" r="7" fill="black"/>`)
          .join("");
      }
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
    const batch = await form();
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
        const region = template.layout.regions.find((entry) => entry.itemId === answer.itemId)!;
        const crop = await sharp(stored.buffer).metadata();
        assert.equal(
          crop.width,
          Math.round((region.x + region.width) * template.layout.width) -
            Math.round(region.x * template.layout.width),
        );
        assert.equal(
          crop.height,
          Math.round((region.y + region.height) * template.layout.height) -
            Math.round(region.y * template.layout.height),
        );
      }
    }
    report.push("批量透视/旋转卡 → 六位卡号匹配两个学生 → 全题切片与来源图片持久化");
    const absent = await form();
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
    const incomplete = await form();
    incomplete.append("files", allCards[0]);
    const rejected = await uploadScans(teacherId, incomplete);
    assert.equal(rejected.imported, 0);
    assert.ok(rejected.issues.some((issue) => issue.error.includes("不完整")));
    report.push("缺少多页卡后续页 → 不保存不完整答卷");
    const invalidOrder = await form();
    invalidOrder.append("files", allCards[0]);
    invalidOrder.append("files", allCards[template.layout.pageCount]);
    const badOrder = await uploadScans(teacherId, invalidOrder);
    assert.equal(badOrder.imported, 0);
    assert.ok(badOrder.issues.length > 0);
    report.push("错误页顺序或跨学生拼接 → 不生成完整答卷");
    const reversePages = await form();
    for (const file of allCards.slice(0, template.layout.pageCount).reverse())
      reversePages.append("files", file);
    const reversed = await uploadScans(teacherId, reversePages);
    assert.equal(reversed.imported, 0);
    assert.ok(
      reversed.issues.some((issue) => issue.error.includes("CARD_PAGE_ORDER")),
      JSON.stringify(reversed),
    );
    report.push("同一学生多页倒序 → 通过印刷识别码拒收");
    const workAssessmentId = (
      await command({
        type: "assessment.save",
        assessment: {
          name: "非规范页面验收",
          kind: "EXAM",
          reviewScope: "CLASSROOM",
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
    workbook.set(
      "rosterRevision",
      String(
        (await db.assessment.findUniqueOrThrow({ where: { id: workAssessmentId } })).rosterRevision,
      ),
    );
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
    const pdfPath = join(temp, "答题卡扫描.pdf");
    const pdfImages = [];
    for (let page = 1; page <= template.layout.pageCount; page++) {
      const pagePath = join(temp, `pdf-source-${page}.png`);
      await writeFile(pagePath, Buffer.from(await allCards[page - 1].arrayBuffer()));
      pdfImages.push(pagePath);
    }
    await promisify(execFile)(resolve(".venv/bin/python"), [
      "-c",
      "from PIL import Image; import sys; pages=[Image.open(p).convert('RGB') for p in sys.argv[2:]]; pages[0].save(sys.argv[1], 'PDF', save_all=True, append_images=pages[1:], resolution=300.0, quality=100)",
      pdfPath,
      ...pdfImages,
    ]);
    const pdfBuffer = await readFile(pdfPath),
      pdfForm = await form();
    pdfForm.append(
      "files",
      new File([new Uint8Array(pdfBuffer)], "答题卡扫描.pdf", { type: "application/pdf" }),
    );
    const pdfImport = await uploadScans(teacherId, pdfForm);
    assert.equal(pdfImport.imported, 1, JSON.stringify(pdfImport.issues));
    assert.deepEqual(pdfImport.issues, []);
    const importedPdf = (await loadState(actor)).submissions.find(
      (s) => s.id === pdfImport.ids[0],
    )!;
    assert.equal(importedPdf.sourceFiles.length, template.layout.pageCount);
    assert.equal(importedPdf.answers.length, paper.items.length);
    for (const answer of importedPdf.answers) {
      const item = paper.items.find((item) => item.id === answer.itemId)!;
      if (["SINGLE", "MULTIPLE"].includes(item.snapshot.type))
        assert.equal(answer.text, item.snapshot.content.answers.join(","));
    }
    report.push("多页 PDF 答题卡 → 按页顺序栅格化 → 考号匹配、全题裁切、选择题识别与答卷保存");
    const document = await saveUploadedDocument(teacherId, pdfBuffer, "预览扫描.pdf");
    const prepared = await form();
    prepared.set("sources", JSON.stringify(document.pages.map((page) => ({ assetUrl: page.url }))));
    const preparedImport = await uploadScans(teacherId, prepared);
    assert.equal(preparedImport.imported, 1, JSON.stringify(preparedImport.issues));
    const preparedSub = (await loadState(actor)).submissions.find(
      (s) => s.id === preparedImport.ids[0],
    )!;
    assert.deepEqual(
      preparedSub.sourceFiles,
      document.pages.map((page) => page.url),
    );
    const unknownUser = `outside-${randomUUID()}`;
    await db.user.create({
      data: {
        id: unknownUser,
        name: "外部教师",
        email: `${unknownUser}@test.invalid`,
        role: "TEACHER",
      },
    });
    await assert.rejects(resolveScanSources(unknownUser, prepared), /不存在/);
    const workbookPdf = new FormData();
    workbookPdf.set("assessmentId", workAssessmentId);
    workbookPdf.set(
      "rosterRevision",
      String(
        (await db.assessment.findUniqueOrThrow({ where: { id: workAssessmentId } })).rosterRevision,
      ),
    );
    workbookPdf.set("paperId", paperId);
    workbookPdf.set("kind", "WORKBOOK");
    workbookPdf.set("studentId", students[0].id);
    workbookPdf.set(
      "boxes",
      JSON.stringify(
        paper.items.map((item, index) => ({
          itemId: item.id,
          page: 2,
          x: 0.1,
          y: 0.05 + index * 0.14,
          width: 0.7,
          height: 0.12,
        })),
      ),
    );
    workbookPdf.set(
      "sources",
      JSON.stringify(document.pages.map((page) => ({ assetUrl: page.url }))),
    );
    const pdfWork = await uploadScans(teacherId, workbookPdf);
    assert.equal(pdfWork.imported, 1, JSON.stringify(pdfWork.issues));
    const pdfWorkSub = (await loadState(actor)).submissions.find((s) => s.id === pdfWork.ids[0])!;
    assert(pdfWorkSub.answers.every((a) => a.box?.page === 2));
    assert.equal(pdfWorkSub.sourceFiles.length, document.pageCount);
    report.push("PDF 逐页预览资产复用 → 练习册第二页人工切题 → 完整保存；他人 PDF 页面引用被拒绝");

    const multiRegions = [
      { itemId: paper.items[0].id, page: 2, x: 0.05, y: 0.05, width: 0.3, height: 0.1 },
      { itemId: paper.items[0].id, page: 1, x: 0.05, y: 0.2, width: 0.5, height: 0.2 },
      ...paper.items.slice(1).map((item, index) => ({
        itemId: item.id,
        page: 2,
        x: 0.1,
        y: 0.35 + index * 0.1,
        width: 0.7,
        height: 0.08,
      })),
    ];
    workbookPdf.set("boxes", JSON.stringify(multiRegions));
    const multiImport = await uploadScans(teacherId, workbookPdf);
    assert.equal(multiImport.imported, 1, JSON.stringify(multiImport.issues));
    const multi = (await loadState(actor)).submissions.find((s) => s.id === multiImport.ids[0])!;
    assert.equal(multi.answers.length, paper.items.length);
    const multiAnswer = multi.answers.find((a) => a.itemId === paper.items[0].id)!;
    assert.equal(multiAnswer.images.length, 2);
    assert.equal(multiAnswer.box?.page, 2);
    assert.deepEqual(multi.alignment?.workbookRegions, multiRegions);
    const cropSize = await Promise.all(
      multiAnswer.images.map(async (url) => {
        const id = url.split("/").at(-1)!;
        const asset = await db.platformAsset.findUniqueOrThrow({ where: { id } });
        return sharp(await readFile(asset.path)).metadata();
      }),
    );
    assert(cropSize[0].width! < cropSize[1].width!);
    report.push(
      "同一道题跨页多区域 → 按教师指定顺序合并全部裁图 → 一题一份作答及有序区域记录持久保存",
    );

    await command({
      type: "review.save",
      review: {
        expectedVersion:
          (
            await db.review.findUnique({
              where: {
                submissionId_itemId_round: {
                  submissionId: persisted[0].id,
                  itemId: paper.items[0].id,
                  round: "FIRST",
                },
              },
              select: { version: true },
            })
          )?.version ?? 0,
        submissionId: persisted[0].id,
        itemId: paper.items[0].id,
        round: "FIRST",
        score: 10,
        feedback: "已阅卷保护",
      },
    });
    const partial = await form();
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
    const lateForm = await form();
    lateForm.set("studentId", lateId);
    for (const file of allCards.slice(0, template.layout.pageCount)) lateForm.append("files", file);
    await assert.rejects(uploadScans(teacherId, lateForm), /应考名单/);
    await command({
      type: "assessment.roster.update",
      id: assessmentId,
      expectedRevision: (await db.assessment.findUniqueOrThrow({ where: { id: assessmentId } }))
        .rosterRevision,
      reason: "确认后加入学生参加本次考试",
      addStudentIds: [lateId],
    });
    lateForm.set(
      "rosterRevision",
      String(
        (await db.assessment.findUniqueOrThrow({ where: { id: assessmentId } })).rosterRevision,
      ),
    );
    const lateResult = await uploadScans(teacherId, lateForm);
    assert.equal(lateResult.imported, 1, JSON.stringify(lateResult.issues));
    assert.equal(
      (await db.scanSubmission.findUniqueOrThrow({ where: { id: lateResult.ids[0] } })).studentId,
      lateId,
    );
    report.push("参试快照保持不变 → 后加入学生默认拒绝录入，经明确调整本次名单后按新版本录入");
    for (const size of ["A4", "A3"] as const)
      for (const orientation of ["portrait", "landscape"] as const) {
        const variant = generateCardTemplate({
          ...paper,
          items: paper.items.slice(0, 2),
          layout: { paperSize: size, orientation, columns: 4 },
        });
        const pixels = await filled(variant, paper, "654321", 1),
          source = join(temp, `${size}-${orientation}.png`);
        await import("node:fs/promises").then((fs) => fs.writeFile(source, pixels));
        const scan = await processCardScan({
          inputPath: source,
          template: variant,
          page: 1,
          outputDir: join(temp, `${size}-${orientation}-out`),
        });
        assert.equal(scan.studentNumber, "654321", `${size} ${orientation}`);
        for (const answer of scan.answers) {
          const item = paper.items.find((item) => item.id === answer.itemId)!;
          if (["SINGLE", "MULTIPLE"].includes(item.snapshot.type))
            assert.equal(answer.text, item.snapshot.content.answers.join(","));
        }
      }
    report.push("A4/A3 × 横向/纵向四栏：矩形框打印像素 → 考号及选项 OMR 全部正确");
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
