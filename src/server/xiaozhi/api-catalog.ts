import "server-only";
import { z } from "zod";
import { commandSchema } from "@/server/platform/schemas";
import { adminCommandSchema } from "@/server/platform/admin";
import { aiRequestSchema } from "@/contracts/platform-ai";
import { replayPaperSchema } from "@/contracts/revision-papers";
import { accountImportSchema, importResultSchema } from "@/contracts/account-import";
import { RequestError } from "@/server/http/errors";

export const apiCatalog = [
  {
    path: "/api/platform",
    methods: ["GET", "POST"],
    description:
      "完整的授权数据；POST 统一业务命令。大数据先 select，如 classrooms、papers、assessments、actor。",
  },
  {
    path: "/api/platform/{area}/state",
    methods: ["GET"],
    description:
      "area=workspace/homework/exams/questions/learning/admin；query scope=reviewing 用于独立阅卷范围。",
  },
  {
    path: "/api/platform/{area}/commands",
    methods: ["POST"],
    description:
      "area=questions/papers/classrooms/assessments/templates/submissions/reviews；统一业务命令。",
  },
  {
    path: "/api/platform/questions",
    methods: ["GET"],
    description:
      "分页检索题库。query: id 或 stats=1；或 page, subject, grade, type, q, searchMode=keyword/semantic。",
  },
  {
    path: "/api/platform/analytics",
    methods: ["GET"],
    description:
      "授权范围内成绩、知识点、错题。query: assessmentId,classroomId,studentId,kind=EXAM/HOMEWORK。",
  },
  {
    path: "/api/platform/ai",
    methods: ["GET", "POST"],
    description:
      "GET 本人的 jobs 和可用 models；POST 创建自主 AI 任务，立即返回 id，并不意味着完成。",
  },
  {
    path: "/api/platform/ai/{id}",
    methods: ["GET"],
    description: "读取本人 AI 任务的状态、结果与错误。",
  },
  {
    path: "/api/platform/ai/{id}/retry",
    methods: ["POST"],
    description: "重试本人失败的 AI 任务。",
  },
  {
    path: "/api/platform/admin",
    methods: ["GET", "POST"],
    description: "管理员读取模型/检索配置，执行账号、角色、教学权限、模型供应商和向量索引命令。",
  },
  {
    path: "/api/platform/templates",
    methods: ["POST"],
    description: "按试卷生成并保存答题卡模板。body: {paperId,presetId?}。",
  },
  {
    path: "/api/platform/revision-papers",
    methods: ["POST"],
    description: "保存错题原题重做题本。",
  },
  {
    path: "/api/platform/print",
    methods: ["GET"],
    description:
      "Word: paperId,format=docx；答题卡: templateId,format=svg,page；返回下载链接。PDF 请打开题本导出页打印。",
  },
  {
    path: "/api/platform/barcodes",
    methods: ["GET"],
    description: "生成班级考号条码标签。query: classroomId,copies=1..20；返回 pages。",
  },
  {
    path: "/api/platform/accounts/import",
    methods: ["GET", "POST", "PUT"],
    description:
      "GET 下载导入模板 query role=STUDENT/TEACHER,format=csv/xlsx,classroomId?；POST bodyText 为 CSV，query extension=csv,role,classroomId；PUT 提交结构化账号。POST query download=credentials 下载账号表。",
  },
  {
    path: "/api/platform/materials",
    methods: ["POST"],
    description:
      "multipart 上传图片或 PDF 为分页资产；界面附件自动执行此能力。fields: maxPages；files: file。",
  },
  {
    path: "/api/platform/assets",
    methods: ["POST"],
    description: "multipart 保存图片，files: file。已有附件可直接复用。",
  },
  {
    path: "/api/platform/assets/{id}",
    methods: ["GET"],
    description: "读取授权图片。查看内容请使用 view_image 工具。",
  },
  {
    path: "/api/platform/scan",
    methods: ["POST"],
    description:
      "multipart 扫描录入。fields: assessmentId,paperId,kind=CARD/WORKBOOK,templateId?,studentId?,boxes?（JSON）,sources（JSON 数组 {assetUrl}）；也可 files: files。",
  },
] as const;
export const progressEndpoints = [
  "/api/platform/ai/events",
  "/api/platform/ai/{id}/events",
  "/api/platform/admin/ai-progress",
];

/** An exact, canonical route allowlist: credentials can never follow an arbitrary URL. */
export function resolveWebsitePath(path: string, method: string) {
  if (
    progressEndpoints.some((pattern) =>
      new RegExp(`^${pattern.replace("{id}", "[a-zA-Z0-9_-]+")}$`).test(path),
    )
  )
    throw new RequestError(400, "实时事件接口由聊天界面订阅；查询任务请使用任务详情接口。");
  if (!/^\/api\/platform(?:\/[a-zA-Z0-9_-]+)*$/.test(path))
    throw new RequestError(400, "只能调用目录内的站内 API；参数请放在 query 中。");
  const entry = apiCatalog.find((entry) => {
    const pattern = entry.path.replace(/\{(?:id|area)\}/g, "[a-zA-Z0-9_-]+");
    return (
      new RegExp(`^${pattern}$`).test(path) && (entry.methods as readonly string[]).includes(method)
    );
  });
  if (!entry) throw new RequestError(400, "接口或请求方法不在网站功能目录中。");
  if (
    path.endsWith("/state") &&
    !/^\/api\/platform\/(workspace|homework|exams|questions|learning|admin)\/state$/.test(path)
  )
    throw new RequestError(400, "未知页面模块。");
  if (
    path.endsWith("/commands") &&
    !/^\/api\/platform\/(questions|papers|classrooms|assessments|templates|submissions|reviews)\/commands$/.test(
      path,
    )
  )
    throw new RequestError(400, "未知命令模块。");
  return entry;
}

export function describeApi(name: string) {
  // Describe individual operations rather than injecting the entire platform schema into every turn.
  const command = commandSchema.options.find((option) => option.shape.type.value === name);
  const admin = adminCommandSchema.options.find((option) => option.shape.type.value === name);
  const ai = aiRequestSchema.options.find((option) => option.shape.kind.value === name);
  const special: Record<string, z.ZodType> = {
    "revision-papers": replayPaperSchema,
    "accounts.import": accountImportSchema,
    "accounts.credentials": importResultSchema,
  };
  const schema = command ?? admin ?? ai ?? special[name];
  if (schema) return z.toJSONSchema(schema, { unrepresentable: "any", io: "input" });
  if (name === "operations")
    return {
      commands: commandSchema.options.map((option) => option.shape.type.value),
      admin: adminCommandSchema.options.map((option) => option.shape.type.value),
      aiTasks: aiRequestSchema.options.map((option) => option.shape.kind.value),
      other: Object.keys(special),
    };
  throw new RequestError(400, "参数说明不存在。先读取 operations 获取可用操作名。");
}

export function projectWebsiteData(data: unknown, select?: string, offset = 0, limit = 30) {
  let selected = data;
  if (select)
    for (const key of select.split(".")) {
      if (
        ["__proto__", "prototype", "constructor"].includes(key) ||
        !selected ||
        typeof selected !== "object" ||
        !Object.hasOwn(selected, key)
      )
        throw new RequestError(400, `响应中没有字段 ${select}。`);
      selected = (selected as Record<string, unknown>)[key];
    }
  const total = Array.isArray(selected) ? selected.length : undefined;
  if (Array.isArray(selected)) selected = selected.slice(offset, offset + limit);
  const serialized = JSON.stringify(selected);
  return serialized.length > 60000
    ? {
        truncated: true,
        preview: serialized.slice(0, 60000),
        total,
        hint: "使用 select 指定更深字段，或减小 limit；未返回的数据不能视为不存在。",
      }
    : { data: selected, total, offset, hasMore: total !== undefined && offset + limit < total };
}
