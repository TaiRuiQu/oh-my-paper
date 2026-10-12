import { classInputSchema } from "@/contracts/classes";
import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { errorResponse } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { classOverview } from "@/server/learning/classes";
export async function GET(request: Request) {
  try {
    const { user } = await requireSession(request.headers);
    return Response.json(
      { classes: await classOverview(user.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const { user } = await requireSession(request.headers);
    requireSameOrigin(request);
    const data = await readJSON(request, classInputSchema);
    return Response.json(await getDb().classroom.create({ data: { ...data, ownerId: user.id } }), {
      status: 201,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
