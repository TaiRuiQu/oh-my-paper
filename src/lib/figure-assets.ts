import type { ContentBlock, FigureAsset, SourceRegion } from "@/contracts/exams";

export function regionsEqual(first: SourceRegion, second: SourceRegion) {
  return first.page === second.page && (["x", "y", "width", "height"] as const).every((key) =>
    Math.abs(first[key] - second[key]) <= 1e-7);
}
export function regionKey(region: SourceRegion) {
  return [region.page,region.x,region.y,region.width,region.height].join(":");
}

export function findFigureAsset(assets: FigureAsset[], figure: Extract<ContentBlock, { type: "figure" }>, role?: FigureAsset["role"]) {
  return assets.find((asset) => (role === undefined || (asset.role ?? "question") === role) &&
    regionsEqual(asset.region, figure.region) && (!figure.assetId || asset.id === figure.assetId));
}
