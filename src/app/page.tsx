import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "@/server/auth/session";

export default async function HomePage() {
  const session = await getSession(await headers());
  redirect(session ? "/dashboard" : "/login");
}
