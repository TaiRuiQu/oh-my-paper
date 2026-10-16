export async function printClientDocument({
  content,
  title,
  paperSize,
  orientation,
}: {
  content: HTMLElement;
  title: string;
  paperSize: "A4" | "A3";
  orientation: "portrait" | "landscape";
}) {
  await document.fonts.ready;
  await Promise.all(Array.from(content.querySelectorAll("img")).map((image) => image.decode()));
  content.dispatchEvent(new Event("omp:prepare-print"));
  // Allow React to commit the measured pagination, bypassing ResizeObserver's debounce.
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  const frame = document.createElement("iframe");
  frame.title = "打印教学文档";
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, {
    position: "fixed",
    width: "1px",
    height: "1px",
    left: "-10000px",
    border: "0",
  });
  document.body.appendChild(frame);
  try {
    const target = frame.contentDocument!;
    target.open();
    target.write('<!doctype html><html lang="zh-CN"><head></head><body></body></html>');
    target.close();
    target.title = title;
    const base = target.createElement("base");
    base.href = document.baseURI;
    target.head.appendChild(base);
    const loaded = Array.from(
      document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>("link[rel=stylesheet],style"),
    ).map((source) => {
      const copy = source.cloneNode(true) as HTMLLinkElement | HTMLStyleElement;
      const ready =
        copy instanceof HTMLLinkElement
          ? new Promise<void>((resolve, reject) => {
              copy.onload = () => resolve();
              copy.onerror = () => reject(new Error("打印样式加载失败，请重试。"));
            })
          : Promise.resolve();
      target.head.appendChild(copy);
      return ready;
    });
    const [short, long] = paperSize === "A3" ? [297, 420] : [210, 297];
    const [width, height] = orientation === "landscape" ? [long, short] : [short, long];
    const style = target.createElement("style");
    style.textContent = `@page{size:${paperSize} ${orientation};margin:0}html,body{margin:0;padding:0;background:#fff;color:#111}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}.p-document-pages{display:block;width:${width}mm;margin:0;zoom:1!important}.p-document-page{width:${width}mm;min-height:${height}mm;height:auto;margin:0;box-shadow:none;break-after:page}.p-document-page:last-child{break-after:auto}.p-document-page footer{color:#555}.p-document-edit-tools,.p-workbook-controls,.p-pagination-control,.p-text-block-tools{display:none!important}.p-document-text:hover{background:transparent}.p-card-print-page{width:${width}mm;height:${height}mm;break-after:page}.p-card-print-page:last-child{break-after:auto}.p-card-print-page>svg{display:block;width:100%;height:100%}`;
    target.head.appendChild(style);
    target.body.appendChild(content.cloneNode(true));
    await Promise.all(loaded);
    await target.fonts.ready;
    await Promise.all(
      Array.from(target.images).map((image) =>
        image.decode().catch(() => {
          throw new Error("题目配图加载失败，请重试打印。");
        }),
      ),
    );
    const printWindow = frame.contentWindow!;
    printWindow.addEventListener("afterprint", () => frame.remove(), { once: true });
    printWindow.focus();
    printWindow.print();
  } catch (error) {
    frame.remove();
    throw error;
  }
}
