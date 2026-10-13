import "server-only";
import { access } from "node:fs/promises";
import puppeteer, { type Page } from "puppeteer-core";
import { AppError } from "@/server/errors";
import { PAGE_WIDTH_PX, SHEET_WIDTH_PX, SHEET_HEIGHT_PX, type ExportDocument } from "./document";
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
    await page.setViewport({ width: 794, height: 560, deviceScaleFactor: 3 });
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
      await globalThis.document.fonts.load('5.5pt "NSimSun"');
    });
    await page.evaluate((columnWidth) => {
      for (const element of globalThis.document.querySelectorAll<HTMLElement>("[data-formula]")) {
        const cell = element.closest("td,th");
        const available = cell
          ? cell.clientWidth -
            parseFloat(getComputedStyle(cell).paddingLeft) -
            parseFloat(getComputedStyle(cell).paddingRight) -
            4
          : columnWidth - 4;
        if (element.scrollWidth > available)
          element.style.fontSize = `${(parseFloat(getComputedStyle(element).fontSize) * available) / element.scrollWidth}px`;
      }
      for (const choices of globalThis.document.querySelectorAll<HTMLElement>(".choices")) {
        if ([...choices.children].some((option) => option.scrollWidth > option.clientWidth + 1))
          choices.classList.add("choices-wide");
      }
    }, PAGE_WIDTH_PX);
    await paginateExportPage(page);
    signal?.throwIfAborted();
    return await work(page);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    await browser.close();
  }
}

// Explicit sheets avoid Chromium's horizontal overflow when printing multicolumn content.
export async function paginateExportPage(page: Page) {
  // tsx annotates local functions when running the export verification script.
  await page.evaluate("globalThis.__name ??= (fn) => fn");
  await page.evaluate(
    ({ width, height }) => {
      const doc = globalThis.document;
      const source = doc.querySelector<HTMLElement>(".print-source")!;
      const header = source.querySelector<HTMLElement>(".paper-header")!;
      const pending = [...source.children].filter((element) => element !== header) as HTMLElement[];
      let columns: HTMLElement[] = [],
        columnIndex = 0,
        pageNumber = 0;
      function sheet() {
        const sheet = doc.createElement("section");
        sheet.className = "paper-page";
        sheet.style.width = `${width}px`;
        sheet.style.height = `${height}px`;
        const grid = doc.createElement("div");
        grid.className = "paper-columns";
        columns = Array.from({ length: 4 }, () => {
          const column = doc.createElement("div");
          column.className = "paper-column";
          grid.append(column);
          return column;
        });
        sheet.append(grid);
        doc.body.append(sheet);
        if (!pageNumber) {
          sheet.prepend(header);
          const inset = header.getBoundingClientRect().height + 7;
          columns[0].style.paddingTop = columns[1].style.paddingTop = `${inset}px`;
        }
        const footer = doc.createElement("footer");
        footer.className = "paper-footer";
        footer.textContent = `— ${++pageNumber} —`;
        sheet.append(footer);
        columnIndex = 0;
      }
      function advance() {
        if (++columnIndex === 4) sheet();
      }
      const fits = (element: HTMLElement) =>
        element.getBoundingClientRect().bottom <=
        columns[columnIndex].getBoundingClientRect().bottom + 0.5;
      function split(element: HTMLElement) {
        // Split long prose at a rendered text boundary; formulas and images stay atomic.
        const boundaries: { node: Node; offset: number }[] = [];
        function walk(node: Node) {
          if (node.nodeType === Node.TEXT_NODE) {
            for (let offset = 1; offset <= (node.textContent?.length ?? 0); offset++)
              boundaries.push({ node, offset });
          } else if (
            node instanceof Element &&
            (node.matches(".export-formula,img,table") || node.tagName === "BR")
          ) {
            boundaries.push({
              node: node.parentNode!,
              offset: [...node.parentNode!.childNodes].indexOf(node as ChildNode) + 1,
            });
          } else node.childNodes.forEach(walk);
        }
        walk(element);
        const range = doc.createRange();
        range.selectNodeContents(element);
        let low = 0,
          high = boundaries.length - 1,
          best = -1;
        const probe = element.cloneNode(false) as HTMLElement;
        element.replaceWith(probe);
        while (low <= high) {
          const middle = Math.floor((low + high) / 2),
            boundary = boundaries[middle];
          range.setEnd(boundary.node, boundary.offset);
          probe.replaceChildren(range.cloneContents());
          if (fits(probe)) {
            best = middle;
            low = middle + 1;
          } else high = middle - 1;
        }
        if (best < 0 || best === boundaries.length - 1) {
          probe.replaceWith(element);
          return null;
        }
        range.setEnd(boundaries[best].node, boundaries[best].offset);
        probe.replaceChildren(range.cloneContents());
        const remainder = element.cloneNode(false) as HTMLElement;
        range.selectNodeContents(element);
        range.setStart(boundaries[best].node, boundaries[best].offset);
        remainder.append(range.cloneContents());
        return remainder;
      }
      function splitTable(element: HTMLElement, table: HTMLTableElement) {
        const rows = [...table.querySelectorAll("tbody tr")];
        const header = table.querySelector("thead");
        if (rows.length < 2) return null;
        function fragment(items: Element[]) {
          const copy = table.cloneNode(false) as HTMLTableElement;
          if (header) copy.append(header.cloneNode(true));
          const body = doc.createElement("tbody");
          body.append(...items.map((row) => row.cloneNode(true)));
          copy.append(body);
          if (element === table) return copy;
          const wrapper = element.cloneNode(false) as HTMLElement;
          wrapper.append(copy);
          return wrapper;
        }
        let probe = fragment([]),
          used = 0;
        element.replaceWith(probe);
        for (let count = 1; count < rows.length; count++) {
          const next = fragment(rows.slice(0, count));
          probe.replaceWith(next);
          probe = next;
          if (!fits(probe)) break;
          used = count;
        }
        if (!used) {
          probe.replaceWith(element);
          return null;
        }
        probe.replaceWith(fragment(rows.slice(0, used)));
        return fragment(rows.slice(used));
      }
      sheet();
      while (pending.length) {
        const element = pending.shift()!;
        const column = columns[columnIndex];
        // Keep a section's shared instructions with the start of its first question.
        if (element.classList.contains("section-instructions") && pending[0]) {
          column.append(element, pending[0]);
          if (!fits(pending[0]) && column.children.length > 2) {
            element.remove();
            pending[0].remove();
            advance();
          } else pending[0].remove();
        }
        columns[columnIndex].append(element);
        if (fits(element)) continue;
        const hasContent = columns[columnIndex].children.length > 1;
        if (hasContent) {
          element.remove();
          advance();
          pending.unshift(element);
          continue;
        }
        if (element.children.length > 1 && !element.matches("table,.choices")) {
          element.remove();
          const pieces = [...element.children].map((child) => {
            const wrapper = element.cloneNode(false) as HTMLElement;
            wrapper.append(child);
            return wrapper;
          });
          pending.unshift(...pieces);
          continue;
        }
        const table = element.matches("table")
          ? element
          : element.children.length === 1 && element.firstElementChild?.matches("table")
            ? element.firstElementChild
            : null;
        const remainder = table ? splitTable(element, table as HTMLTableElement) : split(element);
        if (remainder) {
          advance();
          pending.unshift(remainder);
        } else if (!fits(element))
          throw new Error("试卷包含无法放入单栏的内容，请缩短表格或公式后重试。");
      }
      source.remove();
    },
    { width: SHEET_WIDTH_PX, height: SHEET_HEIGHT_PX },
  );
}
