"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { schoolCommandSchema, type SchoolCommand, type SchoolState } from "@/contracts/school";
import { apiRequest, ApiRequestError, jsonBody } from "@/lib/http-client";

type SaveResult = { ok: true } | { ok: false; error: string; conflict: boolean };
type ContextValue = {
  state: SchoolState;
  pending: boolean;
  stale: boolean;
  refresh: () => Promise<void>;
  execute: (command: SchoolCommand) => Promise<SaveResult>;
};
const Context = createContext<ContextValue | null>(null);

export function SchoolProvider({
  initialState,
  children,
}: {
  initialState: SchoolState;
  children: ReactNode;
}) {
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState(false);
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState("");
  const locked = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function readState() {
    const next = await apiRequest<SchoolState>("/api/platform/school/state");
    if (alive.current) {
      setState(next);
      setStale(false);
    }
  }
  async function refresh() {
    if (locked.current) throw new Error("正在处理，请稍候再重新读取。");
    locked.current = true;
    setPending(true);
    try {
      await readState();
      if (alive.current) setNotice("已读取最新教务资料。");
    } finally {
      locked.current = false;
      if (alive.current) setPending(false);
    }
  }
  async function execute(command: SchoolCommand): Promise<SaveResult> {
    if (!state.canManage)
      return { ok: false, error: "当前账号没有教务管理权限。", conflict: false };
    if (locked.current || stale)
      return { ok: false, error: "请等待处理完成或先重新读取资料。", conflict: false };
    const parsed = schoolCommandSchema.safeParse(command);
    if (!parsed.success)
      return {
        ok: false,
        error: parsed.error.issues
          .map((issue) => {
            if (/[\u3400-\u9fff]/.test(issue.message)) return issue.message;
            const field = [...issue.path].reverse().find((part) => typeof part === "string");
            if (field === "periodIds") return "请选择上课节次，连堂可选择多个节次。";
            const labels: Record<string, string> = {
              name: "名称",
              startDate: "开始日期",
              endDate: "结束日期",
              weekOneMonday: "第 1 周周一",
              timezone: "学校时区",
              reason: "调整或发布理由",
              capacity: "教室人数",
              weeklyPeriods: "每周课时",
              fromWeek: "起始教学周",
              toWeek: "结束教学周",
              offeringId: "开课任务",
              yearId: "所属学年",
              courseId: "课程",
              classroomId: "班级",
              teacherId: "教师",
              originalDate: "原定上课日期",
              date: "日期",
              sourceDate: "换日来源日期",
              startTime: "节次开始时间",
              endTime: "节次结束时间",
            };
            return `${typeof field === "string" ? (labels[field] ?? "教务资料") : "教务资料"}格式或取值无效，请检查后重试。`;
          })
          .join("；"),
        conflict: false,
      };
    locked.current = true;
    setPending(true);
    try {
      await apiRequest("/api/platform/school/commands", {
        method: "POST",
        ...jsonBody(parsed.data),
      });
      try {
        await readState();
        if (alive.current) setNotice("已保存教务资料。");
      } catch {
        if (alive.current) {
          setStale(true);
          setNotice("保存已成功，但最新资料读取失败。请重新读取后继续操作，无需重复保存。");
        }
      }
      return { ok: true };
    } catch (cause) {
      return {
        ok: false,
        error: cause instanceof Error ? cause.message : "保存失败，请重试。",
        conflict: cause instanceof ApiRequestError && cause.status === 409,
      };
    } finally {
      locked.current = false;
      if (alive.current) setPending(false);
    }
  }
  return (
    <Context.Provider value={{ state, pending, stale, refresh, execute }}>
      {notice && (
        <div
          className={`p-notice ${stale ? "error" : "success"}`}
          role={stale ? "alert" : "status"}
        >
          <p>{notice}</p>
          {stale && (
            <button
              className="button secondary"
              disabled={pending}
              onClick={async () => {
                try {
                  await refresh();
                } catch (cause) {
                  setNotice(cause instanceof Error ? cause.message : "读取失败，请重试。");
                }
              }}
            >
              重新读取教务资料
            </button>
          )}
        </div>
      )}
      {children}
    </Context.Provider>
  );
}

export function useSchool() {
  const context = useContext(Context);
  if (!context) throw new Error("缺少教务资料上下文。");
  return context;
}
