import "server-only";
import {
  defineTool,
  type ToolExecutionResult,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { z } from "zod";
import { getEnv } from "@/server/config/env";
import { getActor } from "@/server/platform/access";
import { getAiJob } from "@/server/platform/ai-jobs";
import { accessibleAsset, assetId } from "@/server/platform/assets";
import { AppError } from "@/server/errors";
import { RequestError } from "@/server/http/errors";
import { listSkills, readSkillResource } from "./skills";
import { describeApi, projectWebsiteData, resolveWebsitePath } from "./api-catalog";
import { sandboxInputSchema } from "@/server/ai/sandbox";
import type { createXiaozhiSandbox } from "./sandbox";

// Function-tool providers require an object at the root of the parameters schema.
const sandboxToolSchema = z
  .strictObject({
    code: sandboxInputSchema.options[0].shape.code.optional(),
    command: sandboxInputSchema.options[1].shape.command.optional(),
    images: sandboxInputSchema.options[0].shape.images,
    files: sandboxInputSchema.options[0].shape.files,
  })
  .refine(
    (input) => (input.code !== undefined) !== (input.command !== undefined),
    "code 与 command 必须且只能提供一个。",
  );

async function report<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    return {
      error: error instanceof AppError ? error.message : "网站操作失败，请检查参数或稍后重试。",
    };
  }
}

function tool<S extends z.ZodType, T>(definition: {
  description: string;
  inputSchema: S;
  execute: (input: z.output<S>, options: { abortSignal?: AbortSignal }) => Promise<T>;
  output?: (output: T) => ToolExecutionResult["output"];
  replay?: "safe" | "unsafe";
}) {
  return defineTool({
    name: "assigned_by_registry",
    description: definition.description,
    parameters: Type.Unsafe<z.output<S>>(
      z.toJSONSchema(definition.inputSchema, { io: "input", unrepresentable: "any" }),
    ),
    replay: definition.replay ?? "safe",
    executionMode: definition.replay === "unsafe" ? "sequential" : "parallel",
    execute: async (input, _api, context) => {
      const output = await definition.execute(definition.inputSchema.parse(input), {
        abortSignal: context.abortSignal,
      });
      return {
        output: definition.output?.(output) ?? [
          { type: "text" as const, text: JSON.stringify(output) },
        ],
        isError: !!(
          output &&
          typeof output === "object" &&
          ("error" in output || ("status" in output && Number(output.status) >= 400))
        ),
      };
    },
  });
}

export function createXiaozhiTools(
  userId: string,
  cookie: string | (() => Promise<string>),
  sandbox?: ReturnType<typeof createXiaozhiSandbox>,
) {
  const definitions = {
    describe_api: tool({
      description:
        "按操作名读取实际网站输入 schema，例如 question.save、paper.save、school.term.save、school.timetable.publish、teaching.plan.save、homework.issue、homework.submit、practice.start、practice.submit、practice.review.confirm、user.permissions、IMPORT、GRADE、PRACTICE_GRADE、revision-papers。operations 返回全部操作名。",
      inputSchema: z.object({ operation: z.string() }),
      execute: async ({ operation }) => report(async () => describeApi(operation)),
    }),
    website_request: tool({
      replay: "unsafe",
      description:
        "使用当前登录身份执行站内 HTTP API，权限与网页一致。按需读取 site-api 技能及对应参考文档，具体命令参数可用 describe_api 查询。JSON 用 body；CSV 用 bodyText；multipart 用 fields/files。GET 导出返回下载链接。select 用点分字段路径读取结果，数组用 offset/limit 分页。",
      inputSchema: z.object({
        path: z.string(),
        method: z.enum(["GET", "POST", "PUT"]),
        query: z.record(z.string(), z.string()).optional(),
        body: z.record(z.string(), z.unknown()).optional(),
        bodyText: z.string().max(2000000).optional(),
        fields: z.record(z.string(), z.string()).optional(),
        files: z
          .array(
            z.object({
              field: z.string(),
              assetUrl: z.string().regex(/^\/api\/platform\/assets\/[a-f0-9-]{36}$/),
              name: z.string().max(200).optional(),
            }),
          )
          .max(20)
          .optional(),
        select: z.string().max(300).optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(30),
      }),
      execute: async (input, { abortSignal }) =>
        report(async () => {
          await getActor(userId);
          resolveWebsitePath(input.path, input.method);
          const url = new URL(
            input.path,
            process.env.XIAOZHI_WEBSITE_URL ?? getEnv().BETTER_AUTH_URL,
          );
          for (const [key, value] of Object.entries(input.query ?? {}))
            url.searchParams.set(key, value);
          const headers = new Headers({
            Cookie: typeof cookie === "function" ? await cookie() : cookie,
            Origin: new URL(getEnv().BETTER_AUTH_URL).origin,
          });
          const bodyModes = [
            input.body !== undefined,
            input.bodyText !== undefined,
            input.fields !== undefined || input.files !== undefined,
          ].filter(Boolean).length;
          if (bodyModes > 1 || (input.method === "GET" && bodyModes))
            throw new RequestError(400, "请求体只能使用一种格式，GET 不能携带请求体。");
          let body: BodyInit | undefined;
          if (input.fields || input.files) {
            const form = new FormData();
            for (const [key, value] of Object.entries(input.fields ?? {})) form.set(key, value);
            for (const file of input.files ?? []) {
              const asset = await accessibleAsset(userId, assetId(file.assetUrl)!);
              form.append(
                file.field,
                new Blob([new Uint8Array(asset.buffer)], { type: asset.contentType }),
                file.name ?? "image.png",
              );
            }
            body = form;
          } else if (input.bodyText !== undefined) {
            headers.set("Content-Type", "text/csv");
            body = input.bodyText;
          } else if (input.body !== undefined) {
            headers.set("Content-Type", "application/json");
            body = JSON.stringify(input.body);
          }
          if (input.body?.type === "review.save")
            throw new RequestError(
              400,
              "小纸的 AI 评分必须通过 GRADE 任务保存，不能写成人工评阅。请创建 GRADE 自主任务。",
            );
          const response = await fetch(url, {
            method: input.method,
            headers,
            body,
            redirect: "error",
            cache: "no-store",
            signal: abortSignal
              ? AbortSignal.any([abortSignal, AbortSignal.timeout(120000)])
              : AbortSignal.timeout(120000),
          }).catch((cause) => {
            throw new RequestError(
              409,
              "网络中断，操作结果尚未确认。写操作可能已生效，请先查询目标记录，避免重复提交。",
              { cause },
            );
          });
          if (!response.headers.get("content-type")?.includes("application/json")) {
            await response.body?.cancel();
            if (!response.ok) return { status: response.status, error: "网站未返回可读取的响应。" };
            // Downloads are authenticated again when opened; do not persist binary bodies in chat history.
            if (input.method === "GET")
              return { status: response.status, downloadUrl: url.pathname + url.search };
            return {
              status: response.status,
              error: "此下载需要在账号导入页面保存，请打开 /admin/users。",
            };
          }
          const data: unknown = await response.json();
          return {
            status: response.status,
            ...(response.ok && input.method !== "GET" ? { mutationApplied: true } : {}),
            ...projectWebsiteData(
              data,
              response.ok && input.method === "GET" ? input.select : undefined,
              input.offset,
              input.limit,
            ),
          };
        }),
    }),
    list_skills: tool({
      description: "列出内置技能及当前用户编写的技能；按需加载，不是固定工作流。",
      inputSchema: z.object({}),
      execute: async () =>
        report(async () =>
          (await listSkills(userId)).map(({ id, name, description }) => ({
            id,
            name,
            description,
          })),
        ),
    }),
    read_skill: tool({
      description: "读取某个技能的完整指导。",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) =>
        report(async () => {
          const skill = (await listSkills(userId)).find((skill) => skill.id === id);
          if (!skill) throw new RequestError(400, "技能不存在。");
          return skill;
        }),
    }),
    read_skill_resource: tool({
      description: "按需读取技能目录中的 references 等文本资源；路径相对 SKILL.md 所在目录。",
      inputSchema: z.object({ id: z.string(), path: z.string().max(300) }),
      execute: ({ id, path }) => report(() => readSkillResource(userId, id, path)),
    }),
    wait_for_task: tool({
      description:
        "等待本人已提交的 AI 任务，最长 30 秒后返回最新状态。长任务可再次等待；必须核实 COMPLETED 后再继续依赖其结果的操作。",
      inputSchema: z.object({
        id: z.string(),
        seconds: z.number().int().min(1).max(30).default(20),
      }),
      execute: async ({ id, seconds }, { abortSignal }) =>
        report(async () => {
          const deadline = Date.now() + seconds * 1000;
          let job = await getAiJob(userId, id);
          while (["QUEUED", "RUNNING"].includes(job.status) && Date.now() < deadline) {
            abortSignal?.throwIfAborted();
            await new Promise((resolve) => setTimeout(resolve, 1000));
            job = await getAiJob(userId, id);
          }
          return {
            id: job.id,
            status: job.status,
            result: job.result,
            error: job.error,
            url: `/workspace/ai/${job.id}`,
            ...(job.practice ? { practice: job.practice } : {}),
          };
        }),
    }),
    view_image: tool({
      description: "查看用户附件或有权访问的题目/作答原图。",
      inputSchema: z.object({ url: z.string().regex(/^\/api\/platform\/assets\/[a-f0-9-]{36}$/) }),
      execute: async ({ url }) => {
        const asset = await accessibleAsset(userId, assetId(url)!);
        if (!["image/png", "image/jpeg", "image/webp"].includes(asset.contentType))
          throw new RequestError(400, "该附件不是图片。请在沙箱中按需读取或渲染原文件。");
        return { data: asset.buffer.toString("base64"), mediaType: asset.contentType };
      },
      output: (output) => [{ type: "image", mimeType: output.mediaType, data: output.data }],
    }),
  };
  const registered: ToolRegistration[] = Object.entries(definitions).map(([name, definition]) => ({
    ...definition,
    name,
  }));
  if (sandbox)
    registered.push({
      ...tool({
        description:
          "在会话的隔离 Linux 沙箱中执行 Python code 或 shell command（二选一）。用户附件原文件已只读挂载到消息给出的 /inputs 路径，不预先转页或压缩。按需要自行使用 pdfinfo、pdftotext、pdftoppm、Pillow、reportlab、pdfplumber、pypdf 等读取、渲染、裁剪或生成PDF。无网络或宿主文件访问；/workspace 文件在 worker 会话内保留，恢复后可从 /inputs 重建。每次最多60秒、512MiB内存、100MiB工作区。产物写入 /workspace/output/；images列出最多3个图像相对文件名，files列出最多3个PDF相对文件名（每文件最多8MiB，总产物最多24MiB），返回实际图像及授权下载资产URL。",
        inputSchema: sandboxToolSchema,
        execute: (input, { abortSignal }) =>
          sandbox.run(
            input.code !== undefined
              ? { code: input.code, images: input.images, files: input.files }
              : { command: input.command!, images: input.images, files: input.files },
            abortSignal,
          ),
        output: (output) => [
          {
            type: "text",
            text: JSON.stringify({
              ...output,
              images: output.images.map(({ name, url }) => ({ name, url })),
            }),
          },
          ...output.images.map((image) => ({
            type: "image" as const,
            mimeType: "image/png",
            data: image.data,
          })),
        ],
      }),
      name: "sandbox",
    });
  return registered;
}
