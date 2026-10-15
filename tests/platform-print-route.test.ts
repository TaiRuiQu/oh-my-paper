import { beforeEach, expect, it, vi } from "vitest";
import { AccessError } from "@/server/http/errors";

const dependencies = vi.hoisted(() => ({
  requireSession: vi.fn(),
  loadState: vi.fn(),
  accessibleAsset: vi.fn(),
  renderPaperWord: vi.fn(),
  renderCardSvg: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({ requireSession: dependencies.requireSession }));
vi.mock("@/server/platform/service", () => ({ loadState: dependencies.loadState }));
vi.mock("@/server/platform/assets", () => ({
  accessibleAsset: dependencies.accessibleAsset,
  assetId: (url: string) => /^\/api\/platform\/assets\/([\w-]+)$/.exec(url)?.[1],
}));
vi.mock("@/server/platform/word-export", () => ({ renderPaperWord: dependencies.renderPaperWord }));
vi.mock("@/server/platform/print", () => ({ renderCardSvg: dependencies.renderCardSvg }));
vi.mock("@/server/logger", () => ({
  logError: () => ({ message: "error", errorId: "test", code: "TEST" }),
}));
import { GET } from "@/app/api/platform/print/route";

const paper = { id: "paper", name: "作业" };
const template = { id: "template", name: "答题卡", layout: { pageCount: 2 } };
const request = (query: string) =>
  GET(new Request(`https://paper.invalid/api/platform/print?${query}`));
beforeEach(() => {
  vi.clearAllMocks();
  dependencies.requireSession.mockResolvedValue({ user: { id: "teacher" } });
  dependencies.loadState.mockResolvedValue({ papers: [paper], templates: [template] });
  dependencies.renderPaperWord.mockResolvedValue(Buffer.from("PK-docx"));
  dependencies.renderCardSvg.mockReturnValue('<svg xmlns="http://www.w3.org/2000/svg"/>');
});

it.each(["paperId=paper", "templateId=template"])(
  "requires browser PDF export and an explicit server format for %s",
  async (document) => {
    const pdf = await request(`${document}&format=pdf`);
    expect(pdf.status).toBe(400);
    expect((await pdf.json()).error).toContain("本机浏览器保存为 PDF");
    expect((await request(document)).status).toBe(400);
    expect(dependencies.loadState).not.toHaveBeenCalled();
    expect(dependencies.renderPaperWord).not.toHaveBeenCalled();
    expect(dependencies.renderCardSvg).not.toHaveBeenCalled();
  },
);

it("keeps session and document access checks on Word and SVG downloads", async () => {
  dependencies.requireSession.mockRejectedValueOnce(new AccessError(401, "请先登录。"));
  expect((await request("paperId=paper&format=docx")).status).toBe(401);
  dependencies.loadState.mockResolvedValueOnce({ papers: [], templates: [] });
  expect((await request("paperId=paper&format=docx")).status).toBe(404);
  expect(dependencies.renderPaperWord).not.toHaveBeenCalled();
  const word = await request("paperId=paper&format=docx");
  expect(word.status).toBe(200);
  expect(word.headers.get("content-type")).toContain("wordprocessingml.document");
  expect(word.headers.get("cache-control")).toBe("private, no-store");
  expect(word.headers.get("content-disposition")).toContain("document.docx");
  expect(Buffer.from(await word.arrayBuffer()).toString()).toBe("PK-docx");
  const svg = await request("templateId=template&format=svg&page=2");
  expect(svg.status).toBe(200);
  expect(svg.headers.get("content-type")).toContain("image/svg+xml");
  expect(dependencies.renderCardSvg).toHaveBeenCalledWith(template, 2);
});

it("continues enforcing private image access instead of silently dropping Word images", async () => {
  dependencies.accessibleAsset.mockRejectedValueOnce(
    new AccessError(404, "素材不存在或无权访问。"),
  );
  dependencies.renderPaperWord.mockImplementationOnce(async (_paper, loadAsset) => {
    await loadAsset("/api/platform/assets/private-image");
    return Buffer.from("PK-docx");
  });
  expect((await request("paperId=paper&format=docx")).status).toBe(404);
  expect(dependencies.accessibleAsset).toHaveBeenCalledWith("teacher", "private-image");
});

it.each([
  "paperId=paper&format=svg",
  "templateId=template&format=docx",
  "templateId=template&format=svg&page=3",
  "paperId=paper&templateId=template&format=docx",
  "format=docx",
  "paperId=paper&format=html",
])("rejects invalid export targets or formats: %s", async (query) => {
  expect((await request(query)).status).toBe(400);
  expect(dependencies.renderPaperWord).not.toHaveBeenCalled();
  expect(dependencies.renderCardSvg).not.toHaveBeenCalled();
});
