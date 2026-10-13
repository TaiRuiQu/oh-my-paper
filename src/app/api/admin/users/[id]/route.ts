import { requireAdmin } from "@/server/auth/authorization";
import { requireSameOrigin, readJSON } from "@/server/http/mutations";
import { errorResponse } from "@/server/http/errors";
import { adminUserUpdateSchema } from "@/contracts/admin";
import { updateUser } from "@/server/admin/users";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  let isAdmin = false;
  try {
    const { user } = await requireAdmin(request.headers);
    isAdmin = true;
    requireSameOrigin(request);
    const input = await readJSON(request, adminUserUpdateSchema);
    return Response.json(await updateUser(user.id, (await context.params).id, input), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
