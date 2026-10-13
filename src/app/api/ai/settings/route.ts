import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { requireSameOrigin, readJSON } from "@/server/http/mutations";
import { userModelSelectionSchema } from "@/contracts/user-ai";
import { userAiSettings, selectUserModel } from "@/server/ai/user-settings";

export async function GET(request: Request) {
  try {
    const { user } = await requireSession(request.headers);
    return Response.json(await userAiSettings(user.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
export async function PUT(request: Request) {
  try {
    const { user } = await requireSession(request.headers);
    requireSameOrigin(request);
    const { purpose, modelId } = await readJSON(request, userModelSelectionSchema);
    await selectUserModel(user.id, purpose, modelId);
    return Response.json(await userAiSettings(user.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
