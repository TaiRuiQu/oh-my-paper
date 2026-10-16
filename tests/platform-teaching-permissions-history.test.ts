import { beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  teachingPermissionsCommandSchema,
  teachingRoleCommandSchema,
  type TeachingAssignment,
  type TeachingPermissionsCommand,
} from "@/contracts/permissions";
import {
  changeTeachingPermissions,
  loadTeachingPermissionsHistory,
} from "@/server/platform/teaching-permissions";
import { executeClassroomsCommand } from "@/server/platform/commands/classrooms";

type User = { id: string; name: string; role: string; permissionsVersion: number };
type AssignmentRow = {
  role: string;
  classroomId: string | null;
  subject: string;
  stage: string;
  cohort: string;
};
const normalize = (row: TeachingAssignment): AssignmentRow => ({
  role: row.role,
  classroomId: "classroomId" in row ? row.classroomId : null,
  subject: "subject" in row ? row.subject : "",
  stage: "stage" in row ? row.stage : "",
  cohort: "cohort" in row ? row.cohort : "",
});
type Event = {
  id: string;
  targetId: string;
  targetName: string;
  actorId: string;
  actorName: string;
  type: string;
  version: number;
  before: unknown;
  after: unknown;
  reason: string;
  createdAt: Date;
};
function fixture() {
  let users = new Map<string, User>([
    ["admin", { id: "admin", name: "管理员甲", role: "ADMIN", permissionsVersion: 0 }],
    ["admin-b", { id: "admin-b", name: "管理员乙", role: "ADMIN", permissionsVersion: 0 }],
    ["teacher", { id: "teacher", name: "教师", role: "TEACHER", permissionsVersion: 0 }],
    ["student", { id: "student", name: "学生", role: "STUDENT", permissionsVersion: 0 }],
  ]);
  let assignments = new Map<string, AssignmentRow[]>([
    ["teacher", [normalize({ role: "HOMEROOM", classroomId: "class-a" })]],
  ]);
  let events: Event[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  const api = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => []),
    user: {
      findUnique: vi.fn(
        async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
          const user = users.get(where.id);
          if (!user) return null;
          const row = {
            ...user,
            teachingAssignments: structuredClone(assignments.get(user.id) ?? []),
          };
          return select
            ? Object.fromEntries(
                Object.keys(select)
                  .filter((key) => select[key])
                  .map((key) => [key, row[key as keyof typeof row]]),
              )
            : row;
        },
      ),
      count: vi.fn(async () => [...users.values()].filter((row) => row.role === "ADMIN").length),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; role: string; permissionsVersion: number };
          data: { role: string };
        }) => {
          const user = users.get(where.id);
          if (
            !user ||
            user.role !== where.role ||
            user.permissionsVersion !== where.permissionsVersion
          )
            return { count: 0 };
          users.set(user.id, {
            ...user,
            role: data.role,
            permissionsVersion: user.permissionsVersion + 1,
          });
          return { count: 1 };
        },
      ),
    },
    classroom: {
      create: vi.fn(async () => ({
        id: "class-new",
        name: "新班级",
        stage: "高中",
        cohort: "2026",
        ownerId: "teacher",
      })),
      count: vi.fn(
        async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.filter((id) => ["class-a", "class-b"].includes(id)).length,
      ),
      findFirst: vi.fn(async () => ({ id: "class-a" })),
    },
    teachingAssignment: {
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        assignments.set(where.userId, []);
        return { count: 1 };
      }),
      createMany: vi.fn(async ({ data }: { data: (TeachingAssignment & { userId: string })[] }) => {
        for (const row of data)
          assignments.set(row.userId, [...(assignments.get(row.userId) ?? []), normalize(row)]);
        return { count: data.length };
      }),
    },
    teachingPermissionsEvent: {
      create: vi.fn(async ({ data }: { data: Omit<Event, "id" | "createdAt"> }) => {
        const event = {
          ...data,
          id: `event-${events.length + 1}`,
          createdAt: new Date("2026-11-11T01:00:00Z"),
        };
        events.push(event);
        return event;
      }),
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; targetId: string } }) =>
          events.find((row) => row.id === where.id && row.targetId === where.targetId) ?? null,
      ),
      findMany: vi.fn(
        async ({
          where,
          take,
        }: {
          where: {
            targetId: string;
            OR?: [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt: string } }];
          };
          take: number;
        }) => {
          const timestamp = where.OR?.[0].createdAt.lt,
            id = where.OR?.[1].id.lt;
          return events
            .filter(
              (row) =>
                row.targetId === where.targetId &&
                (!timestamp ||
                  row.createdAt < timestamp ||
                  (row.createdAt.getTime() === timestamp.getTime() && row.id < id!)),
            )
            .sort(
              (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
            )
            .slice(0, take);
        },
      ),
    },
    $transaction: vi.fn(async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => {
      const pending = queue.then(async () => {
        const snapshot = structuredClone({ users, assignments, events });
        try {
          return await run(api);
        } catch (error) {
          users = snapshot.users;
          assignments = snapshot.assignments;
          events = snapshot.events;
          throw error;
        }
      });
      queue = pending.catch(() => {});
      return pending;
    }),
  };
  return {
    api,
    db: api as unknown as PrismaClient,
    user: (id = "teacher") => users.get(id)!,
    assignments: () => assignments.get("teacher"),
    events: () => events,
  };
}
let f: ReturnType<typeof fixture>;
beforeEach(() => {
  f = fixture();
});
const permission = (
  expectedVersion = 0,
): Extract<TeachingPermissionsCommand, { type: "user.permissions" }> =>
  teachingPermissionsCommandSchema.parse({
    type: "user.permissions",
    id: "teacher",
    expectedVersion,
    reason: "调整本学期任课",
    assignments: [{ role: "SUBJECT_TEACHER", classroomId: "class-b", subject: "数学" }],
  });
const role = (
  value: "ADMIN" | "TEACHER" | "STUDENT",
  expectedVersion: number,
): Extract<TeachingPermissionsCommand, { type: "user.role" }> =>
  teachingRoleCommandSchema.parse({
    type: "user.role",
    id: "teacher",
    role: value,
    expectedVersion,
    reason: "核对账号用途后调整角色",
  });

it("requires an explicit current baseline and a nonblank reason for both change types", () => {
  for (const type of ["user.permissions", "user.role"]) {
    const schema =
      type === "user.permissions" ? teachingPermissionsCommandSchema : teachingRoleCommandSchema;
    const command = type === "user.permissions" ? permission() : role("STUDENT", 0);
    expect(schema.safeParse({ ...command, expectedVersion: undefined }).success).toBe(false);
    expect(schema.safeParse({ ...command, reason: "  " }).success).toBe(false);
  }
});
it("replaces permissions and records immutable before/after identities, names, reason and version in the transaction", async () => {
  expect(await changeTeachingPermissions("admin", permission(), f.db)).toEqual({
    id: "teacher",
    permissionsVersion: 1,
  });
  expect(f.assignments()).toEqual([
    normalize({ role: "SUBJECT_TEACHER", classroomId: "class-b", subject: "数学" }),
  ]);
  expect(f.events()).toMatchObject([
    {
      type: "user.permissions",
      version: 1,
      actorId: "admin",
      actorName: "管理员甲",
      targetName: "教师",
      reason: "调整本学期任课",
      before: { role: "TEACHER", assignments: [{ role: "HOMEROOM", classroomId: "class-a" }] },
      after: {
        role: "TEACHER",
        assignments: [{ role: "SUBJECT_TEACHER", classroomId: "class-b", subject: "数学" }],
      },
    },
  ]);
  expect(f.api.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
    f.api.$queryRaw.mock.invocationCallOrder[0],
  );
});
it("gives exactly one concurrent administrator the original version and rejects the other's full replacement", async () => {
  const results = await Promise.allSettled([
    changeTeachingPermissions("admin", permission(), f.db),
    changeTeachingPermissions("admin-b", { ...permission(), assignments: [] }, f.db),
  ]);
  expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
  expect(results.find((row) => row.status === "rejected")).toMatchObject({
    reason: { status: 409 },
  });
  expect(f.events()).toHaveLength(1);
  expect(f.user().permissionsVersion).toBe(1);
});
it("writes nothing when a stale baseline is replayed", async () => {
  await changeTeachingPermissions("admin", permission(), f.db);
  const snapshot = structuredClone(f.events());
  await expect(changeTeachingPermissions("admin-b", permission(), f.db)).rejects.toMatchObject({
    status: 409,
  });
  expect(f.events()).toEqual(snapshot);
  expect(f.api.teachingAssignment.deleteMany).toHaveBeenCalledTimes(1);
});
it("versions and audits automatic classroom-owner grants without acquiring the admin lock after the domain lock", async () => {
  await f.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(7240132026::bigint)::text`;
    await executeClassroomsCommand(
      tx,
      { id: "teacher", role: "TEACHER", name: "教师" },
      {
        type: "classroom.save",
        classroom: { name: "新班级", stage: "高中", cohort: "2026" },
      },
    );
  });
  expect(f.user().permissionsVersion).toBe(1);
  expect(f.assignments()).toEqual([
    normalize({ role: "HOMEROOM", classroomId: "class-a" }),
    normalize({ role: "HOMEROOM", classroomId: "class-new" }),
  ]);
  expect(f.events()).toMatchObject([
    {
      type: "classroom.save",
      actorId: "teacher",
      version: 1,
      before: { assignments: [{ role: "HOMEROOM", classroomId: "class-a" }] },
      after: {
        assignments: [
          { role: "HOMEROOM", classroomId: "class-a" },
          { role: "HOMEROOM", classroomId: "class-new" },
        ],
      },
    },
  ]);
  expect(f.events()[0].reason).toContain("新建班级");
  expect(f.api.$executeRaw).not.toHaveBeenCalled();
  await expect(changeTeachingPermissions("admin", permission(0), f.db)).rejects.toMatchObject({
    status: 409,
  });
  expect(f.events()).toHaveLength(1);
});
it("advances the shared version and audits role changes so teacher to student to teacher cannot revive old grants", async () => {
  await changeTeachingPermissions("admin", role("STUDENT", 0), f.db);
  expect(f.assignments()).toEqual([]);
  await changeTeachingPermissions("admin", role("TEACHER", 1), f.db);
  await expect(changeTeachingPermissions("admin-b", permission(0), f.db)).rejects.toMatchObject({
    status: 409,
  });
  expect(f.user()).toMatchObject({ role: "TEACHER", permissionsVersion: 2 });
  expect(f.events().map((row) => row.version)).toEqual([1, 2]);
  expect(f.assignments()).toEqual([]);
});
it("rechecks a revoked administrator inside the transaction", async () => {
  await changeTeachingPermissions("admin-b", { ...role("STUDENT", 0), id: "admin" }, f.db);
  const count = f.events().length;
  await expect(changeTeachingPermissions("admin", permission(), f.db)).rejects.toMatchObject({
    status: 403,
  });
  expect(f.user().permissionsVersion).toBe(0);
  expect(f.events()).toHaveLength(count);
});
it("preserves the last administrator and rejects nonteacher grant targets", async () => {
  await changeTeachingPermissions("admin", { ...role("TEACHER", 0), id: "admin-b" }, f.db);
  await expect(
    changeTeachingPermissions("admin", { ...role("TEACHER", 0), id: "admin" }, f.db),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    changeTeachingPermissions("admin", { ...permission(), id: "student" }, f.db),
  ).rejects.toMatchObject({ status: 400 });
  expect(f.user("admin").role).toBe("ADMIN");
  expect(f.events()).toHaveLength(1);
});
it("rejects invalid classrooms before changing any user, grant or history", async () => {
  await expect(
    changeTeachingPermissions(
      "admin",
      { ...permission(), assignments: [{ role: "HOMEROOM", classroomId: "missing" }] },
      f.db,
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(f.user().permissionsVersion).toBe(0);
  expect(f.events()).toHaveLength(0);
  expect(f.api.teachingAssignment.deleteMany).not.toHaveBeenCalled();
});
it("rolls back the role, version and grants if the immutable audit cannot be saved", async () => {
  f.api.teachingPermissionsEvent.create.mockRejectedValueOnce(new Error("audit unavailable"));
  await expect(changeTeachingPermissions("admin", permission(), f.db)).rejects.toThrow(
    "audit unavailable",
  );
  expect(f.user().permissionsVersion).toBe(0);
  expect(f.assignments()).toEqual([normalize({ role: "HOMEROOM", classroomId: "class-a" })]);
  expect(f.events()).toHaveLength(0);
});
it("paginates only the target's events in timestamp/id order and retains original history after later saves", async () => {
  for (let version = 0; version < 4; version++)
    await changeTeachingPermissions("admin", permission(version), f.db);
  await changeTeachingPermissions("admin", { ...role("TEACHER", 0), id: "student" }, f.db);
  const first = await loadTeachingPermissionsHistory("admin", "teacher", { limit: 2 }, f.db);
  expect(first.events.map((row) => row.version)).toEqual([4, 3]);
  expect(first.user.permissionsVersion).toBe(4);
  const next = await loadTeachingPermissionsHistory(
    "admin",
    "teacher",
    { limit: 2, beforeId: first.nextBeforeId },
    f.db,
  );
  expect(next.events.map((row) => row.version)).toEqual([2, 1]);
  expect(next.nextBeforeId).toBeNull();
  expect(first.events[0].after.assignments).toEqual([
    { role: "SUBJECT_TEACHER", classroomId: "class-b", subject: "数学" },
  ]);
  expect(new Set([...first.events, ...next.events].map((row) => row.id)).size).toBe(4);
});
it("rejects a different target's cursor, malformed pagination and absent users", async () => {
  await changeTeachingPermissions("admin", permission(), f.db);
  const cursor = f.events()[0].id;
  await expect(
    loadTeachingPermissionsHistory("admin", "student", { beforeId: cursor }, f.db),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    loadTeachingPermissionsHistory("admin", "teacher", { limit: 0 }, f.db),
  ).rejects.toMatchObject({ status: 400 });
  await expect(loadTeachingPermissionsHistory("admin", "absent", {}, f.db)).rejects.toMatchObject({
    status: 404,
  });
});
it.each(["teacher", "student"])(
  "does not expose permission history to %s or a former administrator",
  async (id) => {
    await expect(loadTeachingPermissionsHistory(id, "teacher", {}, f.db)).rejects.toMatchObject({
      status: 403,
    });
    expect(f.api.teachingPermissionsEvent.findMany).not.toHaveBeenCalled();
  },
);
