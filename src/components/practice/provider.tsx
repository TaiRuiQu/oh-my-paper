"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiRequest, ApiRequestError, jsonBody } from "@/lib/http-client";
import {
  practiceCommandSchema,
  type PracticeCommand,
  type PracticeCommandResult,
} from "@/contracts/practice";
export type PracticeWriteResult = PracticeCommandResult;
type WriteOutcome =
  { ok: true; result: PracticeWriteResult } | { ok: false; error: string; conflict: boolean };
type Resource = {
  data: unknown;
  pending: boolean;
  stale: boolean;
  generation: number;
  refresh: () => Promise<void>;
  write: (command: PracticeCommand) => Promise<WriteOutcome>;
};
const Context = createContext<Resource | null>(null);
export function PracticeProvider({
  path,
  children,
  onPendingChange,
}: {
  path: string;
  children: ReactNode;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [data, setData] = useState<unknown>(null),
    [pending, setPending] = useState(false),
    [stale, setStale] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [generation, setGeneration] = useState(0);
  useEffect(() => {
    onPendingChange?.(pending);
    return () => onPendingChange?.(false);
  }, [pending, onPendingChange]);
  const staleRef = useRef(false),
    currentPath = useRef(path);
  const [dataPath, setDataPath] = useState(path);
  if (dataPath !== path) {
    setData(null);
    setDataPath(path);
    setError("");
    setNotice("");
    setStale(false);
  }
  useLayoutEffect(() => {
    currentPath.current = path;
    staleRef.current = false;
  }, [path]);
  const alive = useRef(true),
    lock = useRef(false),
    request = useRef(0);
  const read = useCallback(
    async (signal?: AbortSignal) => {
      const token = ++request.current;
      const next = await apiRequest(path, { signal });
      if (
        !alive.current ||
        signal?.aborted ||
        token !== request.current ||
        currentPath.current !== path
      )
        return;
      setData(next);
      setDataPath(path);
      setError("");
      staleRef.current = false;
      setStale(false);
    },
    [path],
  );
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void read(controller.signal).catch((cause) => {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "练习资料读取失败，请重试。");
    });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [read, path]);
  async function refresh() {
    if (lock.current) throw new Error("正在处理，请稍候。");
    lock.current = true;
    setPending(true);
    try {
      await read();
      if (alive.current && currentPath.current === path) setGeneration((value) => value + 1);
    } finally {
      lock.current = false;
      if (alive.current) setPending(false);
    }
  }
  async function write(command: PracticeCommand): Promise<WriteOutcome> {
    if (lock.current || staleRef.current)
      return { ok: false, error: "请等待处理结束或先重新读取最新资料。", conflict: false };
    const parsed = practiceCommandSchema.safeParse(command);
    if (!parsed.success)
      return {
        ok: false,
        error: parsed.error.issues
          .map((issue) =>
            /[\u3400-\u9fff]/.test(issue.message)
              ? issue.message
              : "请检查必填内容、题目、图片及核对结果。",
          )
          .join("；"),
        conflict: false,
      };
    const writingPath = path;
    lock.current = true;
    setPending(true);
    try {
      const result = await apiRequest<PracticeWriteResult>("/api/platform/practice/commands", {
        method: "POST",
        ...jsonBody(parsed.data),
      });
      if (currentPath.current !== writingPath) return { ok: true, result };
      try {
        await read();
        if (alive.current && currentPath.current === writingPath) setNotice("操作已保存。");
      } catch {
        if (alive.current && currentPath.current === writingPath) {
          staleRef.current = true;
          setStale(true);
          setNotice(
            `操作已保存${result.sequence ? `，第 ${result.sequence} 次提交已收到` : ""}，但最新资料读取失败。请仅重新读取，勿重复保存或提交。`,
          );
        }
      }
      return { ok: true, result };
    } catch (cause) {
      return {
        ok: false,
        error: cause instanceof Error ? cause.message : "操作失败，请重试。",
        conflict: cause instanceof ApiRequestError && cause.status === 409,
      };
    } finally {
      lock.current = false;
      if (alive.current) setPending(false);
    }
  }
  return (
    <Context.Provider
      value={{ data: dataPath === path ? data : null, pending, stale, generation, refresh, write }}
    >
      {(error || notice) && (
        <div
          className={`p-notice ${error || stale ? "error" : "success"}`}
          role={error || stale ? "alert" : "status"}
        >
          <p>{error || notice}</p>
          {(error || stale) && (
            <button
              className="button secondary"
              type="button"
              disabled={pending}
              onClick={async () => {
                try {
                  await refresh();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "重读失败，可再试。");
                }
              }}
            >
              重新读取练习资料
            </button>
          )}
        </div>
      )}
      {(!data || dataPath !== path) && !error && <p role="status">正在读取练习资料…</p>}
      {!!data && dataPath === path && children}
    </Context.Provider>
  );
}
export function usePractice<T>() {
  const value = useContext(Context);
  if (!value) throw new Error("缺少练习资料上下文。");
  return { ...value, data: value.data as T };
}
