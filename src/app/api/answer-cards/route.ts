import { cardRoute } from "@/server/answer-cards/http";
import { listCards } from "@/server/answer-cards/tasks";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return cardRoute(request, async (userId) =>
    Response.json(await listCards(userId), { headers: { "Cache-Control": "no-store" } }),
  );
}
