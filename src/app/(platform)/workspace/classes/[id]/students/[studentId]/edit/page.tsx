import { StudentEditPage } from "@/components/platform/class-pages";

export const metadata = { title: "学生资料" };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; studentId: string }>;
}) {
  const { id, studentId } = await params;
  return <StudentEditPage classroomId={id} studentId={studentId} />;
}
