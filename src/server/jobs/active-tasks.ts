import "server-only";
import type { ActiveTaskCounts } from "@/contracts/active-tasks";
import { getDb } from "@/server/db/client";

export async function getActiveTaskCounts(userId: string): Promise<ActiveTaskCounts> {
  const db = getDb();
  const status = { in: ["QUEUED", "RUNNING"] as ("QUEUED" | "RUNNING")[] };
  // Read a consistent snapshot so a newly linked child cannot be counted twice.
  const [exams, agents, workflows, templates, batches] = await db.$transaction(
    [
      db.examTask.findMany({
        where: {
          userId,
          deletedAt: null,
          status,
          workflows: { none: { kind: "QUICK" } },
        },
        select: { id: true },
      }),
      db.examAgentTask.findMany({
        where: { status, exam: { userId, task: { deletedAt: null } } },
        select: { id: true, kind: true },
      }),
      db.gradingWorkflow.findMany({
        where: { userId, status, source: { deletedAt: null } },
        select: { kind: true, sourceId: true, answerTaskId: true, gradingTaskId: true },
      }),
      db.answerCardTemplate.count({ where: { userId, status } }),
      db.answerCardBatch.count({ where: { userId, status } }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  const counts: ActiveTaskCounts = {
    exams: 0,
    grading: 0,
    quickGrading: 0,
    answerCards: templates + batches,
  };
  const linkedSources = new Set<string>();
  const linkedAgents = new Set<string>();
  // A user-visible operation counts once, including its internal Agent steps.
  for (const flow of workflows) {
    if (flow.kind === "QUICK") counts.quickGrading++;
    else if (flow.kind === "GRADING") counts.grading++;
    else if (flow.kind === "ANSWER_UPLOAD") counts.exams++;
    else continue;
    if (flow.kind !== "GRADING") linkedSources.add(flow.sourceId);
    if (flow.answerTaskId) linkedAgents.add(flow.answerTaskId);
    if (flow.gradingTaskId) linkedAgents.add(flow.gradingTaskId);
  }
  counts.exams += exams.filter((task) => !linkedSources.has(task.id)).length;
  for (const task of agents) {
    if (linkedAgents.has(task.id)) continue;
    if (task.kind === "ANSWER") counts.exams++;
    else counts.grading++;
  }
  return counts;
}
