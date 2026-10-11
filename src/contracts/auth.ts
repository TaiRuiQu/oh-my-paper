import { z } from "zod";

export function authFormSchema(mode: "login" | "register") {
  return z.object({
    name: z.string().trim().max(80, "姓名最多 80 个字符。"),
    email: z.email("请输入有效的邮箱地址。").max(254),
    password: z.string().min(mode === "register" ? 10 : 1, mode === "register" ? "密码至少需要 10 个字符。" : "请输入密码。").max(128, "密码最多 128 个字符。"),
  }).superRefine((value, context) => {
    if (mode === "register" && !value.name) {
      context.addIssue({ code: "custom", path: ["name"], message: "请输入姓名。" });
    }
  });
}

export type AuthFields = z.infer<ReturnType<typeof authFormSchema>>;
