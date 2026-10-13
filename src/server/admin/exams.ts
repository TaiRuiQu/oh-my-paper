import "server-only";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { taskSummary, taskResult } from "@/server/exams/tasks";
import { agentTaskSummary } from "@/server/exams/agent-tasks";
import { AccessError } from "@/server/http/errors";
import type { AdminExam, AdminList, AdminExamDetail } from "@/contracts/admin";
import type { ExamTask } from "@/generated/prisma/client";
const ownerSelect = { id: true, name: true, email: true } as const;
function summary(
  task: ExamTask & { user: AdminExam["owner"]; workflows: { kind: string }[] },
): AdminExam {
  return {
    ...taskSummary(task),
    owner: task.user,
    source: task.workflows.some((flow) => flow.kind === "QUICK") ? "快速批改" : "试卷上传",
  };
}
export async function listAllExams(search: string, page: number): Promise<AdminList<AdminExam>> {
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { user: { email: { contains: search, mode: "insensitive" as const } } },
          { user: { name: { contains: search, mode: "insensitive" as const } } },
        ],
      }
    : {};
  const pageSize = 20;
  const [tasks, total] = await Promise.all([
    getDb().examTask.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: ownerSelect }, workflows: { select: { kind: true } } },
    }),
    getDb().examTask.count({ where }),
  ]);
  return { items: tasks.map(summary), total, page, pageSize };
}
export async function reviewExamTask(id: string) {
  if (!z.uuid().safeParse(id).success) throw new AccessError(404, "试卷不存在。");
  const task = await getDb().examTask.findUnique({
    where: { id },
    include: { user: { select: ownerSelect }, workflows: { select: { kind: true } } },
  });
  if (!task) throw new AccessError(404, "试卷不存在。");
  return task;
}
export async function reviewExam(id: string): Promise<AdminExamDetail> {
  const task = await reviewExamTask(id);
  const [exam, agents] = await Promise.all([
    taskResult(task),
    task.examId
      ? getDb().examAgentTask.findMany({
          where: { examId: task.examId },
          orderBy: { createdAt: "desc" },
        })
      : [],
  ]);
  return { task: summary(task), exam, agents: agents.map(agentTaskSummary) };
}
