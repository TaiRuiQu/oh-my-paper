import { getDb } from "@/server/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    // Checks both connectivity and whether the foundation migration has been applied.
    await getDb().user.count();
    return Response.json({ status: "ok", database: "ready" }, { headers });
  } catch {
    return Response.json(
      { status: "unavailable", database: "unavailable" },
      { status: 503, headers },
    );
  }
}
