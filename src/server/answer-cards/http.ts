import { requireSession } from "@/server/auth/session";
import { isAdminUser } from "@/server/auth/authorization";
import { requireSameOrigin } from "@/server/http/mutations";
import { errorResponse } from "@/server/http/errors";
export async function cardRoute(
  request: Request,
  action: (userId: string) => Promise<Response>,
  mutation = false,
) {
  let admin = false;
  try {
    const { user } = await requireSession(request.headers);
    admin = await isAdminUser(user.id);
    if (mutation) requireSameOrigin(request);
    return await action(user.id);
  } catch (error) {
    return errorResponse(error, request, admin);
  }
}
