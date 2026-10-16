import { StudentHomeworkWorkspace } from "@/components/homework-collection/workspace";
export const metadata = { title: "作业作答" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StudentHomeworkWorkspace assignmentId={id} />;
}
