import type { Metadata } from "next";
import { SchoolPage } from "@/server/platform/school-page";
export const metadata: Metadata = { title: "我的课程" };
export default function Page() {
  return <SchoolPage section="schedule" />;
}
