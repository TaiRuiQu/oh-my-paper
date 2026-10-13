import "server-only";
import { getDb } from "@/server/db/client";
import type { UsageDashboard, UsageTotals } from "@/contracts/usage";
import { sumCredits } from "@/lib/credits";

const sum = { credits: true, inputTokens: true, outputTokens: true, cachedTokens: true } as const;
function totals(value: {
  _sum: {
    credits: { toFixed(digits: number): string } | null;
    inputTokens: number | null;
    outputTokens: number | null;
    cachedTokens: number | null;
  };
  _count: { _all: number };
}): UsageTotals {
  return {
    credits: value._sum.credits?.toFixed(8) ?? "0",
    inputTokens: value._sum.inputTokens ?? 0,
    outputTokens: value._sum.outputTokens ?? 0,
    cachedTokens: value._sum.cachedTokens ?? 0,
    calls: value._count._all,
  };
}
export async function usageDashboard(): Promise<UsageDashboard> {
  // A single snapshot keeps totals and both rankings consistent while calls settle.
  return getDb().$transaction(
    async (tx) => {
      const all = await tx.creditUsage.aggregate({ _sum: sum, _count: { _all: true } });
      const users = await tx.user.findMany({
        select: { id: true, name: true, credits: true, role: true },
        orderBy: { id: "asc" },
      });
      const userGroups = await tx.creditUsage.groupBy({
        by: ["userId"],
        _sum: sum,
        _count: { _all: true },
      });
      const modelGroups = await tx.creditUsage.groupBy({
        by: ["modelId", "providerId", "providerName", "model", "displayName"],
        _sum: sum,
        _count: { _all: true },
      });
      const configured = await tx.aiModel.findMany({
        include: { provider: { select: { name: true } } },
      });
      const models = new Map<string, UsageDashboard["models"][number]>(
        configured.map((model) => [
          model.id,
          {
            id: model.id,
            name: model.displayName || model.name,
            apiModel: model.name,
            provider: model.provider.name,
            credits: "0",
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0,
            calls: 0,
          },
        ]),
      );
      for (const group of modelGroups) {
        const id = group.modelId ?? `${group.providerId}:${group.model}`;
        const previous = models.get(id);
        const current = totals(group);
        models.set(id, {
          id,
          name: previous?.name ?? (group.displayName || group.model),
          apiModel: previous?.apiModel ?? group.model,
          provider: previous?.provider ?? group.providerName,
          ...current,
          ...(previous
            ? {
                credits: sumCredits([previous.credits, current.credits]),
                inputTokens: previous.inputTokens + current.inputTokens,
                outputTokens: previous.outputTokens + current.outputTokens,
                cachedTokens: previous.cachedTokens + current.cachedTokens,
                calls: previous.calls + current.calls,
              }
            : {}),
        });
      }
      return {
        totals: totals(all),
        users: users.map((user) => {
          const group = userGroups.find((item) => item.userId === user.id);
          return {
            id: user.id,
            name: user.name,
            balance: user.credits.toFixed(8),
            unlimited: user.role === "ADMIN",
            ...(group
              ? totals(group)
              : { credits: "0", inputTokens: 0, outputTokens: 0, cachedTokens: 0, calls: 0 }),
          };
        }),
        models: [...models.values()],
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
