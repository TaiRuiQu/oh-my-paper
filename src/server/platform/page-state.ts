import "server-only";
import { AccessError } from "@/server/http/errors";
import type { Actor, PlatformState } from "@/contracts/platform";
import type { PlatformArea } from "@/contracts/navigation";
import { loadState } from "./queries";
import { buildAnalytics } from "./analytics";

export function scopePageState(state: PlatformState, area: PlatformArea): PlatformState {
  if (area === "admin" && state.actor.role !== "ADMIN")
    throw new AccessError(403, "需要管理员权限。");
  if (state.actor.role === "STUDENT" && area !== "workspace" && area !== "learning")
    throw new AccessError(403, "此页面需要教师权限。");
  if (area !== "exams" && area !== "homework") return state;
  const kind = area === "exams" ? "EXAM" : "HOMEWORK";
  const assessments = state.assessments.filter((a) => a.kind === kind);
  const ids = new Set(assessments.map((a) => a.id));
  const papers = state.papers.filter((p) => p.kind === kind);
  const submissions = state.submissions.filter((s) => ids.has(s.assessmentId));
  const submissionIds = new Set(submissions.map((s) => s.id));
  const reviews = state.reviews.filter((r) => submissionIds.has(r.submissionId));
  const scoped = {
    ...state,
    assessments,
    papers,
    submissions,
    reviews,
    templates: area === "exams" ? state.templates : [],
  };
  return { ...scoped, analytics: buildAnalytics(scoped) };
}

export async function loadPageState(actor: Actor, area: PlatformArea) {
  return scopePageState(
    await loadState(actor, undefined, { questionLimit: area === "learning" ? undefined : 0 }),
    area,
  );
}
