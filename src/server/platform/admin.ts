import "server-only";
import { managedAccountSchema } from "@/contracts/auth";
import { reasoningEffortSchema, responsesTransportSchema } from "@/contracts/ai-models";
import { createManagedAccount } from "@/server/auth/accounts";
import { z } from "zod";
import { teachingPermissionsCommandSchema } from "@/contracts/permissions";
import { getDb } from "@/server/db/client";
import { AccessError, RequestError } from "@/server/http/errors";
import { encryptApiKey } from "@/server/ai/credentials";
import {
  embeddingConfigurationSchema,
  loadSearchConfiguration,
  saveEmbeddingConfiguration,
  reindexQuestions,
} from "./search/configuration";

export const adminCommandSchema = z.discriminatedUnion("type", [
  teachingPermissionsCommandSchema,
  z.object({ type: z.literal("embedding.save"), embedding: embeddingConfigurationSchema }),
  z.object({ type: z.literal("embedding.reindex") }),
  z.strictObject({ type: z.literal("user.create"), user: managedAccountSchema }),
  z.object({
    type: z.literal("user.role"),
    id: z.string().min(1),
    role: z.enum(["ADMIN", "TEACHER", "STUDENT"]),
  }),
  z.object({
    type: z.literal("provider.delete"),
    id: z.string().min(1),
  }),
  z.object({
    type: z.literal("provider.save"),
    provider: z.object({
      id: z.string().optional(),
      name: z.string().trim().min(1).max(80),
      apiType: z.enum(["openai_chat", "openai_responses", "anthropic", "google"]),
      baseURL: z.url().refine((url) => /^https?:/.test(url), "使用 HTTP 或 HTTPS 地址。"),
      apiKey: z.string().min(1).max(4096).optional(),
      models: z
        .array(
          z.strictObject({
            name: z.string().trim().min(1).max(120),
            displayName: z.string().trim().max(120),
            reasoningEffort: reasoningEffortSchema.default("provider-default"),
          }),
        )
        .min(1)
        .max(30)
        .refine(
          (models) => new Set(models.map((model) => model.name)).size === models.length,
          "同一提供商的模型 ID 不能重复。",
        ),
      transportMode: responsesTransportSchema.default("http"),
      maxOutputTokens: z.number().int().min(1024).max(393216).default(16384),
    }),
  }),
]);

async function assertAdmin(id: string) {
  if ((await getDb().user.findUnique({ where: { id }, select: { role: true } }))?.role !== "ADMIN")
    throw new AccessError(403, "需要管理员权限。");
}

export async function loadAdmin(id: string) {
  await assertAdmin(id);
  const providers = await getDb().aiProvider.findMany({
    select: {
      id: true,
      name: true,
      apiType: true,
      baseURL: true,
      maxOutputTokens: true,
      transportMode: true,
      models: {
        select: { id: true, name: true, displayName: true, reasoningEffort: true },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });
  return { providers, ...(await loadSearchConfiguration()) };
}

export async function executeAdmin(id: string, input: z.infer<typeof adminCommandSchema>) {
  await assertAdmin(id);
  if (input.type === "embedding.save") return saveEmbeddingConfiguration(input.embedding);
  if (input.type === "embedding.reindex") return reindexQuestions();
  if (input.type === "user.create") return createManagedAccount(id, input.user);
  if (input.type === "provider.delete") {
    await getDb().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(490221)`;
      if ((await tx.user.findUnique({ where: { id }, select: { role: true } }))?.role !== "ADMIN")
        throw new AccessError(403, "需要管理员权限。");
      if (!(await tx.aiProvider.findUnique({ where: { id: input.id }, select: { id: true } })))
        throw new AccessError(404, "模型供应商不存在。");
      // AiModel cascades; model preferences become null and historical jobs are retained.
      await tx.aiProvider.delete({ where: { id: input.id } });
    });
    return { id: input.id };
  }
  if (input.type === "user.permissions") {
    await getDb().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(490221)`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(7240132026::bigint)::text`;
      if ((await tx.user.findUnique({ where: { id }, select: { role: true } }))?.role !== "ADMIN")
        throw new AccessError(403, "需要管理员权限。");
      if (
        (await tx.user.findUnique({ where: { id: input.id }, select: { role: true } }))?.role !==
        "TEACHER"
      )
        throw new RequestError(400, "只能为教师账号配置教学身份。");
      const classIds = [
        ...new Set(
          input.assignments.flatMap((row) => ("classroomId" in row ? [row.classroomId] : [])),
        ),
      ];
      if ((await tx.classroom.count({ where: { id: { in: classIds } } })) !== classIds.length)
        throw new RequestError(400, "班级不存在，请刷新后重新配置。");
      const cohorts = input.assignments.filter((row) => row.role === "GRADE_DIRECTOR");
      for (const scope of cohorts) {
        if (
          !(await tx.classroom.findFirst({
            where: { stage: scope.stage, cohort: scope.cohort },
            select: { id: true },
          }))
        )
          throw new RequestError(400, "届别不存在，请先创建该学段、该届别的班级。");
      }
      await tx.teachingAssignment.deleteMany({ where: { userId: input.id } });
      if (input.assignments.length)
        await tx.teachingAssignment.createMany({
          data: input.assignments.map((row) => ({ ...row, userId: input.id })),
        });
    });
    return { id: input.id };
  }
  if (input.type === "user.role") {
    await getDb().$transaction(async (tx) => {
      // Serialize role changes so two administrators cannot demote each other concurrently.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(490221)`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(7240132026::bigint)::text`;
      const actor = await tx.user.findUnique({ where: { id } });
      if (actor?.role !== "ADMIN") throw new AccessError(403, "需要管理员权限。");
      const user = await tx.user.findUnique({ where: { id: input.id } });
      if (!user) throw new AccessError(404, "账号不存在。");
      if (
        user.role === "ADMIN" &&
        input.role !== "ADMIN" &&
        (await tx.user.count({ where: { role: "ADMIN" } })) === 1
      )
        throw new RequestError(409, "至少保留一名管理员。");
      await tx.user.update({ where: { id: input.id }, data: { role: input.role } });
      if (user.role !== input.role)
        await tx.teachingAssignment.deleteMany({ where: { userId: input.id } });
    });
    return { id: input.id };
  }
  const data = input.provider;
  const existing = data.id ? await getDb().aiProvider.findUnique({ where: { id: data.id } }) : null;
  if (data.id && !existing) throw new AccessError(404, "模型供应商不存在。");
  if (!existing && !data.apiKey) throw new RequestError(400, "首次配置需要 API 密钥。");
  const provider = await getDb().$transaction(async (tx) => {
    const values = {
      name: data.name,
      apiType: data.apiType,
      baseURL: data.baseURL,
      maxOutputTokens: data.maxOutputTokens,
      transportMode: data.apiType === "openai_responses" ? data.transportMode : "http",
      encryptedApiKey: data.apiKey ? encryptApiKey(data.apiKey) : existing!.encryptedApiKey,
    };
    const saved = existing
      ? await tx.aiProvider.update({ where: { id: existing.id }, data: values })
      : await tx.aiProvider.create({ data: values });
    await tx.aiModel.deleteMany({
      where: { providerId: saved.id, name: { notIn: data.models.map((model) => model.name) } },
    });
    for (const { name, displayName, reasoningEffort } of data.models)
      await tx.aiModel.upsert({
        where: { providerId_name: { providerId: saved.id, name } },
        create: {
          providerId: saved.id,
          name,
          displayName,
          reasoningEffort,
          reasoningEfforts: ["default"],
          isPublic: true,
        },
        update: { displayName, reasoningEffort, isPublic: true },
      });
    return saved;
  });
  return { id: provider.id };
}
