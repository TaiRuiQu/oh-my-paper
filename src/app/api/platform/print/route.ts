import { requireSession } from "@/server/auth/session";
import { errorResponse, AccessError } from "@/server/http/errors";
import { loadState } from "@/server/platform/service";
import { renderCardHtml, renderCardSvg, renderPaperHtml } from "@/server/platform/print";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    const state = await loadState({ id: session.user.id });
    const params = new URL(request.url).searchParams;
    const template = state.templates.find((template) => template.id === params.get("templateId"));
    const paper = state.papers.find((paper) => paper.id === params.get("paperId"));
    if (!template && !paper) throw new AccessError(404, "试卷或答题卡不存在。");
    const svg = template && params.get("format") === "svg";
    const html = template
      ? svg
        ? renderCardSvg(template, Number(params.get("page") || "1"))
        : renderCardHtml(template)
      : renderPaperHtml(paper!);
    return new Response(html, {
      headers: {
        "Content-Type": svg ? "image/svg+xml; charset=utf-8" : "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy":
          "default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'; sandbox allow-same-origin allow-modals",
      },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
