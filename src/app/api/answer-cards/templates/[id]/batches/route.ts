import { cardRoute } from "@/server/answer-cards/http";
import { createCardBatch } from "@/server/answer-cards/tasks";
export const runtime = "nodejs";
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return cardRoute(
    request,
    async (userId) =>
      Response.json(
        { task: await createCardBatch(request, userId, (await ctx.params).id) },
        { status: 202 },
      ),
    true,
  );
}
