import "server-only";

// Only structural fields belong here. Never pass user input, credentials, or raw errors.
export function logEvent(
  event: string,
  fields: { jobId?: string; queue?: string; signal?: string } = {},
) {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}
