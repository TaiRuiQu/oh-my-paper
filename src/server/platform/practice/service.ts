import "server-only";
import type { Actor } from "@/contracts/platform";
import { getDb } from "@/server/db/client";
import type { Db } from "../access";
import { loadPracticeSetPreview as preview } from "./snapshot";
export {
  loadPracticeSources,
  loadPracticeSets,
  loadPracticeSet,
  loadPracticeSessions,
  loadPracticeSession,
  loadPracticeHistory,
  loadPracticeEvidence,
  loadPracticeReview,
  loadPracticeReviews,
} from "./query";
export { executePracticeCommand } from "./commands";
export {
  loadPracticeAiContext,
  readPracticeAiAsset,
  commitPracticeAiFeedback,
} from "./evaluations";
export { savePracticeAsset } from "./assets";
export function loadPracticeSetPreview(actor: Actor, paperId: string, db: Db = getDb()) {
  return preview(actor, paperId, db);
}
