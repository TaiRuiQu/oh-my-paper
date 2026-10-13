import { errorResponse } from "@/server/http/errors";
import { getDb } from "@/server/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    // Checks both connectivity and whether the foundation migration has been applied.
    await getDb().user.count();
    return Response.json({ status: "ok", database: "ready" }, { headers });
  } catch (error) {
    return errorResponse(error, request);
  }
}
