import type { Metadata } from "next";
import { SchoolPage } from "@/server/platform/school-page";
export const metadata: Metadata = { title: "课表与校历" };
export default function Page() {
  return <SchoolPage section="timetable" />;
}
