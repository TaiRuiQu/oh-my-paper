import { ClassEditPage } from "@/components/platform/class-pages";

export const metadata = { title: "班级设置" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClassEditPage id={id} />;
}
