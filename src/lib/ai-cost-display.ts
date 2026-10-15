import type { AiTaskCost } from "@/contracts/ai-cost";

export function formatAiCost(amount: number, currency: "CNY" | "USD" = "CNY") {
  const symbol = currency === "CNY" ? "¥" : "$";
  if (amount > 0 && amount < 0.0001) return `< ${symbol}0.0001`;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

export function aiCostLabel(cost: AiTaskCost | null) {
  return cost?.cny !== null && cost?.cny !== undefined
    ? `估算成本 ${formatAiCost(cost.cny)}`
    : "成本暂无法估算";
}

export function aiCostUnavailableReason(cost: AiTaskCost | null) {
  switch (cost?.reason) {
    case "price_unavailable":
      return "暂未获取到该模型的价格，无法估算本次成本。";
    case "usage_unavailable":
      return "模型未返回完整用量，无法估算本次成本。";
    default:
      return "本次任务暂无成本数据。";
  }
}
