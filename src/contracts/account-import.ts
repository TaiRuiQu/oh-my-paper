import { z } from "zod";
import { managedAccountSchema, type AccountCredentials } from "./auth";

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const importRoleSchema = z.enum(["STUDENT", "TEACHER"]);
export type ImportRole = z.infer<typeof importRoleSchema>;
export const importRowSchema = z.strictObject({
  row: z.number().int().min(2),
  name: z.string().max(200),
  username: z.string().max(200),
  studentNumber: z.string().max(200),
  password: z.string().max(200),
});
export type ImportRow = z.infer<typeof importRowSchema>;
export const accountImportSchema = z.strictObject({
  role: importRoleSchema,
  classroomId: z.string().min(1).optional(),
  rows: z.array(importRowSchema).min(1).max(MAX_IMPORT_ROWS),
});
export type AccountImport = z.infer<typeof accountImportSchema>;
export type ImportIssue = { row: number; message: string };
export type ImportPreview = { rows: ImportRow[]; issues: ImportIssue[] };
export const importResultSchema = z.strictObject({
  accounts: z
    .array(importRowSchema.pick({ row: true, name: true, username: true, password: true }))
    .min(1)
    .max(MAX_IMPORT_ROWS),
});
export type ImportResult = {
  accounts: (AccountCredentials & { name: string; row: number })[];
};

export function importAccount(role: ImportRole, row: ImportRow) {
  return managedAccountSchema.safeParse(
    role === "STUDENT"
      ? { role, name: row.name, studentNumber: row.studentNumber || undefined }
      : { role, name: row.name || undefined, username: row.username, password: row.password },
  );
}

export function validateImportRows(role: ImportRole, rows: ImportRow[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const seen = new Map<string, number>();
  for (const row of rows) {
    const parsed = importAccount(role, row);
    if (!parsed.success) {
      issues.push({ row: row.row, message: parsed.error.issues.map((i) => i.message).join(" ") });
      continue;
    }
    const key = parsed.data.role === "STUDENT" ? parsed.data.studentNumber : parsed.data.username;
    if (!key) continue;
    if (seen.has(key))
      issues.push({ row: row.row, message: `账号或学号与第 ${seen.get(key)} 行重复。` });
    else seen.set(key, row.row);
  }
  return issues;
}
