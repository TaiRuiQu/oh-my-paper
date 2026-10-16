// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlatformState } from "@/contracts/platform";
import { ClassEditPage, StudentEditPage } from "@/components/platform/class-pages";
import { apiRequest } from "@/lib/http-client";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/platform/account-import", () => ({ AccountImport: () => null }));
vi.mock("@/lib/http-client", () => ({
  apiRequest: vi.fn(),
  jsonBody: (body: unknown) => ({ body: JSON.stringify(body) }),
}));
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({
    state: {
      actor: { id: "owner", name: "教师", role: "TEACHER" },
      classrooms: [
        {
          id: "class",
          ownerId: "owner",
          name: "一班",
          stage: "高中",
          cohort: "2027届",
          students: [
            {
              id: "student",
              classroomId: "class",
              name: "小明",
              studentNumber: "123456",
              userId: null,
            },
          ],
        },
      ],
      users: [
        {
          id: "account",
          name: "小红",
          role: "STUDENT",
          username: "654321",
          email: "student@example.test",
        },
      ],
    } satisfies Pick<PlatformState, "actor" | "classrooms" | "users">,
    mutate: mocks.mutate,
    pending: false,
  }),
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render(page: ReactNode) {
  await act(async () => root.render(page));
}
function field(name: string) {
  return host.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
}
async function fill(name: string, value: string) {
  const input = field(name);
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value);
    input.dispatchEvent(
      new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }),
    );
  });
}
function cancel() {
  return [...host.querySelectorAll("button")].find((entry) => entry.textContent === "取消")!;
}
async function bindExistingAccount() {
  vi.mocked(apiRequest).mockResolvedValueOnce({
    users: [
      {
        id: "account",
        name: "小红",
        role: "STUDENT",
        username: "654321",
        email: "student@example.test",
      },
    ],
    total: 1,
  });
  const search = host.querySelector<HTMLInputElement>('input[aria-label="搜索已有学生账号"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "小红");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {});
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="选择学生账号 小红"]')!.click(),
  );
}
async function submitTwice() {
  await act(async () => {
    const form = host.querySelector("form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
function unloading() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

it.each([
  { kind: "class", existing: false },
  { kind: "class", existing: true },
  { kind: "student", existing: false },
  { kind: "student", existing: true },
])(
  "freezes $kind existing=$existing before awaiting and keeps the complete failed form for retry",
  async ({ kind, existing }) => {
    let finish!: (result: { error: string }) => void;
    mocks.mutate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(
      kind === "class" ? (
        <ClassEditPage id={existing ? "class" : undefined} />
      ) : (
        <StudentEditPage classroomId="class" studentId={existing ? "student" : undefined} />
      ),
    );
    await fill("name", "待保存的姓名或班级");
    if (kind === "class") {
      await fill("stage", "初中");
      await fill("cohort", "2028届");
    } else {
      await fill("studentNumber", "234567");
      if (existing) await bindExistingAccount();
    }
    await submitTwice();
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(host.querySelector("form")?.hasAttribute("inert")).toBe(true);
    expect(host.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
    expect(
      [...host.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")].every(
        (input) => input.disabled,
      ),
    ).toBe(true);
    field("name").focus();
    expect(document.activeElement).not.toBe(field("name"));
    expect(cancel().disabled).toBe(true);
    await act(async () => cancel().click());
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject(
      kind === "class"
        ? {
            type: "classroom.save",
            classroom: { name: "待保存的姓名或班级", stage: "初中", cohort: "2028届" },
          }
        : {
            type: "student.save",
            student: {
              name: "待保存的姓名或班级",
              classroomId: "class",
              studentNumber: "234567",
              ...(existing ? { userId: "account" } : {}),
            },
          },
    );
    await act(async () => finish({ error: "服务暂不可用，请重试" }));
    expect(host.textContent).toContain("服务暂不可用，请重试");
    expect(field("name").value).toBe("待保存的姓名或班级");
    expect(field(kind === "class" ? "cohort" : "studentNumber").value).toBe(
      kind === "class" ? "2028届" : "234567",
    );
    expect(host.querySelector("form")?.hasAttribute("inert")).toBe(false);
    expect(field("name").disabled).toBe(false);
    expect(cancel().disabled).toBe(false);
    expect(unloading()).toBe(true);
    expect(mocks.push).not.toHaveBeenCalled();
    mocks.mutate.mockResolvedValue({ id: "saved" });
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    expect(mocks.push).toHaveBeenCalledWith(
      kind === "class" ? "/workspace/classes/saved" : "/workspace/classes/class/students",
    );
    expect(unloading()).toBe(false);
  },
);

it.each(["class", "student"])(
  "protects dirty %s cancellation without a duplicate navigation confirmation",
  async (kind) => {
    await render(
      kind === "class" ? <ClassEditPage id="class" /> : <StudentEditPage classroomId="class" />,
    );
    await fill("name", "还未保存");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => cancel().click());
    expect(confirm).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(field("name").value).toBe("还未保存");
    confirm.mockReturnValue(true);
    await act(async () => cancel().click());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(mocks.push).toHaveBeenCalledWith(
      kind === "class" ? "/workspace/classes/class" : "/workspace/classes/class/students",
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
  },
);

it("retains a newly created student's credentials after the frozen save instead of navigating away", async () => {
  let finish!: (result: {
    id: string;
    credentials: { username: string; password: string };
  }) => void;
  mocks.mutate.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(<StudentEditPage classroomId="class" />);
  await fill("name", "新同学");
  await submitTwice();
  expect(cancel().disabled).toBe(true);
  await act(async () =>
    finish({
      id: "new-student",
      credentials: { username: "543210", password: "temporary-test-password" },
    }),
  );
  expect(host.textContent).toContain("账号已创建");
  expect(host.textContent).toContain("543210");
  expect(host.textContent).toContain("temporary-test-password");
  expect(host.querySelector("form")).toBeNull();
  expect(host.querySelector('a[href="/workspace/classes/class/students"]')).not.toBeNull();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.mutate).toHaveBeenCalledOnce();
  expect(unloading()).toBe(false);
});
