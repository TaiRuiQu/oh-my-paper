import "server-only";
import { randomUUID } from "node:crypto";
import { AppError } from "./errors";
import { redactErrorText } from "@/lib/error-message";

export type LogContext = Record<string, string | number | boolean | null | undefined>;
type ErrorRecord = Record<string, unknown>;
function record(value: unknown): ErrorRecord {
  return value !== null && typeof value === "object" ? (value as ErrorRecord) : {};
}
function token(value: unknown) {
  return typeof value === "string" && /^[\w.-]{1,100}$/.test(value) ? value : undefined;
}
function secrets(extra: readonly string[]) {
  return [
    ...extra,
    ...Object.entries(process.env)
      .filter(([key]) => /(?:SECRET|PASSWORD|TOKEN|API_KEY|DATABASE_URL|ENCRYPTION_KEY)/i.test(key))
      .map(([, value]) => value ?? ""),
  ];
}
export function validationDetails(error: unknown) {
  const issues = record(error).issues;
  if (!Array.isArray(issues)) return undefined;
  return issues.slice(0, 8).map((issue) => ({
    path: Array.isArray(issue.path)
      ? issue.path
          .map((part: unknown) => (typeof part === "number" ? part : (token(part) ?? "[field]")))
          .join(".")
      : "",
    code: token(issue.code) ?? "invalid_value",
  }));
}
export function describeError(error: unknown, extraSecrets: readonly string[] = []) {
  const sensitive = secrets(extraSecrets),
    visited = new Set<unknown>();
  const chain: {
    type: string;
    message: string;
    code?: string;
    statusCode?: number;
    finishReason?: string;
    validation?: ReturnType<typeof validationDetails>;
    stack?: string;
  }[] = [];
  for (let value = error; value && !visited.has(value) && chain.length < 6;) {
    visited.add(value);
    const item = record(value),
      type = token(item.name) ?? (value instanceof Error ? "Error" : typeof value);
    const validation = validationDetails(value);
    let message =
      typeof item.message === "string"
        ? item.message
        : typeof value === "string"
          ? value
          : "A non-Error value was thrown.";
    // These error messages can embed SQL, generated answers or invalid input values.
    if (validation || /TypeValidation|NoObjectGenerated|InvalidToolInput/.test(type))
      message = "Output or input does not match its schema.";
    else if (/Prisma/.test(type))
      message = "Database operation failed; inspect its error code and call site.";
    else if (type === "SyntaxError" || /JSONParse/.test(type)) message = "Invalid JSON syntax.";
    const statusCode =
      typeof item.statusCode === "number"
        ? item.statusCode
        : typeof item.status === "number"
          ? item.status
          : undefined;
    chain.push({
      type,
      message: redactErrorText(message, sensitive),
      code: token(item.code),
      statusCode,
      finishReason: token(item.finishReason),
      validation,
      stack:
        typeof item.stack === "string"
          ? item.stack
              .split("\n")
              .filter((line) => /^\s+at /.test(line))
              .slice(0, 10)
              .map((line) => redactErrorText(line, sensitive))
              .join("\n")
          : undefined,
    });
    value = item.cause ?? item.lastError;
  }
  const api = chain.find((item) => item.statusCode && item.type === "AI_APICallError");
  const problem = chain.find((item) => item.validation);
  const appError = error instanceof AppError ? error : null;
  const node = chain.find((item) => item.code);
  const timeout = chain.find(
    (item) =>
      /Timeout|Abort/.test(item.type) ||
      ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(item.code ?? ""),
  );
  let code = appError?.code ?? (api?.statusCode ? `AI_HTTP_${api.statusCode}` : undefined);
  let message = appError?.message;
  if (!message && api) {
    const messages: Record<number, string> = {
      400: "AI 接口拒绝了请求参数，请检查模型能力和接口配置（HTTP 400）。",
      401: "AI 接口认证失败，请检查 API key 和认证配置（HTTP 401）。",
      403: "AI 接口拒绝访问，请检查密钥权限或账号权限（HTTP 403）。",
      404: "AI 接口或模型不存在，请检查 Base URL 和模型名称（HTTP 404）。",
      429: "AI 接口请求受限，请检查额度或稍后重试（HTTP 429）。",
    };
    message =
      messages[api.statusCode!] ?? `AI 接口请求失败（HTTP ${api.statusCode}），请稍后重试。`;
  }
  if (!message && timeout) {
    code = "TIMEOUT";
    message = "请求超时或已中断，请检查网络和超时设置后重试。";
  }
  if (
    !message &&
    (problem || chain.some((item) => /NoObjectGenerated|TypeValidation|JSONParse/.test(item.type)))
  ) {
    code = "SCHEMA_INVALID";
    message = `数据格式不符合要求${problem?.validation?.length ? `：${problem.validation.map((issue) => `${issue.path || "根字段"}（${issue.code}）`).join("、")}` : "，AI 未返回符合结构的 JSON"}。`;
  }
  if (!message) {
    const nodeMessages: Record<string, string> = {
      ENOENT: "所需文件或处理工具不存在，请检查文件和工具安装路径。",
      EACCES: "无法读取或写入文件，请检查目录权限。",
      EPERM: "文件操作权限不足，请检查目录权限。",
      ENOSPC: "磁盘空间不足，无法保存文件。",
      ECONNREFUSED: "服务连接被拒绝，请检查数据库或服务是否启动。",
      ENOTFOUND: "无法解析服务域名，请检查服务地址和网络。",
      ECONNRESET: "服务连接被中断，请稍后重试。",
      P1000: "数据库认证失败，请检查数据库账号配置。",
      P1001: "无法连接数据库，请检查 PostgreSQL 是否启动。",
      P2021: "数据库缺少所需表，请执行数据库迁移。",
      P2022: "数据库缺少所需字段，请执行数据库迁移。",
      P2002: "数据已存在，唯一字段不能重复。",
      P2003: "关联的数据不存在或不属于当前记录。",
    };
    message = node?.code ? nodeMessages[node.code] : undefined;
    code ??= node?.code ?? chain[0]?.type;
  }
  if (!message)
    message = `操作失败：${chain[0]?.message ?? "未知异常"}（${chain[0]?.type ?? "UnknownError"}）。`;
  return {
    code: code || "INTERNAL_ERROR",
    message: redactErrorText(message, sensitive),
    causes: chain,
  };
}
export function logEvent(event: string, fields: LogContext = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), level: "info", event, ...fields }));
}
export function logError(
  event: string,
  error: unknown,
  context: LogContext = {},
  options: { secrets?: readonly string[]; level?: "error" | "warn" } = {},
) {
  const id = randomUUID(),
    details = describeError(error, options.secrets),
    level = options.level ?? "error";
  const output = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    errorId: id,
    ...context,
    ...details,
  });
  if (level === "warn") console.warn(output);
  else console.error(output);
  return { errorId: id, code: details.code, message: details.message };
}
