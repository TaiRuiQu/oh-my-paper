import "server-only";
import type { PlatformState } from "@/contracts/platform";
import { AccessError } from "@/server/http/errors";
import { type Db } from "../access";
import { sessionAccess } from "./context";

/** Only immutable, server-validated plan references may extend a current classroom reader's access. */
export async function canReadTeachingAsset(actor: PlatformState["actor"], url: string, db: Db) {
  if (actor.role === "STUDENT") return false;
  const plans = await db.teachingPlanVersion.findMany({
    where: { assetUrls: { has: url } },
    select: { sessionId: true },
    distinct: ["sessionId"],
  });
  for (const plan of plans) {
    try {
      await sessionAccess(db, actor, plan.sessionId);
      return true;
    } catch (cause) {
      if (!(cause instanceof AccessError && cause.status === 404)) throw cause;
    }
  }
  return false;
}
