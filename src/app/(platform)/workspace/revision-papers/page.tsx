import { RevisionPaperBuilder } from "@/components/platform/revision-paper-pages";
export const metadata = { title: "错题复习组卷" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const value = (key: string) => (typeof query[key] === "string" ? query[key] : undefined);
  return (
    <RevisionPaperBuilder
      initialStudentId={value("studentId")}
      initialAssessmentId={value("assessmentId")}
      initialKind={value("kind")}
      initialMode={value("mode")}
      initialSubject={value("subject")}
    />
  );
}
