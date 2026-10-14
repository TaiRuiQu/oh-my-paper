export function isPdfUpload(file: { name: string; type?: string }) {
  if (file.type === "application/pdf") return true;
  if (file.type?.startsWith("image/")) return false;
  return /\.pdf$/i.test(file.name);
}

// PDFs contain a whole student's scan; image pages are grouped explicitly.
export function groupStudentUploads<T extends { name: string; type?: string }>(
  files: T[],
  imagesPerStudent?: number,
): T[][] {
  if (!files.length) return [];
  const pdfs = files.filter(isPdfUpload);
  if (pdfs.length && pdfs.length !== files.length)
    throw new Error("PDF 和图片请分开提交；每个 PDF 对应一位学生。");
  if (pdfs.length) return files.map((file) => [file]);
  const count = imagesPerStudent ?? files.length;
  if (!Number.isInteger(count) || count < 1 || count > 20 || files.length % count)
    throw new Error("图片数量须为每位学生页数的整数倍，请补齐或移除多余图片。");
  return Array.from({ length: files.length / count }, (_, index) =>
    files.slice(index * count, (index + 1) * count),
  );
}
