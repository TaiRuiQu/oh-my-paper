import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { errorResponse, AccessError } from "@/server/http/errors";
import { requireSameOrigin, readJSON } from "@/server/http/mutations";
import { executeCommand, loadState } from "@/server/platform/service";
import { generateCardTemplate } from "@/server/platform/cards";

export async function POST(request: Request) {
  try {
    const session = await requireSession(request.headers);
    requireSameOrigin(request);
    const input = await readJSON(
      request,
      z.object({ paperId: z.string(), presetId: z.string().optional() }),
    );
    const state = await loadState({ id: session.user.id });
    const paper = state.papers.find((paper) => paper.id === input.paperId);
    if (!paper || state.actor.role === "STUDENT") throw new AccessError(404, "试卷不存在。");
    const template = generateCardTemplate(paper);
    return Response.json(
      await executeCommand(
        { id: session.user.id },
        {
          type: "template.save",
          template: {
            paperId: paper.id,
            name: template.name,
            subject: template.subject,
            layout: template.layout,
          },
        },
      ),
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
