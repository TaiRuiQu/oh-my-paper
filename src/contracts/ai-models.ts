import { z } from "zod";

export const responsesTransportSchema = z.enum(["http", "websocket"]);
export type ResponsesTransportMode = z.infer<typeof responsesTransportSchema>;

export const reasoningEfforts = [
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export const reasoningEffortSchema = z.enum(reasoningEfforts);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export const reasoningEffortLabels: Record<ReasoningEffort, string> = {
  "provider-default": "供应商默认",
  none: "关闭（none）",
  minimal: "最低（minimal）",
  low: "低（low）",
  medium: "中（medium）",
  high: "高（high）",
  xhigh: "更高（xhigh）",
  max: "最高（max）",
};
