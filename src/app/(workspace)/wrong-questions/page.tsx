import { requirePageSession } from "@/server/auth/session";
import { learningOverview } from "@/server/learning/service";
import { WrongQuestions } from "@/components/wrong-questions";
export const metadata = { title: "错题本" };
export default async function Page() {
  const { user } = await requirePageSession();
  return <WrongQuestions initialData={await learningOverview(user.id)} />;
}
