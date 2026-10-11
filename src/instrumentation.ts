export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logEvent } = await import("./server/logger");
    // Never open database connections or start consumers while Next.js is building.
    logEvent("web.initialized");
  }
}
