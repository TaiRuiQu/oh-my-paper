import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DigitalExam } from "@/contracts/exams";
import { sourceRegionSchema } from "@/contracts/exams";
import { requireSession } from "@/server/auth/session";
import { errorResponse, AccessError } from "@/server/http/errors";
import { ownedGradeTask } from "@/server/grading/tasks";
import { taskDirectory } from "@/server/exams/tasks";
import { findFigureAsset } from "@/lib/figure-assets";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireSession(request.headers);
    const task = await ownedGradeTask(user.id, (await context.params).id);
    const input = task.input as unknown as { exam: DigitalExam };
    const region = sourceRegionSchema.parse(JSON.parse(new URL(request.url).searchParams.get("region") ?? "null"));
    const assetId = new URL(request.url).searchParams.get("assetId") ?? undefined;
    const asset = findFigureAsset(input.exam.assets, { type:"figure",caption:"",contaminated:true,region,assetId });
    if (!asset || !/^figures\/figure-\d+\.png$/.test(asset.evidenceKey)) throw new AccessError(404, "作答图片不存在。");
    const bytes = await readFile(join(taskDirectory(task.examTaskId), task.examOutputKey, asset.evidenceKey));
    return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return errorResponse(error); }
}
