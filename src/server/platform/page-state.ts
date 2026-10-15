import "server-only";
import { AccessError, RequestError } from "@/server/http/errors";
import type { Actor, PlatformState } from "@/contracts/platform";
import type { PlatformArea } from "@/contracts/navigation";
import { loadState } from "./queries";
import { applyOfficialResults, buildAnalytics } from "./analytics";
import { canReadSubject } from "@/contracts/permissions";

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
    reviewHistory: state.reviewHistory?.filter((r) => submissionIds.has(r.submissionId)),
  };
  if (state.reviewing)
    return {
      ...scoped,
      analytics: {
        ...state.analytics,
        results: state.analytics.results.filter((r) => ids.has(r.assessmentId)),
      },
    };
  const analytics = buildAnalytics({
    ...scoped,
    canReadSubject: (id, subject) => {
      const classroom = state.classrooms.find((c) => c.id === id);
      return (
        !!classroom &&
        (state.actor.role === "STUDENT" || canReadSubject(state.actor, classroom, subject))
      );
    },
  });
  applyOfficialResults(analytics, state.analytics.results);
  if (state.actor.role === "STUDENT") analytics.classrooms = [];
  return { ...scoped, analytics };
}

export async function loadPageState(actor: Actor, area: PlatformArea, reviewing = false) {
  if (reviewing && area !== "exams" && area !== "homework")
    throw new RequestError(400, "阅卷范围仅用于考试和作业。");
  return scopePageState(
    await loadState(actor, undefined, {
      questionLimit: area === "learning" ? undefined : 0,
      reviewing,
    }),
    area,
  );
}
