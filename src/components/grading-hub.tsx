"use client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExamWorkbench } from "./exam-workbench";
import { Classes } from "./classes";
import type { ExamTaskSummary } from "@/contracts/exam-tasks";
import type { classOverview } from "@/server/learning/classes";
import { FilePenLine, Users } from "lucide-react";
export function GradingHub({
  tasks,
  classes,
  model,
  isAdmin,
  defaultMode,
  templateTaskId,
}: {
  tasks: ExamTaskSummary[];
  classes: Awaited<ReturnType<typeof classOverview>>;
  model: string | null;
  isAdmin: boolean;
  defaultMode: string;
  templateTaskId?: string;
}) {
  return (
    <>
      <div className="workspace-heading">
        <h1>批改板块</h1>
        <p className="intro">
          识别学生作答，依据已保存的标准答案判分，并保留逐题批改报告。
        </p>
      </div>
      <Tabs defaultValue={defaultMode} className="grading-hub">
        <TabsList>
          <TabsTrigger value="student">
            <FilePenLine size={16} />
            学生自主作答
          </TabsTrigger>
          <TabsTrigger value="batch">
            <Users size={16} />
            教师批量改卷
          </TabsTrigger>
        </TabsList>
        <TabsContent value="student">
          <p className="mode-description">
            上传带有作答痕迹的完整试卷。系统先解析题目并保存答案，再识别作答与判分。
          </p>
          <ExamWorkbench
            initialTasks={tasks}
            model={model}
            isAdmin={isAdmin}
            grading
            templateTaskId={templateTaskId}
          />
        </TabsContent>
        <TabsContent value="batch">
          <Classes initialClasses={classes} grading />
        </TabsContent>
      </Tabs>
    </>
  );
}
