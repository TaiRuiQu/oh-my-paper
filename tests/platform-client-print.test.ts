// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { printClientDocument } from "@/lib/client-print";

let content: HTMLDivElement;
let printed: Document;
let frame: HTMLIFrameElement | undefined;
let printEvents: EventTarget;
const focus = vi.fn();
const print = vi.fn();
let failStylesheet = false;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  frame = undefined;
  failStylesheet = false;
  document.head.innerHTML =
    '<style>.p-document-page{font-family:var(--document-font-family)}</style><link rel="stylesheet" href="/document.css">';
  document.body.innerHTML = "<aside>应用导航不应打印</aside>";
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 0;
  });
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  content = document.createElement("div");
  content.className = "p-document-pages";
  content.style.setProperty("--document-font-family", '"Noto Serif CJK SC"');
  content.innerHTML =
    '<article class="p-document-page">第一题<img src="/api/platform/assets/private-image"></article>';
  document.body.append(content);
  printed = document.implementation.createHTMLDocument();
  Object.defineProperty(printed, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  printEvents = new EventTarget();
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((name, options) => {
    const element = create(name, options);
    if (name === "iframe") {
      frame = element as HTMLIFrameElement;
      Object.defineProperty(frame, "contentDocument", { value: printed });
      Object.defineProperty(frame, "contentWindow", {
        value: {
          focus,
          print,
          addEventListener: printEvents.addEventListener.bind(printEvents),
        },
      });
    }
    return element;
  });
  const append = HTMLHeadElement.prototype.appendChild;
  vi.spyOn(HTMLHeadElement.prototype, "appendChild").mockImplementation(function <T extends Node>(
    this: HTMLHeadElement,
    child: T,
  ): T {
    const result = append.call(this, child) as T;
    if (child instanceof HTMLLinkElement)
      queueMicrotask(() => child.dispatchEvent(new Event(failStylesheet ? "error" : "load")));
    return result;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});
const start = () =>
  printClientDocument({
    content,
    title: "本机字体试卷",
    paperSize: "A3",
    orientation: "landscape",
  });
it("waits for fonts and final pagination, prints only the document with its local font, and cleans up after printing", async () => {
  const fonts = deferred();
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: fonts.promise } });
  const paginate = vi.fn(() => {
    content.querySelector("article")!.textContent = "字体就绪后重新分页的题目";
  });
  content.addEventListener("omp:prepare-print", paginate);
  const running = start();
  await Promise.resolve();
  expect(print).not.toHaveBeenCalled();
  fonts.resolve();
  await running;
  expect(paginate).toHaveBeenCalledOnce();
  expect(print).toHaveBeenCalledOnce();
  expect(focus).toHaveBeenCalledOnce();
  expect(printed.body.textContent).toContain("字体就绪后重新分页的题目");
  expect(printed.body.textContent).not.toContain("应用导航");
  expect(
    printed
      .querySelector<HTMLElement>(".p-document-pages")!
      .style.getPropertyValue("--document-font-family"),
  ).toBe('"Noto Serif CJK SC"');
  expect(printed.head.textContent).toContain("size:A3 landscape");
  expect(printed.title).toBe("本机字体试卷");
  expect(frame?.isConnected).toBe(true);
  printEvents.dispatchEvent(new Event("afterprint"));
  expect(frame?.isConnected).toBe(false);
});
it("stops and removes the print frame when styles cannot load", async () => {
  failStylesheet = true;
  await expect(start()).rejects.toThrow("打印样式加载失败");
  expect(print).not.toHaveBeenCalled();
  expect(frame?.isConnected).toBe(false);
});
it("does not print an incomplete document when a source image cannot decode", async () => {
  vi.mocked(HTMLImageElement.prototype.decode).mockRejectedValue(new Error("图片读取失败"));
  await expect(start()).rejects.toThrow("图片读取失败");
  expect(print).not.toHaveBeenCalled();
  expect(frame).toBeUndefined();
});
it("cleans up if the browser refuses to open printing", async () => {
  print.mockImplementationOnce(() => {
    throw new Error("浏览器拒绝打印");
  });
  await expect(start()).rejects.toThrow("浏览器拒绝打印");
  expect(frame?.isConnected).toBe(false);
});
