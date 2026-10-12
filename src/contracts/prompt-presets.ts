import { z } from "zod";

export const promptPresetSchema = z.enum(["openai", "gemini", "anthropic", "deepseek", "kimi"]);
export type PromptPresetId = z.infer<typeof promptPresetSchema>;
export const PROMPT_PRESETS = {
  openai: {
    label: "OpenAI",
    description: "明确角色、任务和证据边界，按段落组织输出规则。",
    source: "https://developers.openai.com/api/docs/guides/prompt-engineering",
  },
  gemini: {
    label: "Gemini",
    description: "直接、结构化的多模态指令，明确目标页与上下文图的用途。",
    source: "https://ai.google.dev/gemini-api/docs/prompting-strategies",
  },
  anthropic: {
    label: "Anthropic / Claude",
    description: "使用 XML 分隔共享规则，明确当前任务与核对顺序。",
    source:
      "https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices",
  },
  deepseek: {
    label: "DeepSeek",
    description: "明确当前阶段的 JSON 输出，强调完整性和公式转义。",
    source: "https://api-docs.deepseek.com/guides/json_mode/",
  },
  kimi: {
    label: "Kimi / Moonshot",
    description: "中文角色与分步指令，以原图为依据，提供无法辨认时的处理规则。",
    source: "https://platform.kimi.ai/docs/guide/prompt-best-practice",
  },
} as const;
