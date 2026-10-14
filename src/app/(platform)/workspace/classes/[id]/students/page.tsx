import { ClassDetailPage } from "@/components/platform/class-pages";

export const metadata = { title: "学生名单" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClassDetailPage id={id} students />;
}
