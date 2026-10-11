import { requireSession } from "@/server/auth/session";
import { ensurePersonalWorkspace, listUserWorkspaces } from "@/server/db/workspaces";
import { errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { user } = await requireSession(request.headers);
    await ensurePersonalWorkspace(user);
    const workspaces = await listUserWorkspaces(user.id);
    return Response.json({ user: { id: user.id, name: user.name, email: user.email }, workspaces }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
