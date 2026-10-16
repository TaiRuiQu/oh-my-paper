import { StudentEditPage } from "@/components/platform/class-pages";

export const metadata = { title: "添加学生" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StudentEditPage classroomId={id} />;
}
