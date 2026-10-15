import { z } from "zod";

export type XiaozhiPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "image"; url: string; name?: string }
  | {
      type: "tool";
      id: string;
      name: string;
      input: unknown;
      output?: unknown;
      state: "running" | "completed" | "failed";
    };
export type XiaozhiMessage = { id: string; role: "user" | "assistant"; parts: XiaozhiPart[] };
export type XiaozhiView = {
  messages: XiaozhiMessage[];
  busy: boolean;
  compacting: boolean;
  retrying: boolean;
};

export type XiaozhiConversationSummary = {
  id: string;
  title: string;
  modelId: string | null;
  skillIds: string[];
  updatedAt: string;
};
export type XiaozhiConversation = XiaozhiConversationSummary & {
  view: XiaozhiView;
  pending: { id: string; message: z.infer<typeof xiaozhiMessageSchema>; mode: string }[];
  error: string | null;
  status: string;
};
export type XiaozhiSkill = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  builtin: boolean;
};
export const xiaozhiSkillSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(300),
  instructions: z.string().trim().min(1).max(20000),
});
export const xiaozhiSettingsSchema = z.strictObject({
  title: z.string().trim().min(1).max(100).optional(),
  modelId: z.string().min(1).max(128).optional(),
  skillIds: z.array(z.string().min(1).max(128)).max(20).optional(),
});
export const xiaozhiMessageSchema = z
  .strictObject({
    id: z.string().min(1).max(128),
    role: z.literal("user"),
    parts: z
      .array(
        z.union([
          z.strictObject({ type: z.literal("text"), text: z.string().max(30000) }),
          z.strictObject({
            type: z.literal("file"),
            url: z.string().regex(/^\/api\/platform\/assets\/[a-f0-9-]{36}$/),
            mediaType: z.literal("image/png"),
            filename: z.string().max(200).optional(),
          }),
        ]),
      )
      .min(1)
      .max(21),
  })
  .refine(
    (message) => message.parts.some((part) => part.type === "file" || part.text.trim()),
    "请输入内容或添加附件。",
  );
