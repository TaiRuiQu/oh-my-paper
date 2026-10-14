"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Library,
  Files,
  ScanLine,
  Users,
  CalendarDays,
  ClipboardCheck,
  ChartNoAxesCombined,
  Settings2,
  LayoutDashboard,
  Menu,
  X,
  ArrowRight,
} from "lucide-react";
import type { PlatformCommand, PlatformState } from "@/contracts/platform";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { SignOutButton } from "@/components/sign-out-button";
import { Panel, Empty } from "./primitives";
import { Questions } from "./questions";
import { Papers } from "./papers";
import { Templates } from "./templates";
import { Classes } from "./classes";
import { Assessments } from "./assessments";
import { Scans } from "./scans";
import { Reviews } from "./reviews";
import { Analytics } from "./analytics";
import { Admin } from "./admin";
import { PlatformAI } from "./ai";
const nav = [
  { key: "overview", label: "教学概览", icon: LayoutDashboard },
  { key: "questions", label: "题库", icon: Library },
  { key: "papers", label: "试卷与作业", icon: Files },
  { key: "templates", label: "答题卡模板", icon: ScanLine },
  { key: "classes", label: "班级与学生", icon: Users },
  { key: "assessments", label: "考试与作业安排", icon: CalendarDays },
  { key: "scans", label: "扫描与作答录入", icon: ScanLine },
  { key: "reviews", label: "阅卷工作台", icon: ClipboardCheck },
  { key: "analytics", label: "成绩与学情", icon: ChartNoAxesCombined },
] as const;
const descriptions: Record<string, string> = {
  overview: "把题目准备、考试组织与考后反馈连接起来。",
  questions: "让每一道题成为可搜索、可复用的教学资源。",
  papers: "按教学目标选择题目，设定题序、分值与排版。",
  templates: "为每道题明确答题范围，提供可靠的扫描定位依据。",
  classes: "建立考试参与名单，连接教师与学生。",
  assessments: "组织考试和日常作业，设置多科联合成绩与阅卷方式。",
  scans: "从纸上的作答开始，录入每一位学生的考试。",
  reviews: "结合题目、作答与评分标准，完成可靠的逐题评阅。",
  analytics: "从分数进一步了解班级与每位学生的学习情况。",
  admin: "维护账号权限和模型接入。",
};
export function PlatformWorkspace() {
  const [state, setState] = useState<PlatformState>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState<{ text: string; error?: boolean }>(),
    [tab, setTab] = useState("overview"),
    [pending, setPending] = useState(false),
    [open, setOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null),
    toggle = useRef<HTMLButtonElement>(null),
    close = useRef<HTMLButtonElement>(null);
  const notify = useCallback(
    (message: string, error?: boolean) => setNotice({ text: message, error }),
    [],
  );
  const refresh = useCallback(async () => {
    const next = await apiRequest<PlatformState>("/api/platform");
    setState(next);
    setError("");
    return next;
  }, []);
  useEffect(() => {
    apiRequest<PlatformState>("/api/platform")
      .then((next) => {
        setState(next);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    const update = () =>
      setTab(new URLSearchParams(window.location.search).get("tab") ?? "overview");
    update();
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = toggle.current;
    close.current?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab") {
        const elements = Array.from(
          sidebar.current?.querySelectorAll<HTMLElement>("a,button") ?? [],
        );
        const first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", handle);
    return () => {
      window.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [open]);
  const go = (key: string) => {
    setTab(key);
    window.history.pushState(null, "", `/workspace?tab=${key}`);
    setOpen(false);
    setNotice(undefined);
  };
  const mutate = async (command: PlatformCommand) => {
    setPending(true);
    try {
      const response = await apiRequest<{ id?: string }>("/api/platform", {
        method: "POST",
        ...jsonBody(command),
      });
      await refresh();
      notify("已保存。");
      return response;
    } catch (e) {
      notify(e instanceof Error ? e.message : "操作失败，请重试。", true);
      return { error: e instanceof Error ? e.message : "操作失败，请重试。" };
    } finally {
      setPending(false);
    }
  };
  const reload = useCallback(async () => {
    await refresh();
  }, [refresh]);
  if (!state)
    return (
      <main id="main" className="p-loading">
        {error ? (
          <div>
            <p role="alert">{error}</p>
            <button
              className="button"
              onClick={() => void refresh().catch((e) => setError(e.message))}
            >
              重新加载
            </button>
          </div>
        ) : (
          <p role="status">正在打开教学工作台…</p>
        )}
      </main>
    );
  const student = state.actor.role === "STUDENT",
    available = student
      ? [{ key: "analytics", label: "我的学习", icon: ChartNoAxesCombined }]
      : [
          ...nav,
          ...(state.actor.role === "ADMIN"
            ? [{ key: "admin", label: "系统管理", icon: Settings2 }]
            : []),
        ],
    current = available.find((n) => n.key === tab) ?? available[0],
    active = current.key;
  return (
    <div className="p-shell">
      {open && (
        <button
          className="p-scrim"
          tabIndex={-1}
          aria-label="关闭导航"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        ref={sidebar}
        id="platform-navigation"
        className={`p-sidebar${open ? " is-open" : ""}`}
      >
        <Link
          href="/workspace"
          className="wordmark"
          onClick={(e) => {
            e.preventDefault();
            go(student ? "analytics" : "overview");
          }}
        >
          <BookOpen size={22} />
          Oh My Paper
        </Link>
        <button
          className="icon-button p-mobile-menu"
          ref={close}
          aria-label="关闭导航"
          onClick={() => setOpen(false)}
        >
          <X size={20} />
        </button>
        <nav className="p-nav" aria-label="教学导航">
          {available.map(({ key, label, icon: Icon }, index) => (
            <div key={key}>
              {!student && index === 5 && <p className="p-nav-heading">考试实施</p>}
              {key === "admin" && <p className="p-nav-heading">管理</p>}
              <a
                href={`/workspace?tab=${key}`}
                aria-current={active === key ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  go(key);
                }}
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </a>
            </div>
          ))}
        </nav>
        <div className="p-sidebar-foot">从题目，到学习的进步。</div>
      </aside>
      <div className="p-body" inert={open}>
        <header className="p-topbar">
          <div className="p-actions">
            <button
              ref={toggle}
              className="icon-button p-mobile-menu"
              aria-label="打开导航"
              aria-expanded={open}
              aria-controls="platform-navigation"
              onClick={() => setOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span>{current.label}</span>
          </div>
          <div className="p-account">
            <span>{state.actor.name}</span>
            <span className="p-role">
              {{ ADMIN: "管理员", TEACHER: "教师", STUDENT: "学生" }[state.actor.role]}
            </span>
            <SignOutButton />
          </div>
        </header>
        <main id="main" className="p-main">
          <div className="p-heading">
            <div>
              <h1>{current.label}</h1>
              <p>{student ? "每次作答，都能帮助你找到下一步练习的方向。" : descriptions[active]}</p>
            </div>
            <button
              className="button secondary"
              disabled={pending}
              onClick={() =>
                void refresh()
                  .then(() => notify("已更新最新数据。"))
                  .catch((e) => notify(e.message, true))
              }
            >
              刷新数据
            </button>
          </div>
          {notice && (
            <div
              className={`p-notice ${notice.error ? "error" : "success"}`}
              role={notice.error ? "alert" : "status"}
            >
              {notice.text}
            </div>
          )}
          <PlatformAI state={state} tab={active} refresh={reload} notify={notify} />
          {active === "overview" && <Overview state={state} go={go} />}{" "}
          {active === "questions" && (
            <Questions questions={state.questions} mutate={mutate} pending={pending} />
          )}{" "}
          {active === "papers" && (
            <Papers
              papers={state.papers}
              questions={state.questions}
              mutate={mutate}
              pending={pending}
            />
          )}{" "}
          {active === "templates" && (
            <Templates
              templates={state.templates}
              papers={state.papers}
              mutate={mutate}
              pending={pending}
            />
          )}{" "}
          {active === "classes" && <Classes state={state} mutate={mutate} pending={pending} />}{" "}
          {active === "assessments" && (
            <Assessments state={state} mutate={mutate} pending={pending} />
          )}{" "}
          {active === "scans" && <Scans state={state} refresh={reload} notify={notify} />}{" "}
          {active === "reviews" && <Reviews state={state} mutate={mutate} pending={pending} />}{" "}
          {active === "analytics" && <Analytics state={state} />}{" "}
          {active === "admin" && <Admin state={state} refresh={reload} notify={notify} />}
        </main>
      </div>
    </div>
  );
}
function Overview({ state, go }: { state: PlatformState; go: (tab: string) => void }) {
  const steps = [
    ["questions", "建立题库"],
    ["papers", "选题组卷"],
    ["templates", "制作答题卡"],
    ["assessments", "安排考试"],
    ["scans", "扫描录入"],
    ["reviews", "逐题阅卷"],
    ["analytics", "查看学情"],
  ];
  return (
    <>
      <Panel title="一次完整的教学流程" description="准备试题，组织考试，留下可追踪的学习反馈。">
        <div className="p-flow">
          {steps.map(([key, label], i) => (
            <span className="p-actions" key={key}>
              <a
                href={`/workspace?tab=${key}`}
                onClick={(e) => {
                  e.preventDefault();
                  go(key);
                }}
              >
                {label}
              </a>
              {i < steps.length - 1 && <ArrowRight size={15} className="p-muted" />}
            </span>
          ))}
        </div>
      </Panel>
      <Panel title="当前工作" description="优先完成待阅卷答卷，再发布本次考试成绩。">
        <div className="p-table" role="region" aria-label="当前教学工作" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>工作项</th>
                <th>当前数量</th>
                <th>下一步</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>可复用题库</td>
                <td>{state.questions.length} 道题</td>
                <td>
                  <button className="link-button" onClick={() => go("questions")}>
                    创建与整理试题
                  </button>
                </td>
              </tr>
              <tr>
                <td>试卷与作业</td>
                <td>{state.papers.length} 份</td>
                <td>
                  <button className="link-button" onClick={() => go("papers")}>
                    继续组卷
                  </button>
                </td>
              </tr>
              <tr>
                <td>班级学生</td>
                <td>
                  {state.classrooms.length} 个班 /{" "}
                  {state.classrooms.reduce((a, c) => a + c.students.length, 0)} 位学生
                </td>
                <td>
                  <button className="link-button" onClick={() => go("classes")}>
                    核对名单与卡号
                  </button>
                </td>
              </tr>
              <tr>
                <td>待阅卷答卷</td>
                <td>{state.submissions.filter((s) => s.status !== "GRADED").length} 份</td>
                <td>
                  <button className="link-button" onClick={() => go("reviews")}>
                    进入阅卷
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel
        title="最近的考试与作业"
        actions={
          <button className="button secondary" onClick={() => go("assessments")}>
            查看全部
          </button>
        }
      >
        {state.assessments.length ? (
          state.assessments.slice(0, 5).map((a) => (
            <div className="p-list-row" key={a.id}>
              <div>
                <strong>{a.name}</strong>
                <small>
                  {a.kind === "EXAM" ? "考试" : "作业"} ·{" "}
                  {a.papers.map((p) => p.subject).join("、")} · {a.classroomIds.length} 个班
                </small>
              </div>
              <span className={`p-status${a.published ? " success" : ""}`}>
                {a.published ? "成绩已发布" : "进行中"}
              </span>
            </div>
          ))
        ) : (
          <Empty>先建立题库、试卷和班级，即可安排第一场考试。</Empty>
        )}
      </Panel>
    </>
  );
}
