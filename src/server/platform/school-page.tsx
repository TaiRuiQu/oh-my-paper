import { requirePageSession } from "@/server/auth/session";
import { loadSchoolState } from "@/server/platform/school/service";
import { SchoolWorkspace } from "@/components/school/workspace";

export async function SchoolPage({
  section,
}: {
  section: "overview" | "settings" | "timetable" | "schedule";
}) {
  const session = await requirePageSession();
  return (
    <SchoolWorkspace
      initialState={await loadSchoolState({ id: session.user.id })}
      section={section}
    />
  );
}
