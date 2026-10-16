import { beforeEach, it, expect, vi } from "vitest";
import type { Prisma, ClassroomStudent, User } from "@/generated/prisma/client";
import { commandSchema } from "@/server/platform/schemas";
const accounts = vi.hoisted(() => ({ insert: vi.fn(), lock: vi.fn(), number: vi.fn() }));
vi.mock("@/server/auth/accounts", () => ({
  insertAccount: accounts.insert,
  lockAccounts: accounts.lock,
  nextStudentNumber: accounts.number,
}));
import { executeClassroomsCommand } from "@/server/platform/commands/classrooms";
let previous: ClassroomStudent | null,
  db: Prisma.TransactionClient,
  fixture: ReturnType<typeof database>;
const actor = { id: "owner", name: "班级创建者", role: "TEACHER" as const };
function database() {
  return {
    classroom: {
      findUnique: vi.fn(async () => ({
        id: "class",
        ownerId: actor.id,
        stage: "高中",
        cohort: "2027届",
        name: "一班",
      })),
    },
    classroomStudent: {
      findUnique: vi.fn(async () => previous),
      findFirst: vi.fn(async (): Promise<ClassroomStudent | null> => null),
      create: vi.fn(async ({ data }: { data: Omit<ClassroomStudent, "id"> }) => ({
        id: "created",
        ...data,
      })),
      update: vi.fn(async ({ data }: { data: Partial<ClassroomStudent> }) => ({
        ...previous!,
        ...data,
      })),
    },
    practiceSession: { count: vi.fn(async () => 0) },
    teachingParticipant: { count: vi.fn(async () => 0) },
    assessmentParticipant: { count: vi.fn(async () => 0) },
    scanSubmission: { count: vi.fn(async () => 0) },
    user: {
      findUnique: vi.fn(
        async (): Promise<Pick<User, "id" | "role" | "username" | "email"> | null> => ({
          id: "account",
          role: "STUDENT",
          username: "123456",
          email: "account@accounts.invalid",
        }),
      ),
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  previous = null;
  fixture = database();
  db = fixture as unknown as Prisma.TransactionClient;
  accounts.number.mockResolvedValue("123456");
  accounts.insert.mockResolvedValue({
    id: "new-account",
    credentials: { username: "123456", password: "generated-password" },
  });
});
const save = (student: Record<string, unknown>) =>
  executeClassroomsCommand(
    db,
    actor,
    commandSchema.parse({
      type: "student.save",
      student: { classroomId: "class", name: "小明", ...student },
    }),
  );
it("explicit null creates only an unbound roster record without credentials or a user", async () => {
  const result = await save({ userId: null });
  expect(result).toEqual({ id: "created" });
  expect(fixture.classroomStudent.create).toHaveBeenCalledWith({
    data: { classroomId: "class", name: "小明", studentNumber: "123456", userId: null },
  });
  expect(accounts.insert).not.toHaveBeenCalled();
  expect(fixture.user.findUnique).not.toHaveBeenCalled();
});
it("omitting userId creates a managed account and returns its credentials", async () => {
  const result = await save({});
  expect(result).toMatchObject({ id: "created", credentials: { username: "123456" } });
  expect(accounts.insert).toHaveBeenCalledTimes(1);
  expect(fixture.classroomStudent.create.mock.calls[0][0].data.userId).toBe("new-account");
});
it("explicit null keeps an existing unbound student's identity and history unbound", async () => {
  previous = {
    id: "student",
    classroomId: "class",
    name: "小明",
    studentNumber: "123456",
    userId: null,
  };
  fixture.assessmentParticipant.count.mockResolvedValue(1);
  const result = await save({ id: "student", studentNumber: "123456", userId: null });
  expect(result).toEqual({ id: "student" });
  expect(accounts.insert).not.toHaveBeenCalled();
  expect(fixture.classroomStudent.update.mock.calls[0][0].data.userId).toBeNull();
});
it("allows an unbound student without history to change card number while explicitly remaining unbound", async () => {
  previous = {
    id: "student",
    classroomId: "class",
    name: "小明",
    studentNumber: "123456",
    userId: null,
  };
  expect(await save({ id: "student", studentNumber: "234567", userId: null })).toEqual({
    id: "student",
  });
  expect(fixture.classroomStudent.update.mock.calls[0][0].data).toMatchObject({
    studentNumber: "234567",
    userId: null,
  });
  expect(accounts.insert).not.toHaveBeenCalled();
});
it("rejects explicit unbinding of an already bound student without writing anything", async () => {
  previous = {
    id: "student",
    classroomId: "class",
    name: "小明",
    studentNumber: "123456",
    userId: "account",
  };
  await expect(
    save({ id: "student", studentNumber: "123456", userId: null }),
  ).rejects.toMatchObject({ status: 409 });
  expect(accounts.insert).not.toHaveBeenCalled();
  expect(fixture.classroomStudent.update).not.toHaveBeenCalled();
});
it("omitted binding preserves the existing account instead of creating a second user", async () => {
  previous = {
    id: "student",
    classroomId: "class",
    name: "小明",
    studentNumber: "123456",
    userId: "account",
  };
  expect(await save({ id: "student", studentNumber: "123456" })).toEqual({ id: "student" });
  expect(accounts.insert).not.toHaveBeenCalled();
  expect(fixture.classroomStudent.update.mock.calls[0][0].data.userId).toBe("account");
});
it("newly binding an existing numeric login uses it as the omitted card number without generating another", async () => {
  fixture.user.findUnique.mockResolvedValue({
    id: "account",
    role: "STUDENT",
    username: "009876",
    email: "account@accounts.invalid",
  });
  expect(await save({ userId: "account" })).toEqual({ id: "created" });
  expect(fixture.classroomStudent.create.mock.calls[0][0].data).toMatchObject({
    studentNumber: "009876",
    userId: "account",
  });
  expect(accounts.number).not.toHaveBeenCalled();
  expect(accounts.insert).not.toHaveBeenCalled();
});
it("retains an explicit distinct answer-card number instead of rewriting it to the login", async () => {
  expect(await save({ userId: "account", studentNumber: "999999" })).toEqual({ id: "created" });
  expect(fixture.classroomStudent.create.mock.calls[0][0].data).toMatchObject({
    studentNumber: "999999",
    userId: "account",
  });
});
it("historical unbound identities keep their old card number when bound to an existing login", async () => {
  previous = {
    id: "student",
    classroomId: "class",
    name: "小明",
    studentNumber: "000001",
    userId: null,
  };
  fixture.assessmentParticipant.count.mockResolvedValue(1);
  expect(await save({ id: "student", userId: "account" })).toEqual({ id: "student" });
  expect(fixture.classroomStudent.update.mock.calls[0][0].data).toMatchObject({
    studentNumber: "000001",
    userId: "account",
  });
  expect(accounts.number).not.toHaveBeenCalled();
});
it("rejects an existing numeric-login card collision without silently generating a substitute", async () => {
  fixture.classroomStudent.findFirst.mockResolvedValue({
    id: "other-student",
    classroomId: "class",
    name: "另一人",
    studentNumber: "123456",
    userId: null,
  });
  await expect(save({ userId: "account" })).rejects.toMatchObject({ status: 409 });
  expect(accounts.number).not.toHaveBeenCalled();
  expect(fixture.classroomStudent.create).not.toHaveBeenCalled();
});
it("supports a nonnumeric legacy login with a separate generated numeric answer-card number", async () => {
  fixture.user.findUnique.mockResolvedValue({
    id: "account",
    role: "STUDENT",
    username: "legacy.student",
    email: "legacy@test.invalid",
  });
  await save({ userId: "account" });
  expect(accounts.number).toHaveBeenCalledTimes(1);
  expect(fixture.classroomStudent.create.mock.calls[0][0].data).toMatchObject({
    studentNumber: "123456",
    userId: "account",
  });
});
it.each([
  null,
  { id: "teacher-account", role: "TEACHER", username: "teacher", email: "teacher@test.invalid" },
])(
  "rejects missing and nonstudent account bindings before creating a roster entry",
  async (target) => {
    fixture.user.findUnique.mockResolvedValue(target);
    await expect(save({ userId: "account" })).rejects.toMatchObject({ status: 400 });
    expect(fixture.classroomStudent.create).not.toHaveBeenCalled();
    expect(accounts.number).not.toHaveBeenCalled();
  },
);
it.each([
  { email: "account@accounts.invalid", history: "assessment" },
  { email: "account@accounts.invalid", history: "classroom" },
  { email: "account@accounts.invalid", history: "scan" },
  { email: "account@accounts.invalid", history: "practice" },
  { email: "real@example.test", history: "assessment" },
  { email: "account@accounts.invalid", history: "none" },
])(
  "rejects replacing an already bound $email identity with $history history",
  async ({ email, history }) => {
    previous = {
      id: "student",
      classroomId: "class",
      name: "小明",
      studentNumber: "123456",
      userId: "original",
    };
    fixture.user.findUnique.mockResolvedValue({
      id: "another",
      role: "STUDENT",
      username: "654321",
      email,
    });
    if (history === "assessment") fixture.assessmentParticipant.count.mockResolvedValue(1);
    if (history === "classroom") fixture.teachingParticipant.count.mockResolvedValue(1);
    if (history === "scan") fixture.scanSubmission.count.mockResolvedValue(1);
    if (history === "practice") fixture.practiceSession.count.mockResolvedValue(1);
    await expect(save({ id: "student", userId: "another" })).rejects.toMatchObject({ status: 409 });
    expect(fixture.classroomStudent.update).not.toHaveBeenCalled();
    expect(previous.userId).toBe("original");
    expect(accounts.insert).not.toHaveBeenCalled();
  },
);
it("allows the same existing managed account to save without replacing its identity", async () => {
  previous = {
    id: "student",
    classroomId: "class",
    name: "小明",
    studentNumber: "123456",
    userId: "account",
  };
  fixture.assessmentParticipant.count.mockResolvedValue(1);
  expect(await save({ id: "student", userId: "account" })).toEqual({ id: "student" });
  expect(fixture.classroomStudent.update.mock.calls[0][0].data.userId).toBe("account");
});
it("does not let an initially unbound scanned identity change name while receiving its first binding", async () => {
  previous = {
    id: "student",
    classroomId: "class",
    name: "小明",
    studentNumber: "123456",
    userId: null,
  };
  fixture.scanSubmission.count.mockResolvedValue(1);
  await expect(save({ id: "student", userId: "account", name: "另一个人" })).rejects.toMatchObject({
    status: 409,
  });
  expect(fixture.classroomStudent.update).not.toHaveBeenCalled();
});
