// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CardEditorPage } from "@/components/platform/card-workbench";
import { generateCardTemplate } from "@/lib/cards";
import type { Paper } from "@/contracts/platform";

const mock = vi.hoisted(() => ({ state: {} as Record<string, unknown>, mutate: vi.fn() }));
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({ state: mock.state, pending: false, mutate: mock.mutate }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/platform/questions", () => ({ QuestionEditor: () => null }));
vi.mock("@/components/platform/question-bank-picker", () => ({ QuestionBankPicker: () => null }));

let container: HTMLDivElement, root: Root;
let resize: ResizeObserverCallback;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const paper: Paper = {
    id: "paper",
    ownerId: "teacher",
    name: "测试",
    kind: "EXAM",
    subject: "数学",
    grade: "高一",
    instructions: "",
    layout: { paperSize: "A4", columns: 1 },
    items: [],
    createdAt: "",
    updatedAt: "",
  };
  const card = generateCardTemplate(paper);
  mock.state = {
    actor: { id: "teacher" },
    papers: [paper],
    templates: [card],
    submissions: [],
    classrooms: [],
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CardEditorPage id={card.id} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function button(name: string) {
  return [...container.querySelectorAll("button")].find(
    (node) => node.getAttribute("aria-label") === name || node.textContent === name,
  )!;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
async function resizeTo(width: number) {
  Object.defineProperty(container.querySelector(".p-card-preview-scroll"), "clientWidth", {
    value: width,
    configurable: true,
  });
  await act(async () =>
    resize([{ contentRect: { width } }] as ResizeObserverEntry[], {} as ResizeObserver),
  );
}

it("defaults to half the desktop window, fits smaller viewports, and lets explicit fitting use the full canvas", async () => {
  await resizeTo(900);
  expect(width()).toBe(`${window.innerWidth / 2}px`);
  expect(button("适应宽度").getAttribute("aria-pressed")).toBe("false");
  await click("适应宽度");
  expect(width()).toBe("900px");
});

it("refits the default preview on window resize and uses available width on phones", async () => {
  const original = window.innerWidth;
  try {
    Object.defineProperty(window, "innerWidth", { value: 1920, configurable: true });
    await resizeTo(1200);
    expect(parseFloat(width())).toBeCloseTo(960);
    Object.defineProperty(window, "innerWidth", { value: 1600, configurable: true });
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(parseFloat(width())).toBeCloseTo(800);
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    await resizeTo(320);
    expect(parseFloat(width())).toBeCloseTo(320);
  } finally {
    Object.defineProperty(window, "innerWidth", { value: original, configurable: true });
  }
});
function width() {
  return container
    .querySelector<HTMLElement>(".p-card-stage .p-card-preview")!
    .style.getPropertyValue("--card-width");
}

it("fits narrow viewports, preserves manual zoom on resize, and resumes fitting on request", async () => {
  await resizeTo(280);
  expect(width()).toBe("280px");
  await click("放大");
  expect(parseFloat(width())).toBeGreaterThan(280);
  const manual = width();
  await resizeTo(600);
  expect(width()).toBe(manual);
  await click("适应宽度");
  expect(width()).toBe("600px");
  expect(button("适应宽度").getAttribute("aria-pressed")).toBe("true");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[title="恢复 100%"]')!.click(),
  );
  expect(width()).toBe("794px");
  expect(container.querySelector(".p-save-state")?.textContent).toBe("已保存");
});

it("limits manual zoom to 10–300 percent", async () => {
  await resizeTo(794);
  for (let i = 0; i < 25; i++) await click("放大");
  expect(width()).toBe("2382px");
  expect(button("放大").disabled).toBe(true);
  for (let i = 0; i < 35; i++) await click("缩小");
  expect(parseFloat(width())).toBeCloseTo(79.4);
  expect(button("缩小").disabled).toBe(true);
});

it("switches A4 to portrait and A3 to landscape while retaining fit and identification mode", async () => {
  await resizeTo(600);
  await click("适应宽度");
  await act(async () =>
    [...container.querySelectorAll<HTMLInputElement>('input[name="number-style"]')][1].click(),
  );
  await click("A3 纸");
  expect(container.querySelector(".p-card-sheet")?.getAttribute("style")).toContain("1587/1123");
  expect(container.querySelector(".p-card-stage-footer")?.textContent).toContain("横向");
  expect(container.querySelector(".p-card-artwork")?.textContent).toContain("贴条形码区");
  expect(width()).toBe("600px");
  await click("A4 纸");
  expect(container.querySelector(".p-card-stage-footer")?.textContent).toContain("纵向");
  expect(container.querySelector(".p-card-sheet")?.getAttribute("style")).toContain("794/1123");
  expect(container.querySelector('option[value="landscape"]')).toBeNull();
});

it("switches header pages, hides the number editing target on continuation pages, and persists the selection", async () => {
  const paper = (mock.state.papers as Paper[])[0];
  paper.items = Array.from({ length: 16 }, (_, index) => ({
    id: `item-${index}`,
    questionId: `q-${index}`,
    position: index,
    score: 10,
    section: "解答题",
    snapshot: {
      id: `q-${index}`,
      ownerId: "teacher",
      type: "SUBJECTIVE",
      subject: "数学",
      grade: "高一",
      difficulty: 0.5,
      knowledgeTags: [],
      createdAt: "",
      updatedAt: "",
      content: {
        stem: "解答题",
        options: [],
        answers: [],
        explanation: "",
        rubric: "",
        images: [],
        parts: [],
      },
    },
  }));
  const card = generateCardTemplate(paper);
  mock.state.templates = [card];
  await act(async () => root.render(<CardEditorPage key="multi-page" id={card.id} />));
  const mode = [...container.querySelectorAll<HTMLSelectElement>("select")].find((select) =>
    select.querySelector('option[value="ODD_PAGES"]'),
  )!;
  expect(mode.value).toBe("EVERY_PAGE");
  expect([...mode.options].map((option) => option.textContent)).toEqual([
    "每页都有",
    "仅奇数页有（双面打印）",
    "只有第一页有（按顺序扫描）",
  ]);
  async function selectMode(value: string) {
    await act(async () => {
      mode.value = value;
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  await selectMode("ODD_PAGES");
  await click("下一页");
  expect(container.querySelector("[data-card-header]")).toBeNull();
  expect(container.querySelector(".p-card-number")).toBeNull();
  await click("下一页");
  expect(container.querySelector("[data-card-header]")).not.toBeNull();
  expect(container.querySelector(".p-card-number")).not.toBeNull();
  await selectMode("FIRST_PAGE");
  await click("下一页");
  await click("下一页");
  expect(container.querySelector("[data-card-header]")).toBeNull();
  mock.mutate.mockResolvedValue({});
  await click("保存");
  expect(mock.mutate.mock.calls.at(-1)?.[0].template.layout.headerMode).toBe("FIRST_PAGE");
  await click("锁定");
  expect(mode.disabled || mode.closest("fieldset")?.disabled).toBe(true);
});
