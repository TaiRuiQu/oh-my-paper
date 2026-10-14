import "server-only";
import type { DocumentUploadResult } from "@/contracts/uploads";
import { decodeUploadedPages, isPdfUpload } from "./uploaded-pages";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import sharp from "sharp";
import { getDb } from "@/server/db/client";
import { getStoragePaths } from "@/server/config/env";
import { AccessError, RequestError } from "@/server/http/errors";
import { loadState } from "./service";

export function assetId(url: string) {
  return /^\/api\/platform\/assets\/([a-f0-9-]{36})$/.exec(url)?.[1];
}

export async function saveImage(ownerId: string, input: Buffer, name: string) {
  if (isPdfUpload(input, ""))
    throw new RequestError(400, "配图只支持 PNG、JPEG 或 WebP；PDF 请从扫描材料入口上传。");
  if (input.length > 30_000_000) throw new RequestError(413, "每张图片不能超过 30 MB。");
  let buffer: Buffer;
  try {
    buffer = await sharp(input, { limitInputPixels: 50_000_000 }).rotate().png().toBuffer();
  } catch {
    throw new RequestError(400, "图片无法读取，请上传 PNG、JPEG 或 WebP。");
  }
  return persistImage(ownerId, buffer, name);
}
async function persistImage(ownerId: string, buffer: Buffer, name: string) {
  const id = randomUUID();
  const directory = join(getStoragePaths().storage, "platform-assets");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${id}.png`);
  await writeFile(path, buffer, { mode: 0o600 });
  try {
    await getDb().platformAsset.create({
      data: { id, ownerId, name: name.slice(0, 200), path, contentType: "image/png" },
    });
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
  return { id, url: `/api/platform/assets/${id}`, buffer };
}

export async function saveUploadedDocument(
  ownerId: string,
  input: Buffer,
  name: string,
  maxPages = 100,
): Promise<DocumentUploadResult> {
  const decoded = await decodeUploadedPages(input, name, maxPages);
  const pages: DocumentUploadResult["pages"] = [];
  try {
    for (const page of decoded) {
      const asset = await persistImage(ownerId, page.buffer, page.name);
      pages.push({
        id: asset.id,
        url: asset.url,
        name: page.name,
        size: page.buffer.length,
        page: page.page,
      });
    }
    return { id: pages[0].id, url: pages[0].url, pages, pageCount: pages.length };
  } catch (error) {
    const rows = await getDb().platformAsset.findMany({
      where: { id: { in: pages.map((page) => page.id) }, ownerId },
      select: { id: true, path: true },
    });
    await getDb().platformAsset.deleteMany({
      where: { id: { in: rows.map((row) => row.id) }, ownerId },
    });
    await Promise.all(rows.map((row) => rm(row.path, { force: true })));
    throw error;
  }
}

export async function readOwnedAsset(ownerId: string, url: string) {
  const id = assetId(url);
  if (!id) throw new RequestError(400, "图片引用无效。");
  const asset = await getDb().platformAsset.findUnique({ where: { id } });
  const user = await getDb().user.findUnique({ where: { id: ownerId }, select: { role: true } });
  if (!asset || (asset.ownerId !== ownerId && user?.role !== "ADMIN"))
    throw new AccessError(404, "图片不存在。");
  return { buffer: await readFile(asset.path), name: asset.name };
}

export async function accessibleAsset(userId: string, id: string) {
  const asset = await getDb().platformAsset.findUnique({ where: { id } });
  if (!asset) throw new AccessError(404, "图片不存在。");
  const url = `/api/platform/assets/${id}`;
  const state = await loadState({ id: userId });
  let accessible =
    state.actor.role === "ADMIN" ||
    asset.ownerId === userId ||
    state.submissions.some(
      (submission) =>
        submission.sourceFiles.includes(url) ||
        submission.answers.some(
          (answer) => answer.images.includes(url) || answer.sourcePage === url,
        ),
    ) ||
    state.papers.some((paper) =>
      paper.items.some((item) => item.snapshot.content.images.includes(url)),
    ) ||
    state.questions.some((question) => question.content.images.includes(url)) ||
    state.analytics.students.some((report) =>
      report.recommendations.some((question) => question.content.images.includes(url)),
    );
  if (!accessible) {
    const reportIds = new Set(
      state.analytics.students
        .filter((report) => report.wrongQuestions.length)
        .map((report) => report.studentId),
    );
    const jobs = await getDb().aiJob.findMany({
      where: { userId, kind: "RECOMMEND", status: "COMPLETED" },
      select: { result: true },
    });
    accessible = jobs.some((job) => {
      if (!job.result || typeof job.result !== "object" || Array.isArray(job.result)) return false;
      const result = job.result.result;
      if (
        !result ||
        typeof result !== "object" ||
        Array.isArray(result) ||
        typeof result.studentId !== "string" ||
        !reportIds.has(result.studentId) ||
        !Array.isArray(result.recommendations)
      )
        return false;
      return result.recommendations.some((rec) => {
        if (!rec || typeof rec !== "object" || Array.isArray(rec)) return false;
        const question = rec.question;
        if (!question || typeof question !== "object" || Array.isArray(question)) return false;
        const content = question.content;
        return (
          content &&
          typeof content === "object" &&
          !Array.isArray(content) &&
          Array.isArray(content.images) &&
          content.images.includes(url)
        );
      });
    });
  }
  if (!accessible) throw new AccessError(404, "图片不存在。");
  const root = resolve(getStoragePaths().storage, "platform-assets") + sep;
  if (!resolve(asset.path).startsWith(root)) throw new AccessError(404, "图片不存在。");
  return { buffer: await readFile(asset.path), contentType: asset.contentType };
}
