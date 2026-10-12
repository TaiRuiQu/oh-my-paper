import { requireSession } from "@/server/auth/session";
import { createExamTask, listExamTasks } from "@/server/exams/tasks";
import { errorResponse, RequestError } from "@/server/http/errors";
import { requireSameOrigin } from "@/server/http/mutations";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const { user } = await requireSession(request.headers);
    return Response.json(
      { tasks: await listExamTasks(user.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const { user } = await requireSession(request.headers);
    requireSameOrigin(request);
    const params = new URL(request.url).searchParams;
    if (
      params.has("generateAnswers") &&
      !["true", "false"].includes(params.get("generateAnswers")!)
    )
      throw new RequestError(400, "标准答案选项无效，请重新选择。");
    return Response.json(
      {
        task: await createExamTask(request, user.id, {
          autoGrade: params.get("mode") === "quick",
          generateAnswers: params.get("generateAnswers") !== "false",
          templateTaskId: params.get("templateId") || undefined,
        }),
      },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
