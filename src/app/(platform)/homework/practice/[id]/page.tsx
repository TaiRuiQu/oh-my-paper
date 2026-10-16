import { PracticeTeachingWorkspace } from "@/components/practice/workspace";
export const metadata = { title: "练习发布管理" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PracticeTeachingWorkspace setId={id} />;
}
