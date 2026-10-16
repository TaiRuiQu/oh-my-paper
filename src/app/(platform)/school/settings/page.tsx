import type { Metadata } from "next";
import { SchoolPage } from "@/server/platform/school-page";
export const metadata: Metadata = { title: "学期与开课" };
export default function Page() {
  return <SchoolPage section="settings" />;
}
