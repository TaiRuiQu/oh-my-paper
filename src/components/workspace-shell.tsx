"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Files,
  ClipboardCheck,
  ScanLine,
  Settings2,
  ChartNoAxesCombined,
  PanelLeftClose,
  Menu,
  Users,
  FileSearch,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ActiveTaskCounts } from "@/contracts/active-tasks";
import { apiRequest } from "@/lib/http-client";
import { CreditBalance } from "./credit-balance";
import { SignOutButton } from "./sign-out-button";
const navigation = [
  { href: "/dashboard", label: "试卷管理", icon: Files, taskKey: "exams" },
  { href: "/grading", label: "作业批改", icon: ClipboardCheck, taskKey: "grading" },
  { href: "/grading/cards", label: "答题卡批改", icon: ScanLine, taskKey: "answerCards" },
] as const;
export function WorkspaceShell({
  children,
  name,
  isAdmin,
  initialCredits,
}: {
  children: React.ReactNode;
  name: string;
  isAdmin: boolean;
  initialCredits?: string;
}) {
  const path = usePathname(),
    [open, setOpen] = useState(false);
  const activeTasks = useQuery({
    queryKey: ["active-tasks"],
    queryFn: () => apiRequest<ActiveTaskCounts>("/api/tasks/active"),
    refetchInterval: 3000,
    staleTime: 0,
  });
  const sidebar = useRef<HTMLElement>(null),
    toggle = useRef<HTMLButtonElement>(null),
    close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const returnTarget = toggle.current;
    close.current?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "Tab") {
        const elements = Array.from(
          sidebar.current?.querySelectorAll<HTMLElement>("a, button:not(:disabled)") ?? [],
        );
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      returnTarget?.focus();
    };
  }, [open]);
  const current = path.startsWith("/ai-settings")
    ? "AI 模型与额度"
    : path.startsWith("/admin")
      ? "系统设置"
      : path.startsWith("/grading/cards")
        ? "答题卡批改"
        : path.startsWith("/quick-grading")
          ? "作业批改"
          : path.startsWith("/grading") || path.startsWith("/grades")
            ? "作业批改"
            : "试卷管理";
  return (
    <div className="workspace-layout">
      {open && (
        <button
          className="sidebar-scrim"
          tabIndex={-1}
          aria-label="关闭导航"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        ref={sidebar}
        id="workspace-navigation"
        className={`workspace-sidebar${open ? " is-open" : ""}`}
      >
        <Link href="/dashboard" className="wordmark" onClick={() => setOpen(false)}>
          <BookOpen size={23} aria-hidden="true" />
          <span>Oh My Paper</span>
        </Link>
        <button
          ref={close}
          className="icon-button sidebar-close"
          aria-label="关闭导航"
          onClick={() => setOpen(false)}
        >
          <PanelLeftClose size={20} />
        </button>
        <nav aria-label="主导航">
          {navigation.map(({ href, label, icon: Icon, taskKey }) => {
            const count =
              (activeTasks.data?.[taskKey] ?? 0) +
              (taskKey === "grading" ? (activeTasks.data?.quickGrading ?? 0) : 0);
            return (
              <Link
                key={href}
                href={href}
                aria-current={current === label ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <Icon size={19} aria-hidden="true" />
                {label}
                {!!count && (
                  <span
                    className="sidebar-task-count"
                    role="status"
                    aria-label={`${count} 个任务正在进行中`}
                    title={`${count} 个任务正在进行中`}
                  >
                    <span aria-hidden="true">{count}</span>
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        {isAdmin && (
          <nav className="sidebar-settings" aria-label="系统管理">
            <Link
              href="/admin/exams"
              aria-current={path.startsWith("/admin/exams") ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <FileSearch size={19} aria-hidden="true" />
              试卷记录审查
            </Link>
            <Link
              href="/admin/users"
              aria-current={path.startsWith("/admin/users") ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <Users size={19} aria-hidden="true" />
              用户管理
            </Link>
            <Link
              href="/admin/ai"
              aria-current={path.startsWith("/admin/ai") ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <Settings2 size={19} aria-hidden="true" />
              AI 设置
            </Link>
            <Link
              href="/admin/usage"
              aria-current={path.startsWith("/admin/usage") ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <ChartNoAxesCombined size={19} aria-hidden="true" />
              用量统计
            </Link>
          </nav>
        )}
        <div className="sidebar-footer">
          <span>试卷与作答，一处管理。</span>
        </div>
      </aside>
      <div className="workspace-body" inert={open}>
        <header className="workspace-topbar">
          <div className="topbar-location">
            <button
              ref={toggle}
              className="icon-button sidebar-toggle"
              aria-controls="workspace-navigation"
              aria-expanded={open}
              aria-label="打开导航"
              onClick={() => setOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span>{current}</span>
          </div>
          <div className="account">
            {initialCredits !== undefined ? (
              <CreditBalance initialCredits={initialCredits} unlimited={isAdmin} />
            ) : (
              <Link className="credit-balance" href="/ai-settings">
                AI 模型与额度
              </Link>
            )}
            <span className="account-avatar" aria-hidden="true">
              {name.slice(0, 1)}
            </span>
            <span>{name}</span>
            {isAdmin && <span className="role-badge">管理员</span>}
            <SignOutButton />
          </div>
        </header>
        <main id="main" className="workspace-main">
          {children}
        </main>
      </div>
    </div>
  );
}
