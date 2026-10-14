import { requirePageSession } from "@/server/auth/session";
import { PlatformWorkspace } from "@/components/platform/workspace";

export const metadata = { title: "教学工作台" };

export default async function WorkspacePage() {
  await requirePageSession();
  return <PlatformWorkspace />;
}
