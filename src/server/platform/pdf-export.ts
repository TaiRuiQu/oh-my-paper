import "server-only";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import puppeteer from "puppeteer-core";
import { RequestError } from "@/server/http/errors";

export type ExportAsset = { buffer: Buffer; contentType: string };
export type ExportAssetLoader = (url: string) => Promise<ExportAsset>;

export async function chromiumPath() {
  const configured = process.env.CHROMIUM_EXECUTABLE_PATH;
  if (configured) return configured;
  for (const path of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"])
    if (existsSync(path)) return path;
  // Local browser QA installations can also supply the export renderer.
  const cache = join(homedir(), ".cache/ms-playwright");
  for (const entry of (await readdir(cache).catch(() => [])).sort().reverse()) {
    if (!entry.startsWith("chromium-")) continue;
    const path = join(cache, entry, "chrome-linux64/chrome");
    if (existsSync(path)) return path;
  }
  throw new RequestError(503, "PDF 导出需要 Chromium，请安装或配置 CHROMIUM_EXECUTABLE_PATH。");
}

let active = 0;
const pending: (() => void)[] = [];

/** Render private documents without giving Chromium network or session access. */
export async function renderPdf(html: string, loadAsset: ExportAssetLoader): Promise<Buffer> {
  if (active >= 2) await new Promise<void>((resolve) => pending.push(resolve));
  else active++;
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: await chromiumPath(),
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.emulateMediaType("print");
    await page.setRequestInterception(true);
    const origin = "https://document.omp.invalid";
    const fontRoot = resolve("public/print-fonts") + sep;
    let resourceError: unknown;
    page.on("request", (request) => {
      void (async () => {
        const url = new URL(request.url());
        if (url.protocol === "data:") return request.continue();
        if (url.origin !== origin) return request.abort();
        if (/^\/api\/platform\/assets\/[\w-]+$/.test(url.pathname)) {
          const asset = await loadAsset(url.pathname);
          return request.respond({
            status: 200,
            contentType: asset.contentType,
            body: asset.buffer,
          });
        }
        if (url.pathname.startsWith("/print-fonts/")) {
          const path = resolve("public", "." + decodeURIComponent(url.pathname));
          if (path.startsWith(fontRoot) && /\.(css|woff2?)$/.test(path))
            return request.respond({
              status: 200,
              contentType: path.endsWith(".css") ? "text/css" : "font/woff2",
              body: await readFile(path),
            });
        }
        return request.abort();
      })().catch(async (error) => {
        resourceError = error;
        if (!request.isInterceptResolutionHandled()) await request.abort();
      });
    });
    await page.setContent(
      html.replace('<meta charset="utf-8">', `<meta charset="utf-8"><base href="${origin}/">`),
      {
        waitUntil: "load",
        timeout: 60000,
      },
    );
    await page.waitForNetworkIdle({ timeout: 60000 });
    if (resourceError) throw resourceError;
    await page.evaluate(async () => {
      await document.fonts.ready;
      if (Array.from(document.images).some((image) => !image.complete || !image.naturalWidth))
        throw new Error("题目配图加载失败，请重试导出。");
    });
    return Buffer.from(
      await page.pdf({ preferCSSPageSize: true, printBackground: true, timeout: 60000 }),
    );
  } finally {
    try {
      await browser?.close();
    } finally {
      const next = pending.shift();
      if (next) next();
      else active--;
    }
  }
}
