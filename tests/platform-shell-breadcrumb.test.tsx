import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Role } from "@/contracts/platform";
import { PlatformShell } from "@/components/platform/shell";

const route = vi.hoisted(() => ({ path: "/learning/results" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.path }));
vi.mock("@/components/sign-out-button", () => ({ SignOutButton: () => null }));

it.each([
  ["STUDENT", "/learning/results", "/learning/results"],
  ["STUDENT", "/learning/reports", "/learning/results"],
  ["STUDENT", "/learning/wrong-questions", "/learning/results"],
  ["TEACHER", "/exams/papers", "/exams"],
  ["ADMIN", "/admin/users", "/admin"],
] as const)("gives %s a working module breadcrumb on %s", (role: Role, path, target) => {
  route.path = path;
  const html = renderToStaticMarkup(
    <PlatformShell actor={{ id: "actor", name: "用户", role }}>
      <p>页面内容</p>
    </PlatformShell>,
  );
  const breadcrumb = html.match(/<nav[^>]*aria-label="当前位置"[^>]*>(.*?)<\/nav>/)?.[1];
  expect(breadcrumb).toContain(`href="${target}"`);
  expect(breadcrumb).not.toContain('href="/learning"');
});
