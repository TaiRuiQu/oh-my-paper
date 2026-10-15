import "server-only";
import { createHash } from "node:crypto";
import { RequestError } from "@/server/http/errors";

export function pointId(questionId: string) {
  const hex = createHash("sha256").update(questionId).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function collectionName(version: string) {
  const prefix = process.env.QDRANT_COLLECTION_PREFIX || "oh_my_paper_questions";
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(prefix) || !/^[a-zA-Z0-9-]+$/.test(version))
    throw new RequestError(409, "向量数据库集合配置无效。");
  return `${prefix}_${version}`;
}

async function request<T>(path: string, method = "GET", body?: unknown, allowMissing = false) {
  const url = process.env.QDRANT_URL;
  if (!url) throw new RequestError(409, "请先配置 QDRANT_URL 并启动向量数据库。");
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`Qdrant HTTP ${response.status}`);
    const result = (await response.json()) as { result: T };
    return result.result;
  } catch {
    // Never propagate a backend response, endpoint, or credential into API errors.
    throw new RequestError(503, "向量数据库不可用，请检查 Qdrant 连接后重试。");
  }
}

export async function ensureCollection(version: string, dimensions: number) {
  const path = `/collections/${collectionName(version)}`;
  const existing = await request<{ config: { params: { vectors: { size: number } } } }>(
    path,
    "GET",
    undefined,
    true,
  );
  if (existing) {
    if (existing.config.params.vectors.size !== dimensions)
      throw new RequestError(409, "向量维度不一致，请重新保存模型配置并重建索引。");
    return;
  }
  // A single indexing worker creates a collection; a concurrent creator is harmless.
  try {
    await request(path, "PUT", { vectors: { size: dimensions, distance: "Cosine" } });
  } catch (error) {
    if (!(await request(path, "GET", undefined, true))) throw error;
  }
}

export async function upsertPoint(version: string, questionId: string, vector: number[]) {
  await request(`/collections/${collectionName(version)}/points?wait=true`, "PUT", {
    points: [{ id: pointId(questionId), vector }],
  });
}

export async function deletePoint(version: string, questionId: string) {
  const path = `/collections/${collectionName(version)}`;
  if (!(await request(path, "GET", undefined, true))) return;
  await request(`${path}/points/delete?wait=true`, "POST", { points: [pointId(questionId)] });
}

export async function queryPoints(version: string, vector: number[], ids: string[], page: number) {
  if (!ids.length) return [];
  const result = await request<{ points: { id: string; score: number }[] }>(
    `/collections/${collectionName(version)}/points/query`,
    "POST",
    {
      query: vector,
      // Fetch scores for the authorized set so tied scores have a stable ID order.
      // Qdrant's offset alone can repeat tied points, even with exact search.
      params: { exact: true },
      filter: { must: [{ has_id: ids.map(pointId) }] },
      limit: ids.length,
      with_payload: false,
    },
  );
  const lookup = new Map(ids.map((id) => [pointId(id), id]));
  return result!.points
    .map((point) => ({ id: lookup.get(String(point.id))!, score: point.score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice((page - 1) * 20, page * 20);
}
