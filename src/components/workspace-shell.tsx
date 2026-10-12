"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Users,
  Files,
  ClipboardCheck,
  ChartNoAxesCombined,
  Settings2,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SignOutButton } from "./sign-out-button";

const navigation = [
  {
    href: "/classes",
    label: "班级管理",
    icon: Users,
    description: "班级与学生",
  },
  {
    href: "/dashboard",
    label: "试卷板块",
    icon: Files,
    description: "题套与电子试卷",
  },
  {
    href: "/grading",
    label: "批改板块",
    icon: ClipboardCheck,
    description: "作答与批改报告",
  },
  {
    href: "/analysis",
    label: "学情分析",
    icon: ChartNoAxesCombined,
    description: "错题与巩固练习",
  },
];
export function WorkspaceShell({
  children,
  name,
  isAdmin,
}: {
  children: React.ReactNode;
  name: string;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false),
    [mobileOpen, setMobileOpen] = useState(false);
  const active = pathname.startsWith("/classes")
    ? "/classes"
    : pathname.startsWith("/grading") || pathname.startsWith("/grades") || /\/grade$/.test(pathname)
      ? "/grading"
      : pathname.startsWith("/analysis") ||
          pathname.startsWith("/wrong-questions") ||
          pathname.startsWith("/practice")
        ? "/analysis"
        : pathname.startsWith("/admin")
          ? "/admin/ai"
          : "/dashboard";
  const title = navigation.find((n) => n.href === active)?.label ?? "服务设置";
  const sidebarContent = (mobile = false) => (
    <>
      <Link href="/dashboard" className="oa-brand" onClick={() => setMobileOpen(false)}>
        <BookOpen size={23} aria-hidden="true" />
        <span>
          Oh My Paper<small>教学工作台</small>
        </span>
      </Link>
      <nav className="oa-navigation">
        {navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active === item.href ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            onClick={() => setMobileOpen(false)}
          >
            <item.icon size={19} aria-hidden="true" />
            <span>
              {item.label}
              <small>{item.description}</small>
            </span>
          </Link>
        ))}
      </nav>
      <div className="oa-sidebar-bottom">
        {isAdmin && (
          <Link
            href="/admin/ai"
            className="oa-settings"
            aria-current={active === "/admin/ai" ? "page" : undefined}
          >
            <Settings2 size={18} />
            <span>服务设置</span>
          </Link>
        )}
        {!mobile && (
          <Button
            variant="ghost"
            className="sidebar-collapse"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            <span>收起侧边栏</span>
          </Button>
        )}
      </div>
    </>
  );
  return (
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <div className={`oa-shell${collapsed ? " is-collapsed" : ""}`}>
        <aside className="oa-sidebar" aria-label="主导航">
          {sidebarContent()}
        </aside>
        <div className="oa-body">
          <header className="oa-topbar">
            <div className="oa-breadcrumb">
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="mobile-menu" aria-label="打开导航">
                  <Menu />
                </Button>
              </SheetTrigger>
              <span>教学工作台</span>
              <span aria-hidden="true">/</span>
              <strong>{title}</strong>
            </div>
            <div className="oa-account">
              <span className="account-avatar" aria-hidden="true">
                {name.slice(0, 1)}
              </span>
              <span>{name}</span>
              <SignOutButton />
            </div>
          </header>
          <main id="main" className="workspace-main">
            {children}
          </main>
        </div>
      </div>
      <SheetContent side="left" className="oa-mobile-drawer">
        <SheetTitle className="sr-only">工作台导航</SheetTitle>
        <SheetDescription className="sr-only">
          选择班级管理、试卷、批改或学情分析。
        </SheetDescription>
        {sidebarContent(true)}
      </SheetContent>
    </Sheet>
  );
}
