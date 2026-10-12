import { UPLOAD_LIMITS } from "@/contracts/exam-tasks";

export function mergeExamFiles(existing: File[], incoming: File[]) {
  const next = [...existing];
  for (const file of incoming) {
    if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) {
      throw new Error("请选择 PDF、JPG 或 PNG 文件。");
    }
    if (!file.size || file.size > UPLOAD_LIMITS.fileBytes) {
      throw new Error("单个文件需要大于 0 字节且不超过 40 MB。");
    }
    if (
      !next.some(
        (existing) =>
          existing.name === file.name &&
          existing.size === file.size &&
          existing.lastModified === file.lastModified,
      )
    )
      next.push(file);
  }
  if (next.length > UPLOAD_LIMITS.files) {
    throw new Error("每次最多上传 20 个文件。");
  }
  if (next.reduce((sum, file) => sum + file.size, 0) > UPLOAD_LIMITS.totalBytes) {
    throw new Error("每次上传总大小不能超过 100 MB。");
  }
  return next;
}

export function submitExamUpload({
  files,
  mode,
  generateAnswers,
  templateId,
  onProgress,
  onRequest,
}: {
  files: File[];
  mode: "parse" | "quick";
  generateAnswers: boolean;
  templateId?: string;
  onProgress: (percent: number) => void;
  onRequest: (request: XMLHttpRequest) => void;
}): Promise<string> {
  const data = new FormData();
  files.forEach((file) => data.append("files", file));
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onRequest(xhr);
    const params = new URLSearchParams({ mode, generateAnswers: String(generateAnswers) });
    if (templateId) params.set("templateId", templateId);
    xhr.open("POST", `/api/exams?${params}`);
    xhr.responseType = "json";
    xhr.timeout = 300_000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      xhr.status === 202
        ? resolve(xhr.response.task.id)
        : reject(new Error(xhr.response?.error ?? "上传失败，请重新提交。"));
    xhr.onerror = () => reject(new Error("网络连接失败，请检查网络后重试。"));
    xhr.ontimeout = () => reject(new Error("上传超时，请检查网络后重试。"));
    xhr.onabort = () => reject(new Error("上传已取消。"));
    xhr.send(data);
  });
}
