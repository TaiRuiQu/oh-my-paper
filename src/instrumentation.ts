import type { Instrumentation } from "next";
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logEvent } = await import("./server/logger");
    // Never open database connections or start consumers while Next.js is building.
    logEvent("web.initialized");
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logError } = await import("./server/logger");
    logError("web.request.unhandled", error, {
      method: request.method,
      path: request.path.split("?")[0],
      route: context.routePath,
      digest:
        error && typeof error === "object" && "digest" in error ? String(error.digest) : undefined,
    });
  }
};
