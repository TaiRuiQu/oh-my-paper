import { expect, it } from "vitest";
import { aiCostLabel, formatAiCost } from "@/lib/ai-cost-display";
import { aiCostFixture } from "./fixtures/ai-cost";

it("keeps tiny non-zero charges visible without rounding them to free", () => {
  expect(formatAiCost(0.000001)).toBe("< ¥0.0001");
  expect(formatAiCost(0.000001, "USD")).toBe("< $0.0001");
  expect(formatAiCost(0)).toBe("¥0.00");
  expect(aiCostLabel({ ...aiCostFixture, cny: 0 })).toBe("估算成本 ¥0.00");
  expect(aiCostLabel(null)).toBe("成本暂无法估算");
});
