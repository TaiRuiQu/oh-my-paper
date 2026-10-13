import { requireAdmin } from "@/server/auth/authorization";
import { errorResponse } from "@/server/http/errors";
import { usageDashboard } from "@/server/ai/usage";

export async function GET(request: Request) {
  let isAdmin = false;
  try {
    await requireAdmin(request.headers);
    isAdmin = true;
    return Response.json(await usageDashboard(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
