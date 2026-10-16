import type { DocumentUploadResult, ScanUploadPage } from "@/contracts/uploads";
import { apiRequest } from "./http-client";
export async function uploadDocument(file: File, maxPages = 100): Promise<DocumentUploadResult> {
  const form = new FormData();
  form.set("file", file);
  form.set("maxPages", String(maxPages));
  return apiRequest<DocumentUploadResult>("/api/platform/materials", {
    method: "POST",
    body: form,
  });
}
export async function prepareScanPages(files: File[]): Promise<ScanUploadPage[]> {
  if (files.length > 100 || files.reduce((sum, file) => sum + file.size, 0) > 150_000_000)
    throw new Error("本批扫描文件最多 100 个、150 MB，请拆分后上传。");
  const pages: ScanUploadPage[] = [];
  for (const file of files) {
    if (pages.length >= 100) throw new Error("本批最多 100 页，请拆分 PDF 或减少文件后重试。");
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      const document = await uploadDocument(file, 100 - pages.length);
      pages.push(
        ...document.pages.map((page) => ({ name: page.name, size: page.size, assetUrl: page.url })),
      );
    } else pages.push(file);
    if (pages.length > 100) throw new Error("本批最多 100 页，请拆分 PDF 或减少文件后重试。");
  }
  if (pages.reduce((sum, page) => sum + page.size, 0) > 150_000_000)
    throw new Error("本批页面不能超过 150 MB，请拆分文件后重试。");
  return pages;
}
export function appendScanPages(form: FormData, pages: ScanUploadPage[]) {
  let index = 0;
  form.set(
    "sources",
    JSON.stringify(
      pages.map((page) => {
        if ("assetUrl" in page) return { assetUrl: page.assetUrl };
        form.append("files", page);
        return { fileIndex: index++ };
      }),
    ),
  );
}
