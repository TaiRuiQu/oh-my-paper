import { requireAdmin } from "@/server/auth/authorization";
import { requireSameOrigin, readJSON } from "@/server/http/mutations";
import { errorResponse } from "@/server/http/errors";
import { resetPasswordSchema } from "@/contracts/admin";
import { resetUserPassword } from "@/server/admin/users";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let isAdmin = false;
  try {
    const { user } = await requireAdmin(request.headers);
    isAdmin = true;
    requireSameOrigin(request);
    const input = await readJSON(request, resetPasswordSchema);
    return Response.json(
      await resetUserPassword(user.id, (await context.params).id, input.password),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
