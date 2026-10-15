"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  House,
  NotebookPen,
  Files,
  Library,
  Settings2,
  GraduationCap,
  ChevronDown,
  Menu,
  ChevronRight,
  Origami,
} from "lucide-react";
import type { PlatformState } from "@/contracts/platform";
import { TEACHING_ROLES } from "@/contracts/permissions";
import { AREA_LABELS, areaForPath, navigationFor } from "@/contracts/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";

const icons = {
  workspace: House,
  homework: NotebookPen,
  exams: Files,
  questions: Library,
  learning: GraduationCap,
  admin: Settings2,
};
export function PlatformShell({
  actor,
  children,
}: {
  actor: PlatformState["actor"];
  children: ReactNode;
}) {
  const path = usePathname();
  const routeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = routeRef.current?.animate?.(
      [
        { opacity: 0.4, transform: "translateY(4px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 180, easing: "ease-out" },
    );
    return () => animation?.cancel();
  }, [path]);
  const area = areaForPath(path);
  const groups = navigationFor(actor.role);
  const workbench =
    /\/(new|edit|layout|answers|export)$/.test(path) && ["exams", "homework"].includes(area);
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([
    "workspace",
    "homework",
    "exams",
    "questions",
    "learning",
    "admin",
  ]);
  const navigation = (
    <>
      <Link href="/workspace" className="wordmark" onClick={() => setMobile(false)}>
        <BookOpen size={22} />
        <span className="p-brand-name">
          Oh My Paper<small>教学工作平台</small>
        </span>
      </Link>
      <nav className="p-nav p-group-nav" aria-label="主导航">
        <Link href="/xiaozhi" className="p-xiaozhi-entry" onClick={() => setMobile(false)}>
          <Origami size={18} aria-hidden="true" />
          小纸<span>AI 助手</span>
        </Link>
        {groups.map((group) => {
          const Icon = icons[group.area];
          const expanded =
            !collapsed.includes(group.area) ||
            (group.area === area && !collapsed.includes(`${group.area}:manual`));
          const currentItem = [...group.items]
            .filter((item) => path === item.href || path.startsWith(`${item.href}/`))
            .sort((a, b) => b.href.length - a.href.length)[0]?.href;
          return (
            <div className="p-nav-group" key={group.area}>
              <div className={`p-nav-group-heading${group.area === area ? " active" : ""}`}>
                <Link href={group.href} onClick={() => setMobile(false)}>
                  <Icon size={18} aria-hidden="true" />
                  {group.label}
                </Link>
                <button
                  aria-label={`${expanded ? "收起" : "展开"}${group.label}导航`}
                  aria-expanded={expanded}

                  onClick={() =>
                    setCollapsed(
                      expanded
                        ? [...collapsed, group.area, `${group.area}:manual`]
                        : collapsed.filter((v) => v !== group.area && v !== `${group.area}:manual`),
                    )
                  }
                >
                  <ChevronDown size={15} className={expanded ? "" : "is-collapsed"} />
                </button>
              </div>
              <div className="p-nav-collapse" data-expanded={expanded} inert={!expanded}>
                <div className="p-nav-children">
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={currentItem === item.href ? "page" : undefined}
                      onClick={() => setMobile(false)}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </nav>
      <div className="p-sidebar-foot">
        <span className="p-online-dot" />
        教学工作平台
      </div>
    </>
  );
  return (
    <div className="p-shell p-routed-shell">
      <aside className="p-sidebar p-desktop-sidebar">{navigation}</aside>
      <div className="p-body">
        <header className="p-topbar">
          <div className="p-actions">
            <Sheet open={mobile} onOpenChange={setMobile}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="p-mobile-menu"
                  aria-label="打开主导航"
                >
                  <Menu size={20} />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-navigation-sheet">
                <SheetHeader className="sr-only">
                  <SheetTitle>教学导航</SheetTitle>
                  <SheetDescription>选择模块和功能页面。</SheetDescription>
                </SheetHeader>
                {navigation}
              </SheetContent>
            </Sheet>
            <nav className="p-breadcrumb" aria-label="当前位置">
              <Link href="/workspace">工作台</Link>
              <ChevronRight size={14} />
              <Link href={`/${area}`}>{AREA_LABELS[area]}</Link>
            </nav>
          </div>
          <div className="p-account">
            <span>{actor.name}</span>
            <span className="p-role">
              {actor.role === "TEACHER" && actor.teachingAssignments?.length
                ? [
                    ...new Set(actor.teachingAssignments.map((row) => TEACHING_ROLES[row.role])),
                  ].join("、")
                : { ADMIN: "管理员", TEACHER: "教师", STUDENT: "学生" }[actor.role]}
            </span>
            <SignOutButton />
          </div>
        </header>
        <main id="main" className={`p-main${workbench ? " p-main-workbench" : ""}`}>
          <div ref={routeRef} className="p-route-content">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
