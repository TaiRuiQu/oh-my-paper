import { requireSession } from "@/server/auth/session";
import { errorResponse, AccessError, RequestError } from "@/server/http/errors";
import { loadState } from "@/server/platform/service";
import { renderCardSvg } from "@/server/platform/print";
import { accessibleAsset, assetId } from "@/server/platform/assets";
import { renderPaperWord } from "@/server/platform/word-export";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    const params = new URL(request.url).searchParams;
    const format = params.get("format");
    if (format === "pdf")
      throw new RequestError(
        400,
        "请在导出页面点击「打印 / 保存 PDF」，通过本机浏览器保存为 PDF。",
      );
    if (format !== "docx" && format !== "svg")
      throw new RequestError(400, "请选择 Word（format=docx）或答题卡 SVG（format=svg）格式。");
    const state = await loadState({ id: session.user.id });
    if (!!params.get("paperId") === !!params.get("templateId"))
      throw new RequestError(400, "请选择一份试卷、作业或答题卡。");
    const template = state.templates.find((template) => template.id === params.get("templateId"));
    const paper = state.papers.find((paper) => paper.id === params.get("paperId"));
    if (!template && !paper) throw new AccessError(404, "试卷或答题卡不存在。");
    if (format === "docx" && !paper) throw new RequestError(400, "Word 导出仅适用于试卷和作业。");
    if (format === "svg" && !template) throw new RequestError(400, "SVG 导出仅适用于答题卡。");
    const loadAsset = async (url: string) => {
      const id = assetId(url);
      if (!id) throw new RequestError(400, "文档图片引用无效。");
      return accessibleAsset(session.user.id, id);
    };
    let body: string | ArrayBuffer;
    if (format === "svg") {
      const page = Number(params.get("page") ?? "1");
      if (!Number.isInteger(page) || page < 1 || page > template!.layout.pageCount)
        throw new RequestError(400, "答题卡页码无效。");
      body = renderCardSvg(template!, page);
    } else {
      body = new Uint8Array(await renderPaperWord(paper!, loadAsset)).buffer;
    }
    const name = `${(template?.name ?? paper!.name).replace(/[\u0000-\u001f\u007f/\\]/g, "_")}.${format}`;
    return new Response(body, {
      headers: {
        "Content-Type":
          format === "svg"
            ? "image/svg+xml; charset=utf-8"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="document.${format}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
