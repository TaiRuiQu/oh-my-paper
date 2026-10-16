"use client";
import type { HomeworkStudentPaper } from "@/contracts/homework";
import { PaperReading, StudentPrompt } from "@/components/homework-collection/prompt";
export function PracticePaper({
  paper,
  context,
}: {
  paper: HomeworkStudentPaper;
  context: string;
}) {
  return (
    <section aria-label={`${context}完整题面`}>
      <PaperReading paper={paper} context={context} />
      {paper.items.map((item, index) => (
        <div key={item.id}>
          <PaperReading paper={paper} beforeItemId={item.id} context={context} />
          <StudentPrompt item={item} index={index} context={context} />
        </div>
      ))}
    </section>
  );
}
