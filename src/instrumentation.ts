import type { Instrumentation } from "next";
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logEvent } = await import("./server/logger");
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      const { ensureInitialAdmin } = await import("./server/auth/accounts");
      await ensureInitialAdmin();
    }
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
