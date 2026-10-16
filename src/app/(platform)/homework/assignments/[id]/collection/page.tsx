import { HomeworkCollectionWorkspace } from "@/components/homework-collection/workspace";

export const metadata = { title: "发放与收交" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HomeworkCollectionWorkspace assessmentId={id} />;
}
