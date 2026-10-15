export function redactErrorText(value: string, secrets: readonly string[] = []) {
  let text = value;
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length))
    text = text.replaceAll(secret, "[redacted]");
  return text
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"'<>]+/gi, (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
      } catch {
        return "[redacted URL]";
      }
    })
    .replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(
      /((?:["']?)(?:api[-_]?key|x-api-key|password|secret|authorization|access[-_]?token|refresh[-_]?token)(?:["']?)\s*[:=]\s*)(?:["'][^"']*["']|[^\s,;}]+)/gi,
      "$1[redacted]",
    )
    .slice(0, 2000);
}
export function clientErrorMessage(error: unknown, fallback = "操作失败，请重试。") {
  const source =
    error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  const message = redactErrorText(source);
  return message || fallback;
}
export function reportClientError(operation: string, error: unknown) {
  const message = clientErrorMessage(error);
  console.error(`[${operation}]`, {
    type: error instanceof Error ? error.name : typeof error,
    message,
    ...(error && typeof error === "object" && "digest" in error
      ? { digest: String(error.digest) }
      : {}),
  });
  return message;
}

export function taskErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.startsWith("Credit 余额为负")
    ? "Credit 余额为负，无法创建新任务。当前任务会继续完成，请联系管理员。"
    : fallback;
}
