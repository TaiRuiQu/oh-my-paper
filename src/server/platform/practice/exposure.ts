import "server-only";
import type { BankQuestion, Paper } from "@/contracts/platform";
import type { PracticeItemEligibility } from "@/contracts/practice";
import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "../access";
import { questionAssetUrls } from "@/lib/question-assets";
import { loadState } from "../queries";
import { frozen, type SessionRow } from "./context";
import { sourceItems } from "./snapshot";

function recommendationQuestions(value: unknown): BankQuestion[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const object = value as Record<string, unknown>;
  if (object.result) return recommendationQuestions(object.result);
  return (Array.isArray(object.recommendations) ? object.recommendations : []).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const q = (entry as { question?: BankQuestion }).question;
    return q &&
      typeof q.id === "string" &&
      q.content &&
      typeof q.content.stem === "string" &&
      Array.isArray(q.content.options) &&
      Array.isArray(q.content.parts)
      ? [q]
      : [];
  });
}
/** Re-evaluated inside submit's domain transaction, including channels outside practice. */
export async function eligibility(db: Db, row: SessionRow): Promise<PracticeItemEligibility[]> {
  const items = row.sourceItems as unknown as PracticeItemEligibility[];
  const exposures = await db.practiceExposure.findMany({
    where: {
      userId: row.userId,
      OR: [
        { originalQuestionId: { in: items.map((i) => i.originalQuestionId) } },
        { promptFingerprint: { in: items.map((i) => i.promptFingerprint) } },
      ],
    },
  });
  const state = await loadState({ id: row.userId }, db);
  const questions = [...state.analytics.students.flatMap((r) => r.recommendations)];
  const jobs = await db.aiJob.findMany({
    where: { userId: row.userId, kind: "RECOMMEND", status: "COMPLETED" },
    select: { result: true },
  });
  questions.push(...jobs.flatMap((j) => recommendationQuestions(j.result)));
  const source = frozen(row).paper;
  const legacyPapers: Paper[] = [
    ...state.papers,
    ...questions.map((q) => ({
      ...source,
      id: `recommendation:${q.id}`,
      instructions: "",
      layout: { paperSize: "A4" as const, columns: 1 },
      items: [{ id: q.id, questionId: q.id, position: 1, score: 1, section: "", snapshot: q }],
    })),
  ];
  const legacyIds = new Set(
    legacyPapers.flatMap((p) => p.items.map((i) => i.snapshot.id || i.questionId)),
  );
  const legacyFingerprints = new Set<string>();
  let uncertain = legacyPapers.some((p) =>
    p.items.some((i) =>
      i.snapshot.content.images.some(
        (url) => !questionAssetUrls({ ...i.snapshot.content, images: [] }).includes(url),
      ),
    ),
  );
  for (const p of legacyPapers) {
    try {
      (await sourceItems(db, p)).forEach((i) => legacyFingerprints.add(i.promptFingerprint));
    } catch {
      uncertain = true;
    }
  }
  return items.map((item) => {
    const matching = exposures.filter(
      (e) =>
        e.originalQuestionId === item.originalQuestionId ||
        e.promptFingerprint === item.promptFingerprint,
    );
    const available =
      row.sourceKind === "REPLAY" ||
      legacyIds.has(item.originalQuestionId) ||
      legacyFingerprints.has(item.promptFingerprint) ||
      matching.some((e) => e.kind !== "ATTEMPTED");
    return {
      ...item,
      eligibility: available
        ? "ANSWER_AVAILABLE"
        : matching.length
          ? "REPEAT"
          : uncertain
            ? "UNKNOWN"
            : "UNEXPOSED_IN_SYSTEM",
      reasons: available
        ? ["原复习资料、已发布报告、完整推荐或参考反馈已提供答案；不计为系统内未暴露新题。"]
        : matching.length
          ? ["此前已有同一题目或相同题面的尝试。"]
          : uncertain
            ? ["部分历史材料无法核验，不能认定为未暴露。"]
            : ["系统内未发现先前作答或答案提供记录；这不证明线下未获帮助。"],
    };
  });
}
export async function recordExposure(
  db: Prisma.TransactionClient,
  row: SessionRow,
  itemIds: string[],
  kind: string,
  reason: string,
) {
  const items = (row.sourceItems as unknown as PracticeItemEligibility[]).filter((i) =>
    itemIds.includes(i.itemId),
  );
  if (items.length)
    await db.practiceExposure.createMany({
      data: items.map((i) => ({
        sessionId: row.id,
        userId: row.userId,
        originalQuestionId: i.originalQuestionId,
        promptFingerprint: i.promptFingerprint,
        kind,
        reason,
      })),
    });
}
