"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  teachingCommandSchema,
  type TeachingCommand,
  type TeachingCommandResult,
  type TeachingSession,
  type TeachingSessions,
} from "@/contracts/teaching";
import { apiRequest, ApiRequestError, jsonBody } from "@/lib/http-client";
type Result =
  { ok: true; result: TeachingCommandResult } | { ok: false; error: string; conflict: boolean };
type Value = {
  session?: TeachingSession;
  list?: TeachingSessions;
  pending: boolean;
  stale: boolean;
  execute: (command: TeachingCommand) => Promise<Result>;
  refresh: () => Promise<void>;
};
const Context = createContext<Value | null>(null);
export function TeachingProvider({
  initialSession,
  initialList,
  children,
}: {
  initialSession?: TeachingSession;
  initialList?: TeachingSessions;
  children: ReactNode;
}) {
  const [session, setSession] = useState(initialSession),
    [list, setList] = useState(initialList);
  const [pending, setPending] = useState(false),
    [stale, setStale] = useState(false),
    [notice, setNotice] = useState("");
  const locked = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function read() {
    if (initialSession) {
      const next = await apiRequest<TeachingSession>(
        `/api/platform/teaching/sessions/${initialSession.id}`,
      );
      if (alive.current) setSession(next);
    } else {
      const next = await apiRequest<TeachingSessions>("/api/platform/teaching/sessions");
      if (alive.current) setList(next);
    }
    if (alive.current) setStale(false);
  }
  async function refresh() {
    if (locked.current) throw new Error("正在处理，请稍候。");
    locked.current = true;
    setPending(true);
    try {
      await read();
      if (alive.current) setNotice("已读取最新教学记录。");
    } finally {
      locked.current = false;
      if (alive.current) setPending(false);
    }
  }
  async function execute(command: TeachingCommand): Promise<Result> {
    if (locked.current || stale)
      return { ok: false, error: "请等待处理完成或先重新读取教学记录。", conflict: false };
    const parsed = teachingCommandSchema.safeParse(command);
    if (!parsed.success)
      return {
        ok: false,
        error: parsed.error.issues
          .map((issue) =>
            /[\u3400-\u9fff]/.test(issue.message)
              ? issue.message
              : "请补齐必填内容，并检查日期、数量和文字长度。",
          )
          .join("；"),
        conflict: false,
      };
    locked.current = true;
    setPending(true);
    try {
      const result = await apiRequest<TeachingCommandResult>("/api/platform/teaching/commands", {
        method: "POST",
        ...jsonBody(parsed.data),
      });
      try {
        await read();
        if (alive.current) setNotice("教学记录已保存。");
      } catch {
        if (alive.current) {
          setStale(true);
          setNotice("记录已保存，但最新资料读取失败。请重新读取后继续，无需重复保存。");
        }
      }
      return { ok: true, result };
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
    <Context.Provider value={{ session, list, pending, stale, execute, refresh }}>
      {notice && (
        <div
          className={`p-notice ${stale ? "error" : "success"}`}
          role={stale ? "alert" : "status"}
        >
          <p>{notice}</p>
          {stale && (
            <button
              type="button"
              className="button secondary"
              disabled={pending}
              onClick={async () => {
                try {
                  await refresh();
                } catch (cause) {
                  if (alive.current)
                    setNotice(cause instanceof Error ? cause.message : "读取失败，请重试。");
                }
              }}
            >
              重新读取教学记录
            </button>
          )}
        </div>
      )}
      {children}
    </Context.Provider>
  );
}
export function useTeaching() {
  const value = useContext(Context);
  if (!value) throw new Error("缺少教学记录上下文。");
  return value;
}
