import "server-only";
import type { AiJob } from "@/generated/prisma/client";
import type { AiJobDTO, PracticeJobProgress } from "@/contracts/platform-ai";

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const identifier = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 128 ? value : undefined;
const date = (value: Date | string | null) => (value instanceof Date ? value.toISOString() : value);

/** A single boundary for HTTP, initial SSR, both SSE formats and small-paper task polling.
 * Practice tool inputs, reference answers, reasoning and scratch images remain private even
 * after completion. Feedback is read through the practice domain's phase/identity projection.
 */
export function projectAiJob(job: AiJob | AiJobDTO, role?: string): AiJobDTO {
  const privatePractice = job.kind === "PRACTICE_GRADE";
  const input = object(job.input);
  const prior = object("practice" in job ? job.practice : undefined);
  const result = object(job.result);
  const business = object(result.result ?? result);
  const sessionId = identifier(input.sessionId ?? prior.sessionId);
  const attemptId = identifier(input.attemptId ?? prior.attemptId);
  let practice: PracticeJobProgress | undefined;
  if (privatePractice && sessionId && attemptId) {
    // These are domain-produced aggregate counts, never model-written feedback or arbitrary JSON.
    const rawCounts = object(business.counts ?? prior.counts);
    const counts: Record<string, number> = {};
    for (const key of ["CORRECT", "PARTIAL", "INCORRECT", "UNSURE", "SKIPPED", "total"])
      if (
        typeof rawCounts[key] === "number" &&
        Number.isSafeInteger(rawCounts[key]) &&
        rawCounts[key] >= 0
      )
        counts[key] = rawCounts[key];
    const teacher = role
      ? role !== "STUDENT"
      : typeof prior.feedbackHref === "string" &&
        prior.feedbackHref.startsWith("/homework/practice/reviews/");
    practice = {
      sessionId,
      attemptId,
      counts: job.status === "COMPLETED" ? counts : {},
      feedbackHref: teacher
        ? `/homework/practice/reviews/${encodeURIComponent(attemptId)}`
        : `/learning/practice/${encodeURIComponent(sessionId)}`,
    };
  }
  return {
    id: job.id,
    userId: job.userId,
    kind: job.kind as AiJobDTO["kind"],
    modelId: job.modelId,
    status: job.status as AiJobDTO["status"],
    input: privatePractice ? null : job.input,
    result: privatePractice ? null : job.result,
    cost: privatePractice ? null : (job.cost as AiJobDTO["cost"]),
    events: privatePractice ? [] : (job.events as unknown[]),
    ...(practice ? { practice } : {}),
    error: privatePractice
      ? job.status === "FAILED"
        ? "练习反馈未完成，请重新读取练习并核对后重试。"
        : null
      : job.error,
    attempts: job.attempts,
    createdAt: date(job.createdAt)!,
    startedAt: date(job.startedAt),
    finishedAt: date(job.finishedAt),
  };
}
