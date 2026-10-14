import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .min(1, "请输入账号。")
  .max(64, "账号最多 64 个字符。")
  .regex(/^[a-zA-Z0-9_.-]+$/, "账号只能包含字母、数字、下划线、点和短横线。")
  .transform((value) => value.toLowerCase());
export const studentNumberSchema = z.string().regex(/^\d{1,20}$/, "学号须为 1 至 20 位数字。");
export const newPasswordSchema = z
  .string()
  .min(10, "密码至少需要 10 个字符。")
  .max(128, "密码最多 128 个字符。");
export const managedAccountSchema = z.discriminatedUnion("role", [
  z.strictObject({
    role: z.enum(["ADMIN", "TEACHER"]),
    username: usernameSchema,
    password: newPasswordSchema,
  }),
  z.strictObject({
    role: z.literal("STUDENT"),
    name: z.string().trim().min(1, "请输入真实姓名。").max(80),
    studentNumber: studentNumberSchema.optional(),
  }),
]);
export type AccountCredentials = { username: string; password: string };
export const authLoginSchema = z.object({
  username: z.string().trim().min(1, "请输入账号或学号。").max(254),
  password: z.string().min(1, "请输入密码。").max(128, "密码最多 128 个字符。"),
});
export type AuthFields = z.infer<typeof authLoginSchema>;

/** Kept for downstream contract consumers; public registration is disabled. */
export function authFormSchema(mode: "login" | "register") {
  if (mode === "login")
    return z.object({ name: z.string(), email: z.email(), password: z.string().min(1).max(128) });
  return z.object({
    name: z.string().trim().min(1),
    email: z.email(),
    password: newPasswordSchema,
  });
}
