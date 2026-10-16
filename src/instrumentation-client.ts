import { reportClientError } from "@/lib/error-message";
window.addEventListener(
  "error",
  (event) => {
    const target = event.target;
    if (
      target instanceof HTMLImageElement ||
      target instanceof HTMLScriptElement ||
      target instanceof HTMLLinkElement
    ) {
      const url = target instanceof HTMLLinkElement ? target.href : target.src;
      reportClientError(
        "browser.resource.failed",
        new Error(`资源加载失败：${new URL(url, location.href).pathname}`),
      );
    } else reportClientError("browser.unhandled", event.error ?? new Error(event.message));
  },
  true,
);
window.addEventListener("unhandledrejection", (event) => {
  reportClientError("browser.promise.failed", event.reason);
});
