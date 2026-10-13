import { cardRoute } from "@/server/answer-cards/http";
import { retryCard } from "@/server/answer-cards/tasks";
export const runtime = "nodejs";
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return cardRoute(
    request,
    async (userId) => {
      await retryCard(userId, "templates", (await ctx.params).id);
      return Response.json({ ok: true }, { status: 202 });
    },
    true,
  );
}
