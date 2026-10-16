import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    classroom: { findUnique: vi.fn() },
    classroomStudent: { findMany: vi.fn(), create: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  insert: vi.fn(),
  prepare: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/server/auth/accounts", () => ({
  insertAccount: mocks.insert,
  prepareAccountPassword: mocks.prepare,
  lockAccounts: mocks.lock,
}));
import { authorizeAccountImport, commitAccountImport } from "@/server/auth/account-import";
const student = (number = "000001", row = 2) => ({
  row,
  name: "张三",
  username: "",
  studentNumber: number,
  password: "",
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
  mocks.db.user.findMany.mockResolvedValue([]);
  mocks.db.classroomStudent.findMany.mockResolvedValue([]);
  mocks.db.classroom.findUnique.mockResolvedValue({ ownerId: "teacher" });
  mocks.db.$transaction.mockImplementation(async (run) => run(mocks.db));
  mocks.prepare.mockResolvedValue({ password: "generated123", hash: "hash" });
  mocks.insert.mockImplementation(async (_db, input) => ({
    id: "new-student",
    credentials: { username: input.studentNumber || "000009", password: "generated123" },
  }));
});
it("rejects students, teacher imports by teachers, and non-owned classrooms before hashing", async () => {
  mocks.db.user.findUnique.mockResolvedValue({ role: "STUDENT" });
  await expect(authorizeAccountImport("student", "STUDENT", "class")).rejects.toThrow("仅管理员");
  mocks.db.user.findUnique.mockResolvedValue({ role: "TEACHER" });
  await expect(authorizeAccountImport("teacher", "TEACHER")).rejects.toThrow("仅管理员");
  await expect(authorizeAccountImport("teacher", "STUDENT")).rejects.toThrow("仅管理员");
  await expect(authorizeAccountImport("other", "STUDENT", "class")).rejects.toThrow("无权管理");
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("validates every row and existing account/roster conflicts before writing", async () => {
  await expect(
    commitAccountImport("admin", { role: "STUDENT", rows: [student(), student("bad", 3)] }),
  ).rejects.toThrow("第 3 行");
  mocks.db.user.findMany.mockResolvedValue([{ username: "000001" }]);
  await expect(
    commitAccountImport("admin", { role: "STUDENT", rows: [student()] }),
  ).rejects.toThrow("第 2 行");
  mocks.db.user.findMany.mockResolvedValue([]);
  mocks.db.classroomStudent.findMany.mockResolvedValue([{ studentNumber: "000001" }]);
  await expect(
    commitAccountImport("admin", { role: "STUDENT", rows: [student()] }),
  ).rejects.toThrow("已存在");
  expect(mocks.db.$transaction).not.toHaveBeenCalled();
});
it("rechecks role changes and concurrent account conflicts inside the transaction", async () => {
  mocks.db.user.findUnique
    .mockResolvedValueOnce({ role: "ADMIN" })
    .mockResolvedValue({ role: "STUDENT" });
  await expect(
    commitAccountImport("admin", { role: "STUDENT", rows: [student()] }),
  ).rejects.toThrow("仅管理员");
  expect(mocks.insert).not.toHaveBeenCalled();
  mocks.db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
  mocks.db.user.findMany.mockResolvedValueOnce([]).mockResolvedValue([{ username: "000001" }]);
  await expect(
    commitAccountImport("admin", { role: "STUDENT", rows: [student()] }),
  ).rejects.toThrow("第 2 行");
  expect(mocks.insert).not.toHaveBeenCalled();
});
it("creates students and roster entries together, reserves explicit numbers first, and returns credentials in file order", async () => {
  mocks.db.user.findUnique.mockResolvedValue({ role: "TEACHER" });
  const result = await commitAccountImport("teacher", {
    role: "STUDENT",
    classroomId: "class",
    rows: [student("", 2), student("000001", 3)],
  });
  expect(mocks.insert.mock.calls.map((call) => call[1].studentNumber)).toEqual([
    "000001",
    undefined,
  ]);
  expect(mocks.db.classroomStudent.create).toHaveBeenCalledTimes(2);
  expect(result.accounts.map((account) => [account.row, account.username])).toEqual([
    [2, "000009"],
    [3, "000001"],
  ]);
  expect(mocks.insert.mock.calls[0][2]).toEqual({ password: "generated123", hash: "hash" });
});
it("uses the supplied teacher name and normalized username", async () => {
  await commitAccountImport("admin", {
    role: "TEACHER",
    rows: [
      {
        row: 2,
        name: "王老师",
        username: "Teacher.A",
        password: "Password123!",
        studentNumber: "",
      },
    ],
  });
  expect(mocks.insert.mock.calls[0][1]).toEqual({
    role: "TEACHER",
    name: "王老师",
    username: "teacher.a",
    password: "Password123!",
  });
});
