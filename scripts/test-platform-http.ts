import { makeTextPdf } from "./pdf-test-fixtures";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import pg from "pg";
import sharp from "sharp";
import JSZip from "jszip";
import { hashPassword } from "better-auth/crypto";
import { loadEnvironment } from "./load-env.mjs";
import type { Analytics, PlatformCommand, PlatformState } from "../src/contracts/platform";

loadEnvironment();

async function main() {
  const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
  const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await sql.connect();
  const prefix = `http-${randomUUID()}`;
  const accounts: { id: string; cookie: string; role: string }[] = [];
  async function request(
    account: (typeof accounts)[number] | null,
    path: string,
    init?: RequestInit,
  ) {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${origin}${path}`, {
        ...init,
        headers: {
          Origin: origin,
          ...(account ? { Cookie: account.cookie } : {}),
          ...init?.headers,
        },
      });
      if (response.status !== 429 || !path.startsWith("/api/auth/") || attempt === 5)
        return response;
      const wait = Math.min(60, Math.max(1, Number(response.headers.get("retry-after") || 10)));
      console.log(`Authentication rate limit: retrying the same request after ${wait} seconds`);
      await response.arrayBuffer();
      await new Promise((resolve) => setTimeout(resolve, wait * 1000 + 500));
    }
  }
  async function command(account: (typeof accounts)[number], value: PlatformCommand) {
    const response = await request(account, "/api/platform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body as { id: string };
  }
  async function state(account: (typeof accounts)[number]) {
    const response = await request(account, "/api/platform");
    assert.equal(response.status, 200);
    return (await response.json()) as PlatformState;
  }
  try {
    if (process.env.APP_COMMIT_SHA) {
      const page = await request(null, "/login");
      assert.equal(page.status, 200);
      const html = await page.text();
      assert(html.includes(`data-commit="${process.env.APP_COMMIT_SHA}"`));
      const footer = html.match(/<small\b[^>]*class="site-version"[^>]*>([\s\S]*?)<\/small>/)?.[1];
      assert(footer?.replace(/<[^>]*>/g, "").includes(process.env.APP_COMMIT_SHA.slice(0, 6)));
    }
    assert.equal((await request(null, "/api/platform")).status, 401);
    for (const role of ["ADMIN", "TEACHER", "STUDENT", "STUDENT"]) {
      const id = randomUUID();
      const email = `${prefix}-${accounts.length}@example.invalid`;
      const password = "HttpAcceptance2026!";
      await sql.query(
        `INSERT INTO users (id, name, email, role, username, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [id, `${prefix}-${accounts.length}`, email, role, email],
      );
      await sql.query(
        `INSERT INTO accounts (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
         VALUES ($1, $2, $2, 'credential', $3, NOW(), NOW())`,
        [randomUUID(), id, await hashPassword(password)],
      );
      const response = await request(null, "/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.user.role, role);
      const cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      assert(cookie);
      accounts.push({ id, cookie, role });
    }
    const [admin, teacher, student, peer] = accounts;
    await sql.query("UPDATE users SET role='ADMIN' WHERE id=$1", [admin.id]);
    const promote = await request(admin, "/api/platform/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "user.role", id: teacher.id, role: "TEACHER" }),
    });
    assert.equal(promote.status, 200);
    assert.equal((await state(teacher)).actor.role, "TEACHER");
    assert.equal((await request(student, "/api/platform/admin")).status, 403);
    const denied = await request(student, "/api/platform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "classroom.save", classroom: { name: "越权", grade: "高一" } }),
    });
    assert.equal(denied.status, 403);
    const csrf = await request(teacher, "/api/platform", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://outside.invalid" },
      body: JSON.stringify({
        type: "classroom.save",
        classroom: { name: "伪请求", grade: "高一" },
      }),
    });
    assert.equal(csrf.status, 403);
    console.log(
      "✓ Real HTTP managed-account sign-in/session, administrator role assignment, student restrictions and mutation origin checks",
    );
    const traceId = randomUUID();
    const studentTraceId = randomUUID();
    const traceMarker = `private-trace-${prefix}`;
    for (const [id, userId, kind] of [
      [traceId, teacher.id, "IMPORT"],
      [studentTraceId, student.id, "RECOMMEND"],
    ])
      await sql.query(
        `INSERT INTO ai_jobs (id, "userId", kind, "modelId", status, input, events, "createdAt")
         VALUES ($1, $2, $3, 'http-trace-fixture', 'COMPLETED', '{}', $4, NOW())`,
        [
          id,
          userId,
          kind,
          JSON.stringify([{ type: "text", text: traceMarker, at: new Date().toISOString() }]),
        ],
      );
    assert.equal((await request(null, `/api/platform/ai/${traceId}`)).status, 401);
    for (const [account, ownId, foreignId] of [
      [teacher, traceId, studentTraceId],
      [student, studentTraceId, traceId],
    ] as const) {
      const detail = await request(account, `/api/platform/ai/${ownId}`);
      assert.equal(detail.status, 200);
      assert.equal(detail.headers.get("cache-control"), "private, no-store");
      assert.equal((await detail.json()).events[0].text, traceMarker);
      assert.equal((await request(account, `/api/platform/ai/${foreignId}`)).status, 404);
      assert.equal((await request(account, `/workspace/ai/${ownId}`)).status, 200);
      const hiddenPage = await request(account, `/workspace/ai/${foreignId}`);
      // Next.js can send the shell before notFound resolves, yielding a streamed 200.
      assert([200, 404].includes(hiddenPage.status));
      const hiddenHtml = await hiddenPage.text();
      assert(!hiddenHtml.includes(traceMarker));
      assert(hiddenHtml.includes("NEXT_HTTP_ERROR_FALLBACK;404") || hiddenPage.status === 404);
      const listing = await request(account, "/api/platform/ai");
      assert.equal(listing.status, 200);
      const listed = await listing.json();
      assert(listed.jobs.some((job: { id: string }) => job.id === ownId));
      assert(!listed.jobs.some((job: { id: string }) => job.id === foreignId));
      assert(listed.models.every((model: Record<string, unknown>) => !("providerName" in model)));
      assert.equal((await request(account, "/workspace/ai")).status, 200);
    }
    assert.equal((await request(admin, `/api/platform/ai/${traceId}`)).status, 404);
    assert.equal((await request(teacher, `/api/platform/ai/${randomUUID()}`)).status, 404);
    const importPage = await request(teacher, "/questions/import");
    assert.equal(importPage.status, 200);
    assert(!(await importPage.text()).includes(traceMarker));
    console.log(
      "✓ Dedicated AI trace pages and API preserve teacher/student ownership, reject foreign jobs and keep execution details off task pages; model choices omit providers",
    );
    const image = await sharp({
      create: { width: 200, height: 100, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const upload = new FormData();
    upload.set("file", new File([new Uint8Array(image)], "material.png", { type: "image/png" }));
    const assetResponse = await request(teacher, "/api/platform/assets", {
      method: "POST",
      body: upload,
    });
    assert.equal(assetResponse.status, 200);
    const asset = (await assetResponse.json()) as { url: string };
    assert.equal((await request(student, asset.url)).status, 404);
    const pdfUpload = new FormData();
    pdfUpload.set(
      "file",
      new File([new Uint8Array(makeTextPdf())], "试卷扫描.pdf", { type: "application/pdf" }),
    );
    const pdfResponse = await request(teacher, "/api/platform/materials", {
      method: "POST",
      body: pdfUpload,
    });
    assert.equal(pdfResponse.status, 200);
    const pdf = (await pdfResponse.json()) as {
      pageCount: number;
      pages: { url: string; page: number }[];
    };
    assert.equal(pdf.pageCount, 2);
    assert.deepEqual(
      pdf.pages.map((p) => p.page),
      [1, 2],
    );
    assert.equal((await request(teacher, pdf.pages[1].url)).status, 200);
    assert.equal((await request(student, pdf.pages[1].url)).status, 404);
    assert.equal(
      (await request(student, "/api/platform/materials", { method: "POST", body: pdfUpload }))
        .status,
      403,
    );
    const forbiddenPdf = await request(teacher, "/api/platform/assets", {
      method: "POST",
      body: pdfUpload,
    });
    assert.equal(forbiddenPdf.status, 400);
    const limitedPdf = new FormData();
    limitedPdf.set(
      "file",
      new File([new Uint8Array(makeTextPdf())], "试卷.pdf", { type: "application/pdf" }),
    );
    limitedPdf.set("maxPages", "1");
    assert.equal(
      (await request(teacher, "/api/platform/materials", { method: "POST", body: limitedPdf }))
        .status,
      413,
    );
    console.log(
      "✓ Scanned-material PDF upload returns ordered private pages; decoration assets reject PDF; teacher permissions and page limits apply",
    );

    const classroomId = (
      await command(teacher, {
        type: "classroom.save",
        classroom: { name: "HTTP 验收班", grade: "高一" },
      })
    ).id;
    const studentId = (
      await command(teacher, {
        type: "student.save",
        student: { classroomId, name: "甲", studentNumber: "000001", userId: student.id },
      })
    ).id;
    const peerId = (
      await command(teacher, {
        type: "student.save",
        student: { classroomId, name: "乙", studentNumber: "000002", userId: peer.id },
      })
    ).id;
    const questionId = (
      await command(teacher, {
        type: "question.save",
        question: {
          type: "BLANK",
          subject: "数学",
          grade: "高一",
          difficulty: 0.5,
          knowledgeTags: ["方程"],
          content: {
            stem: "解方程 x + 2 = 3。",
            options: [],
            answers: ["1"],
            explanation: "两边减2",
            rubric: "答案1得10分",
            parts: [],
            images: [asset.url],
          },
        },
      })
    ).id;
    const paperId = (
      await command(teacher, {
        type: "paper.save",
        paper: {
          name: "HTTP 验收卷",
          kind: "EXAM",
          subject: "数学",
          grade: "高一",
          instructions: "认真作答",
          layout: { paperSize: "A4", columns: 1 },
          items: [{ questionId, score: 10, section: "填空" }],
        },
      })
    ).id;
    const assessmentId = (
      await command(teacher, {
        type: "assessment.save",
        assessment: {
          name: "HTTP 验收考试",
          kind: "EXAM",
          classroomIds: [classroomId],
          papers: [
            {
              paperId,
              subject: "数学",
              gradingMode: "SINGLE",
              arbitrationThreshold: 0,
              conversion: { enabled: false, bands: [] },
            },
          ],
        },
      })
    ).id;
    const templateResponse = await request(teacher, "/api/platform/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperId }),
    });
    assert.equal(templateResponse.status, 200, await templateResponse.clone().text());
    const templateId = ((await templateResponse.json()) as { id: string }).id;
    const card = await request(teacher, `/api/platform/print?templateId=${templateId}`);
    assert.equal(card.status, 200);
    assert.equal(card.headers.get("content-type"), "application/pdf");
    assert(
      Buffer.from(await card.arrayBuffer())
        .subarray(0, 5)
        .toString() === "%PDF-",
    );
    const cardSvg = await request(
      teacher,
      `/api/platform/print?templateId=${templateId}&format=svg`,
    );
    assert.equal(cardSvg.status, 200);
    assert((await cardSvg.text()).includes("六位学号"));
    const printed = await request(teacher, `/api/platform/print?paperId=${paperId}`);
    assert.equal(printed.status, 200);
    assert.equal(printed.headers.get("content-type"), "application/pdf");
    assert(printed.headers.get("content-disposition")?.startsWith("attachment;"));
    assert(
      Buffer.from(await printed.arrayBuffer())
        .subarray(0, 5)
        .toString() === "%PDF-",
    );
    const word = await request(teacher, `/api/platform/print?paperId=${paperId}&format=docx`);
    assert.equal(word.status, 200);
    const zip = await JSZip.loadAsync(await word.arrayBuffer());
    assert((await zip.file("word/document.xml")!.async("string")).includes("x + 2 = 3"));
    assert.equal((await request(peer, `/api/platform/print?paperId=${paperId}`)).status, 404);
    assert.equal((await request(null, `/api/platform/print?paperId=${paperId}`)).status, 401);
    assert.equal(
      (await request(teacher, `/api/platform/print?templateId=${templateId}&format=docx`)).status,
      400,
    );
    const paper = (await state(teacher)).papers.find((paper) => paper.id === paperId)!;
    for (const [id, score] of [
      [studentId, 4],
      [peerId, 10],
    ] as const) {
      const submissionId = (
        await command(teacher, {
          type: "submission.save",
          submission: {
            assessmentId,
            paperId,
            studentId: id,
            kind: "WORKBOOK",
            sourceFiles: [asset.url],
            answers: [{ itemId: paper.items[0].id, text: "作答", images: [asset.url] }],
          },
        })
      ).id;
      await command(teacher, {
        type: "review.save",
        review: {
          submissionId,
          itemId: paper.items[0].id,
          round: "FIRST",
          score,
          feedback: score === 10 ? "正确" : "注意移项",
        },
      });
    }
    assert.equal((await state(student)).analytics.results.length, 0);
    await command(teacher, { type: "assessment.publish", id: assessmentId, published: true });
    const learning = await state(student);
    assert.equal(learning.analytics.results.length, 1);
    assert.equal(learning.analytics.results[0].total, 4);
    assert.equal(learning.analytics.results[0].rank, 2);
    assert.equal(learning.analytics.students[0].wrongQuestions.length, 1);
    assert.equal((await request(student, asset.url)).status, 200);
    assert.equal(learning.classrooms[0].students.length, 1);
    const practiceUpload = new FormData();
    practiceUpload.set(
      "file",
      new File([new Uint8Array(image)], "practice-diagram.png", { type: "image/png" }),
    );
    const practiceAssetResponse = await request(teacher, "/api/platform/assets", {
      method: "POST",
      body: practiceUpload,
    });
    assert.equal(practiceAssetResponse.status, 200);
    const practiceAsset = (await practiceAssetResponse.json()) as { url: string };
    assert.equal((await request(student, practiceAsset.url)).status, 404);
    await command(teacher, {
      type: "question.save",
      question: {
        type: "BLANK",
        subject: "数学",
        grade: "高一",
        difficulty: 0.5,
        knowledgeTags: ["方程"],
        content: {
          stem: "另一道方程练习，参照配图。",
          options: [],
          answers: ["2"],
          explanation: "解方程",
          rubric: "答案正确",
          parts: [],
          images: [practiceAsset.url],
        },
      },
    });
    assert.equal(
      (await request(student, practiceAsset.url)).status,
      200,
      "A recommended question's diagram must be readable by its student",
    );
    assert.equal(
      (await request(peer, practiceAsset.url)).status,
      404,
      "A peer with no matching weakness must not read another student's recommended diagram",
    );
    console.log(
      "✓ HTTP asset ownership, reusable question → paper → template/print → student submission → manual grade → published private learning report with peer rank",
    );
    const laterAssessment = (
      await command(teacher, {
        type: "assessment.save",
        assessment: {
          name: "另一次考试",
          kind: "EXAM",
          classroomIds: [classroomId],
          papers: [
            {
              paperId,
              subject: "数学",
              gradingMode: "SINGLE",
              arbitrationThreshold: 0,
              conversion: { enabled: false, bands: [] },
            },
          ],
        },
      })
    ).id;
    for (const id of [studentId, peerId]) {
      const submissionId = (
        await command(teacher, {
          type: "submission.save",
          submission: {
            assessmentId: laterAssessment,
            paperId,
            studentId: id,
            kind: "WORKBOOK",
            sourceFiles: [],
            answers: [{ itemId: paper.items[0].id, text: "1", images: [] }],
          },
        })
      ).id;
      await command(teacher, {
        type: "review.save",
        review: {
          submissionId,
          itemId: paper.items[0].id,
          round: "FIRST",
          score: 10,
          feedback: "正确",
        },
      });
    }
    await command(teacher, { type: "assessment.publish", id: laterAssessment, published: true });
    const scoped = async (account: typeof teacher, exam: string) => {
      const response = await request(
        account,
        `/api/platform/analytics?assessmentId=${exam}&studentId=${studentId}`,
      );
      assert.equal(response.status, 200);
      return (await response.json()) as Analytics;
    };
    for (const account of [teacher, student]) {
      const firstExam = await scoped(account, assessmentId);
      const secondExam = await scoped(account, laterAssessment);
      assert.equal(firstExam.knowledge[0].accuracy, 0.4);
      assert.equal(secondExam.knowledge[0].accuracy, 1);
      assert.equal(firstExam.students[0].subjects[0].maximum, 10);
      assert.equal(firstExam.students[0].wrongQuestions.length, 1);
      assert.equal(secondExam.students[0].wrongQuestions.length, 0);
      assert.equal(
        firstExam.results[0].rank,
        2,
        "Filtering to one student must preserve official peer rank",
      );
    }
    assert.equal(
      (await request(student, `/api/platform/analytics?studentId=${peerId}`)).status,
      404,
    );
    console.log(
      "✓ Teacher and student exam filters isolate knowledge, subject totals and wrong questions while preserving official joint ranks; foreign student scope rejected",
    );
    console.log("Platform HTTP acceptance passed.");
  } finally {
    const ids = accounts.map((account) => account.id);
    const assets = await sql.query('SELECT path FROM platform_assets WHERE "ownerId"=ANY($1)', [
      ids,
    ]);
    await sql.query('DELETE FROM platform_assets WHERE "ownerId"=ANY($1)', [ids]);
    await sql.query('DELETE FROM assessments WHERE "ownerId"=ANY($1)', [ids]);
    await sql.query('DELETE FROM ai_jobs WHERE "userId"=ANY($1)', [ids]);
    await sql.query("DELETE FROM users WHERE id=ANY($1)", [ids]);
    await Promise.all(
      assets.rows.map((asset: { path: string }) => rm(asset.path, { force: true })),
    );
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
