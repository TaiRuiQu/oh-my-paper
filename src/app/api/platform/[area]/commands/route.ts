import { requireSession } from "@/server/auth/session";
import { errorResponse, RequestError } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { commandSchema } from "@/server/platform/schemas";
import { executeCommand } from "@/server/platform/service";

const commandAreas: Record<string, string[]> = {
  questions: ["question"],
  papers: ["paper"],
  classrooms: ["classroom", "student"],
  assessments: ["assessment"],
  templates: ["template"],
  submissions: ["submission"],
  reviews: ["review"],
};

export async function POST(request: Request, { params }: { params: Promise<{ area: string }> }) {
  try {
    const session = await requireSession(request.headers);
    requireSameOrigin(request);
    const { area } = await params;
    const command = await readJSON(request, commandSchema, 2_000_000);
    if (!commandAreas[area]?.includes(command.type.split(".")[0]))
      throw new RequestError(400, "操作与功能模块不匹配。");
    return Response.json(await executeCommand({ id: session.user.id }, command));
  } catch (error) {
    return errorResponse(error, request);
  }
}
