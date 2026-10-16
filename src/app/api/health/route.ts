import { getDb } from "@/server/db/client";

export async function GET() {
  try {
    await getDb().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", version: "2.0.0" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
