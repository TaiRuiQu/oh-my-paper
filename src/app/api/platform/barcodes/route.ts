import { requireSession } from "@/server/auth/session";
import { AccessError, RequestError, errorResponse } from "@/server/http/errors";
import { loadState } from "@/server/platform/service";
import { renderBarcodeLabelPages } from "@/server/platform/barcodes";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    const state = await loadState({ id: session.user.id });
    if (state.actor.role === "STUDENT") throw new AccessError(403, "需要教师权限。");
    const params = new URL(request.url).searchParams;
    const classroom = state.classrooms.find((row) => row.id === params.get("classroomId"));
    if (!classroom) throw new AccessError(404, "班级不存在或无权访问。");
    const copies = Number(params.get("copies") ?? "1");
    if (!Number.isInteger(copies) || copies < 1 || copies > 20)
      throw new RequestError(400, "每人份数须为 1–20。");
    if (!classroom.students.length) throw new RequestError(400, "班级还没有学生，请先添加学生。");
    if (classroom.students.some((student) => !/^[0-9]{1,6}$/.test(student.studentNumber)))
      throw new RequestError(
        400,
        "此答题卡使用六位考号，请先将学生考号设为 1–6 位数字；不足六位会自动补零。",
      );
    if (classroom.students.length * copies > 4000)
      throw new RequestError(400, "一次最多生成 4000 枚标签，请减少每人份数。");
    return Response.json(
      { pages: renderBarcodeLabelPages(classroom, copies) },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
