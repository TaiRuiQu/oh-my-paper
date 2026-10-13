import { cardRoute } from "@/server/answer-cards/http";
import { createCardTemplate } from "@/server/answer-cards/tasks";
export const runtime = "nodejs";
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return cardRoute(
    request,
    async (userId) =>
      Response.json(
        { task: await createCardTemplate(request, userId, (await ctx.params).id) },
        { status: 202 },
      ),
    true,
  );
}
