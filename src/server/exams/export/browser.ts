import "server-only";
import { access } from "node:fs/promises";
import puppeteer, { type Page } from "puppeteer-core";
import { AppError } from "@/server/errors";
import type { ExportDocument, ExportImage } from "./document";
import { exportHtml } from "./html";
async function chromePath() {
  if (process.env.EXPORT_CHROMIUM_PATH) return process.env.EXPORT_CHROMIUM_PATH;
  for (const path of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
    if (
      await access(path).then(
        () => true,
        () => false,
      )
    )
      return path;
  }
  throw new AppError(
    "请安装 Chromium，或通过 EXPORT_CHROMIUM_PATH 指定浏览器路径。",
    "EXPORT_BROWSER_UNAVAILABLE",
    503,
  );
}
export async function withExportPage<T>(
  document: ExportDocument,
  signal: AbortSignal | undefined,
  work: (page: Page) => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  const html = await exportHtml(document);
  const browser = await puppeteer.launch({
    executablePath: await chromePath(),
    headless: true,
    timeout: 30_000,
    protocolTimeout: 60_000,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" },
  });
  const abort = () => {
    void browser.close().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 90_000);
  try {
    signal?.throwIfAborted();
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 3 });
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    // Everything needed is embedded; uploaded Markdown cannot cause network or file reads.
    page.on("request", (request) => {
      void (
        request.url().startsWith("data:") || request.url() === "about:blank"
          ? request.continue()
          : request.abort()
      ).catch(() => {});
    });
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(async () => {
      await globalThis.document.fonts.ready;
      await globalThis.document.fonts.load('11pt "NSimSun"');
    });
    await page.evaluate(() => {
      for (const element of globalThis.document.querySelectorAll<HTMLElement>("[data-formula]")) {
        const cell = element.closest("td,th");
        const available = cell
          ? cell.clientWidth -
            parseFloat(getComputedStyle(cell).paddingLeft) -
            parseFloat(getComputedStyle(cell).paddingRight) -
            4
          : 638;
        if (element.scrollWidth > available)
          element.style.fontSize = `${(parseFloat(getComputedStyle(element).fontSize) * available) / element.scrollWidth}px`;
      }
    });
    signal?.throwIfAborted();
    return await work(page);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    await browser.close();
  }
}
export async function formulaImages(page: Page, document: ExportDocument, signal?: AbortSignal) {
  const images = new Map<string, ExportImage>();
  for (const formula of document.formulas.values()) {
    signal?.throwIfAborted();
    const element = await page.$(`[data-formula="${formula.id}"]`);
    if (!element) throw new AppError("数学公式渲染失败。", "EXPORT_FORMULA_FAILED", 422);
    try {
      const metrics = await element.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const baseline = element.querySelector(".formula-baseline")!.getBoundingClientRect();
        return { width: box.width, height: box.height, baseline: box.bottom - baseline.top };
      });
      const png = await element.screenshot({ type: "png" });
      images.set(formula.id, {
        data: Buffer.from(png),
        ...metrics,
        type: "png",
        description: formula.latex,
      });
    } finally {
      await element.dispose();
    }
  }
  return images;
}
