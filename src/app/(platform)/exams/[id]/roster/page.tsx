import { AssessmentRosterPage } from "@/components/platform/assessment-pages";

export const metadata = { title: "参与名单" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AssessmentRosterPage id={id} />;
}
