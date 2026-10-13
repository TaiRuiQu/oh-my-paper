import { UPLOAD_LIMITS } from "@/contracts/exam-tasks";
import { taskModelSelectionSchema, type TaskModelSelection } from "@/contracts/user-ai";

export function validateUploadBatch(files: File[]) {
  if (files.length > UPLOAD_LIMITS.files)
    throw new Error("每次最多上传 20 个文件，包含标准答案文件。");
  if (files.reduce((sum, file) => sum + file.size, 0) > UPLOAD_LIMITS.totalBytes)
    throw new Error("每次上传总大小不能超过 100 MB，包含标准答案文件。");
}

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
  answerFiles = [],
  models = {},
  onProgress,
  onRequest,
  endpoint = "/api/exams",
  resultKey = "task",
}: {
  files: File[];
  answerFiles?: File[];
  models?: TaskModelSelection;
  endpoint?: string;
  resultKey?: "task" | "workflow";
  onProgress: (percent: number) => void;
  onRequest: (request: XMLHttpRequest) => void;
}): Promise<string> {
  validateUploadBatch([...files, ...answerFiles]);
  const data = new FormData();
  files.forEach((file) => data.append("files", file));
  answerFiles.forEach((file) => data.append("answerFiles", file));
  const choices = taskModelSelectionSchema.parse(models);
  if (Object.keys(choices).length) data.append("models", JSON.stringify(choices));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onRequest(xhr);
    xhr.open("POST", endpoint);
    xhr.responseType = "json";
    xhr.timeout = 300_000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      xhr.status === 202 && typeof xhr.response?.[resultKey]?.id === "string"
        ? resolve(xhr.response[resultKey].id)
        : reject(
            new Error(xhr.response?.error ?? `上传接口失败（HTTP ${xhr.status}），请重新提交。`),
          );
    xhr.onerror = () => reject(new Error("网络连接失败，请检查网络后重试。"));
    xhr.ontimeout = () => reject(new Error("上传超时，请检查网络后重试。"));
    xhr.onabort = () => reject(new Error("上传已取消。"));
    xhr.send(data);
  });
}
