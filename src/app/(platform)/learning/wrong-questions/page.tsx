import { LearningReportPage } from "@/components/platform/report-pages";

export const metadata = { title: "我的错题" };

export default function Page() {
  return <LearningReportPage view="wrong" />;
}
