import { notFound } from "next/navigation";
import { requirePageSession } from "@/server/auth/session";
import { practiceView } from "@/server/learning/practice";
import { AccessError } from "@/server/http/errors";
import { Practice } from "@/components/practice";
export const metadata = { title: "错题练习" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePageSession();
  let data;
  try {
    data = await practiceView(user.id, (await params).id);
  } catch (e) {
    if (e instanceof AccessError && e.status === 404) notFound();
    throw e;
  }
  return <Practice initialData={data} />;
}
