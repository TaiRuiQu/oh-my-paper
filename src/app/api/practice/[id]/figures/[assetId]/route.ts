import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { requireSession } from "@/server/auth/session";
import { ownedPractice } from "@/server/learning/practice";
import { AccessError, errorResponse } from "@/server/http/errors";
import { taskDirectory } from "@/server/exams/tasks";
import type { DigitalExam } from "@/contracts/exams";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> },
) {
  try {
    const { user } = await requireSession(request.headers);
    const { id, assetId } = await params;
    const task = await ownedPractice(user.id, id);
    const input = task.input as unknown as {
      exam: DigitalExam;
      examTaskId: string;
      outputKey: string;
    };
    const asset = input.exam.assets.find((a) => a.id === assetId);
    if (
      task.mode !== "original" ||
      !asset?.cleanKey ||
      asset.contaminated ||
      !/^figures\/figure-\d+\.png$/.test(asset.cleanKey)
    )
      throw new AccessError(404, "配图不存在。");
    const buffer = await readFile(
      join(taskDirectory(input.examTaskId), input.outputKey, asset.cleanKey),
    );
    return new Response(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
