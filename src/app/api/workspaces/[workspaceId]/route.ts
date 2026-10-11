import { requireWorkspaceAccess } from "@/server/auth/authorization";
import { errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    const { workspace, member } = await requireWorkspaceAccess(request.headers, workspaceId);
    return Response.json({ workspace: { id: workspace.id, name: workspace.name, kind: workspace.kind }, role: member.role }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
