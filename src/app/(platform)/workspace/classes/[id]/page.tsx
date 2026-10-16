import { ClassDetailPage } from "@/components/platform/class-pages";

export const metadata = { title: "班级概览" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClassDetailPage id={id} />;
}
