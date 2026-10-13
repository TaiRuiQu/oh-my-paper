import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cardRoute } from "@/server/answer-cards/http";
import { ownedTemplate, cardDirectory } from "@/server/answer-cards/tasks";
import { AccessError } from "@/server/http/errors";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string; page: string }> },
) {
  return cardRoute(request, async (userId) => {
    const { id, page } = await ctx.params,
      t = await ownedTemplate(userId, id),
      n = Number(page);
    if (
      t.status !== "COMPLETED" ||
      !t.outputKey ||
      !/^\d+$/.test(page) ||
      !Number.isInteger(n) ||
      n < 1 ||
      n > t.pageCount
    )
      throw new AccessError(404, "模板页面不存在。");
    const bytes = await readFile(
      join(
        cardDirectory("templates", id),
        t.outputKey,
        "pages",
        `${String(n).padStart(3, "0")}.jpg`,
      ),
    );
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
