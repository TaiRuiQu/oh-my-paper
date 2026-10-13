import { cardRoute } from "@/server/answer-cards/http";
import { cardBatchDetail } from "@/server/answer-cards/tasks";
export const runtime = "nodejs";
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return cardRoute(request, async (userId) =>
    Response.json(
      { batch: await cardBatchDetail(userId, (await ctx.params).id) },
      { headers: { "Cache-Control": "no-store" } },
    ),
  );
}
