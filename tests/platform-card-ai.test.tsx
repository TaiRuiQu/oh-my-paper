// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CardAIPage } from "@/components/platform/card-ai-page";
import { CardsListPage } from "@/components/platform/card-workbench";
import { MockEventSource } from "./fixtures/event-source";

const mock = vi.hoisted(() => ({ request: vi.fn(), push: vi.fn(), notify: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
vi.mock("@/lib/http-client", async (original) => ({
  ...(await original<typeof import("@/lib/http-client")>()),
  apiRequest: mock.request,
}));
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({
    state: {
      actor: { id: "teacher", role: "TEACHER" },
      templates: [],
      papers: [
        { id: "exam", name: "数学月考", kind: "EXAM", ownerId: "teacher" },
        { id: "homework", name: "课后作业", kind: "HOMEWORK", ownerId: "teacher" },
        { id: "peer", name: "他人试卷", kind: "EXAM", ownerId: "peer" },
      ],
    },
    refresh: vi.fn(),
    notify: mock.notify,
  }),
}));

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  MockEventSource.install();
  mock.request.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? { id: "job" }
      : { models: [{ id: "model", name: "测试模型" }], jobs: [] },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("exposes AI layout from the card list", async () => {
  await act(async () => root.render(<CardsListPage />));
  expect(container.querySelector('a[href="/exams/cards/ai"]')?.textContent).toContain(
    "AI 自动排版",
  );
});

it("preselects the current exam, submits a TEMPLATE job and opens its progress page", async () => {
  await act(async () => {
    root.render(<CardAIPage paperId="exam" />);
  });
  await act(async () => {
    MockEventSource.current.snapshot({ models: [{ id: "model", name: "测试模型" }], jobs: [] });
  });
  const select = container.querySelector<HTMLSelectElement>('select[name="target"]')!;
  expect(select.value).toBe("exam");
  expect([...select.options].map((o) => o.value)).toEqual(["", "exam"]);
  const submit = container.querySelector<HTMLButtonElement>(".p-ai-form button")!;
  expect(submit.disabled).toBe(false);
  // readForm uses the browser FormData constructor for the submitting form.
  const FormDataBefore = globalThis.FormData;
  globalThis.FormData = window.FormData;
  try {
    await act(async () => submit.click());
  } finally {
    globalThis.FormData = FormDataBefore;
  }
  const post = mock.request.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(post[1].body)).toEqual({
    kind: "TEMPLATE",
    modelId: "model",
    input: { paperId: "exam" },
  });
  expect(mock.push).toHaveBeenCalledWith("/workspace/ai/job");
});
