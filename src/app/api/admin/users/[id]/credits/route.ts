import { requireAdmin } from "@/server/auth/authorization";
import { requireSameOrigin, readJSON } from "@/server/http/mutations";
import { errorResponse } from "@/server/http/errors";
import { creditGrantSchema } from "@/contracts/credit-grants";
import { grantCredits } from "@/server/ai/credit-grants";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let isAdmin = false;
  try {
    const { user } = await requireAdmin(request.headers);
    isAdmin = true;
    requireSameOrigin(request);
    return Response.json(
      await grantCredits(
        user.id,
        (await context.params).id,
        await readJSON(request, creditGrantSchema),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
