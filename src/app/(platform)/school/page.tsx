import type { Metadata } from "next";
import { SchoolPage } from "@/server/platform/school-page";
export const metadata: Metadata = { title: "教务与课程" };
export default function Page() {
  return <SchoolPage section="overview" />;
}
