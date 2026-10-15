import "server-only";
import type { AccountCredentials } from "@/contracts/auth";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { AccessError, RequestError } from "@/server/http/errors";
import { commandSchema } from "./schemas";
import { getActor, teacher } from "./access";
import type { Actor } from "./types";
import type { CommandContext } from "./commands/types";
export { getActor } from "./access";
export { loadState } from "./queries";
export type { CommandContext } from "./commands/types";
import { executeQuestionsCommand } from "./commands/questions";
import { executePapersCommand } from "./commands/papers";
import { executeClassroomsCommand } from "./commands/classrooms";
import { executeAssessmentsCommand } from "./commands/assessments";
import { executeTemplatesCommand } from "./commands/templates";
import { executeSubmissionsCommand } from "./commands/submissions";
import { executeReviewsCommand } from "./commands/reviews";
export async function executeCommand(
  actor: Actor,
  input: unknown,
  context: CommandContext = {},
): Promise<{ id: string; credentials?: AccountCredentials }> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success)
    throw new RequestError(400, parsed.error.issues.map((i) => i.message).join(" "));
  const command = parsed.data;
  const execute = async (db: Prisma.TransactionClient) => {
    // Permission changes use the same lock; read the current grants after acquiring it.
    await db.$queryRaw`SELECT pg_advisory_xact_lock(7240132026::bigint)::text`;
    const a = await getActor(actor.id, db);
    teacher(a);
    if (context.source === "AI") {
      if (!context.jobId) throw new RequestError(400, "AI评阅缺少任务来源。");
      const job = await db.aiJob.findUnique({ where: { id: context.jobId } });
      if (!job || job.userId !== a.id || job.status !== "RUNNING")
        throw new AccessError(403, "AI任务不属于当前账号或已结束。");
    }
    // Serialize domain writes globally: cross-account double reviews and publishing share one snapshot.
    const handlers = [
      executeQuestionsCommand,
      executePapersCommand,
      executeClassroomsCommand,
      executeAssessmentsCommand,
      executeTemplatesCommand,
      executeSubmissionsCommand,
    ];
    for (const handle of handlers) {
      const result = await handle(db, a, command);
      if (result) return result;
    }
    const review = await executeReviewsCommand(db, a, command, context);
    if (review) return review;
    throw new RequestError(400, "未知教学操作。");
  };
  return context.db ? execute(context.db) : getDb().$transaction(execute, { timeout: 20000 });
}
