import { beforeEach, expect, it, vi } from "vitest";
import { RequestError } from "@/server/http/errors";
import { loadUserDirectory, USER_DIRECTORY_LIMIT } from "@/server/platform/user-directory";

type Row = Record<string, unknown>;

const staffAssignments = [
  { role: "HOMEROOM", classroomId: "class-a", stage: "", cohort: "", subject: "" },
];

function fixture() {
  const rows: Row[] = [
    {
      id: "admin",
      name: "管理员",
      email: "admin@test.invalid",
      username: null,
      role: "ADMIN",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      teachingAssignments: [],
      permissionsVersion: 1,
    },
    {
      id: "teacher",
      name: "张老师",
      email: "teacher@test.invalid",
      username: "t2026001",
      role: "TEACHER",
      createdAt: new Date("2026-01-02T00:00:00Z"),
      teachingAssignments: structuredClone(staffAssignments),
      permissionsVersion: 3,
    },
    {
      id: "student",
      name: "张小明",
      email: "stu@test.invalid",
      username: "000123",
      role: "STUDENT",
      createdAt: new Date("2026-01-03T00:00:00Z"),
      teachingAssignments: [],
      permissionsVersion: 0,
    },
  ];
  const db = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.find((entry) => entry.id === where.id);
        return row
          ? {
              id: row.id,
              name: row.name,
              role: row.role,
              permissionsVersion: row.permissionsVersion,
              teachingAssignments: row.teachingAssignments,
            }
          : null;
      }),
      findMany: vi.fn(async () => rows.filter((row) => row.id !== "admin")),
      findFirst: vi.fn(async () => rows.find((row) => row.id === "student") ?? null),
      count: vi.fn(async () => 3),
    },
    classroom: {
      findMany: vi.fn(async () => [{ id: "class-a" }, { id: "class-b" }]),
    },
  };
  return { db };
}

let db: ReturnType<typeof fixture>["db"];
const use = () => {
  const setup = fixture();
  db = setup.db;
};

beforeEach(() => {
  vi.clearAllMocks();
  use();
});

it("searches name, login and email case-insensitively with a capped list and a full count", async () => {
  const result = await loadUserDirectory("admin", { query: "  Zhang " }, db as never);
  const expected = {
    AND: [
      {},
      {
        OR: [
          { name: { contains: "Zhang", mode: "insensitive" } },
          { username: { contains: "Zhang", mode: "insensitive" } },
          { email: { contains: "Zhang", mode: "insensitive" } },
        ],
      },
    ],
  };
  expect(db.user.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expected,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: USER_DIRECTORY_LIMIT,
    }),
  );
  expect(db.user.count).toHaveBeenCalledWith({ where: expected });
  expect(result.total).toBe(3);
  expect(result.users.map((user) => user.id)).toEqual(["teacher", "student"]);
  // ADMIN readers keep the permission metadata needed by the access editor.
  expect(result.users[0]).toMatchObject({
    id: "teacher",
    permissionsVersion: 3,
    teachingAssignments: [{ role: "HOMEROOM", classroomId: "class-a" }],
  });
});

it("narrows by role for the student binding picker", async () => {
  await loadUserDirectory("admin", { role: "STUDENT", query: "小明" }, db as never);
  expect(db.user.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        AND: [
          {},
          { role: "STUDENT" },
          {
            OR: [
              { name: { contains: "小明", mode: "insensitive" } },
              { username: { contains: "小明", mode: "insensitive" } },
              { email: { contains: "小明", mode: "insensitive" } },
            ],
          },
        ],
      },
    }),
  );
});

it("limits teachers to staff plus students of visible classrooms", async () => {
  await loadUserDirectory("teacher", { query: "张" }, db as never);
  expect(db.classroom.findMany).toHaveBeenCalledWith({
    where: { OR: [{ id: "class-a" }] },
    select: { id: true },
  });
  expect(db.user.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        AND: [
          {
            OR: [
              { role: { in: ["ADMIN", "TEACHER"] } },
              { studentRecords: { some: { classroomId: { in: ["class-a", "class-b"] } } } },
            ],
          },
          {
            OR: [
              { name: { contains: "张", mode: "insensitive" } },
              { username: { contains: "张", mode: "insensitive" } },
              { email: { contains: "张", mode: "insensitive" } },
            ],
          },
        ],
      },
    }),
  );
});

it("resolves a single account by id inside the caller's scope and 404s outside it", async () => {
  const own = await loadUserDirectory("admin", { id: "student" }, db as never);
  expect(db.user.findFirst).toHaveBeenCalledWith({
    where: { AND: [{}, { id: "student" }] },
    select: expect.objectContaining({ id: true, permissionsVersion: true }),
  });
  expect(own.users.map((user) => user.id)).toEqual(["student"]);
  db.user.findFirst.mockResolvedValueOnce(null);
  await expect(loadUserDirectory("admin", { id: "missing" }, db as never)).rejects.toMatchObject({
    name: "AccessError",
    status: 404,
  });
});

it("rejects students, oversized keywords, invalid roles and combined id searches", async () => {
  db.user.findUnique.mockResolvedValueOnce({
    id: "student",
    name: "学生",
    role: "STUDENT",
    permissionsVersion: 0,
    teachingAssignments: [],
  });
  await expect(loadUserDirectory("student", {}, db as never)).rejects.toMatchObject({
    name: "AccessError",
    status: 403,
  });
  await expect(
    loadUserDirectory("admin", { query: "一".repeat(65) }, db as never),
  ).rejects.toBeInstanceOf(RequestError);
  await expect(
    loadUserDirectory("admin", { role: "PRINCIPAL" }, db as never),
  ).rejects.toBeInstanceOf(RequestError);
  await expect(
    loadUserDirectory("admin", { id: "student", query: "张" }, db as never),
  ).rejects.toBeInstanceOf(RequestError);
});
