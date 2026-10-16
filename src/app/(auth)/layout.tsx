import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getSession(await headers())) redirect("/xiaozhi");
  return (
    <main id="main" className="auth-page">
      {children}
    </main>
  );
}
