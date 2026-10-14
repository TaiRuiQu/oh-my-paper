import { ServerDomain } from "@/server/platform/page-layout";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ServerDomain area="admin">{children}</ServerDomain>;
}
