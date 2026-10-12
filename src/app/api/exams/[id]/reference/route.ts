import { requireSession } from "@/server/auth/session";
import { errorResponse, RequestError } from "@/server/http/errors";
import { ownedExamTask, taskResult } from "@/server/exams/tasks";
import { blocksToText } from "@/lib/grading-defaults";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireSession(request.headers);
    const exam = await taskResult(await ownedExamTask(user.id, (await params).id));
    if (!exam) throw new RequestError(409, "请等待参考答案文件识别完成。");
    return Response.json(
      {
        annotations: exam.annotations
          .filter((a) => ["reference_answer", "rubric"].includes(a.kind))
          .map((a) => ({
            number: a.questionNumber,
            section: a.section,
            partLabel: a.partLabel,
            kind: a.kind,
            text: blocksToText(a.blocks),
          })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
