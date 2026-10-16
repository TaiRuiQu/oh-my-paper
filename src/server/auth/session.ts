import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./index";
import { AccessError } from "@/server/http/errors";

export async function getSession(requestHeaders: Headers) {
  return getAuth().api.getSession({ headers: requestHeaders });
}

export async function requireSession(requestHeaders: Headers) {
  const session = await getSession(requestHeaders);
  if (!session) throw new AccessError(401, "请先登录。");
  return session;
}

export async function requirePageSession() {
  const session = await getSession(await headers());
  if (!session) redirect("/login");
  return session;
}
