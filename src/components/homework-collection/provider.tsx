"use client";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  homeworkCommandSchema,
  type HomeworkAssignmentDetail,
  type HomeworkAssignments,
  type HomeworkCommand,
  type HomeworkCommandResult,
  type HomeworkIssuePreview,
} from "@/contracts/homework";
import { apiRequest, ApiRequestError, jsonBody } from "@/lib/http-client";
export type HomeworkData =
  | { kind: "preview"; preview: HomeworkIssuePreview }
  | { kind: "detail"; detail: HomeworkAssignmentDetail }
  | { kind: "list"; list: HomeworkAssignments };
type Result =
  { ok: true; result: HomeworkCommandResult } | { ok: false; error: string; conflict: boolean };
type Context = {
  generation: number;
  data: HomeworkData | null;
  pending: boolean;
  stale: boolean;
  refresh: () => Promise<void>;
  execute: (command: HomeworkCommand) => Promise<Result>;
};
const HomeworkContext = createContext<Context | null>(null);
export function HomeworkProvider({
  assessmentId,
  assignmentId,
  children,
}: {
  assessmentId?: string;
  assignmentId?: string;
  children: ReactNode;
}) {
  const [data, setData] = useState<HomeworkData | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [stale, setStale] = useState(false),
    [notice, setNotice] = useState("");
  const [generation, setGeneration] = useState(0);
  const lock = useRef(false),
    alive = useRef(true);
  const read = useCallback(
    async (signal?: AbortSignal) => {
      let next: HomeworkData;
      if (assessmentId) {
        const list = await apiRequest<HomeworkAssignments>(
          `/api/platform/homework/assignments?${new URLSearchParams({ assessmentId })}`,
          { signal },
        );
        if (list.view !== "TEACHER") throw new Error("当前账号无作业收交管理权限。");
        const existing = list.assignments.find((entry) => entry.assessmentId === assessmentId);
        next = existing
          ? {
              kind: "detail",
              detail: await apiRequest<HomeworkAssignmentDetail>(
                `/api/platform/homework/assignments/${existing.id}`,
                { signal },
              ),
            }
          : {
              kind: "preview",
              preview: await apiRequest<HomeworkIssuePreview>(
                `/api/platform/homework/assignments/${assessmentId}/preview`,
                { signal },
              ),
            };
      } else if (assignmentId)
        next = {
          kind: "detail",
          detail: await apiRequest<HomeworkAssignmentDetail>(
            `/api/platform/homework/assignments/${assignmentId}`,
            { signal },
          ),
        };
      else
        next = {
          kind: "list",
          list: await apiRequest<HomeworkAssignments>("/api/platform/homework/assignments", {
            signal,
          }),
        };
      if (alive.current && !signal?.aborted) {
        setData(next);
        setStale(false);
        setError("");
      }
    },
    [assessmentId, assignmentId],
  );
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void read(controller.signal).catch((cause) => {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "作业读取失败，请重试。");
    });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [read]);
  async function refresh() {
    if (lock.current) throw new Error("正在处理，请稍候。");
    lock.current = true;
    setPending(true);
    try {
      await read();
      if (alive.current) setGeneration((value) => value + 1);
    } finally {
      lock.current = false;
      if (alive.current) setPending(false);
    }
  }
  async function execute(command: HomeworkCommand): Promise<Result> {
    if (lock.current || stale)
      return { ok: false, error: "请等待处理完成或先重新读取作业。", conflict: false };
    const parsed = homeworkCommandSchema.safeParse(command);
    if (!parsed.success)
      return {
        ok: false,
        error: parsed.error.issues
          .map((issue) =>
            /[\u3400-\u9fff]/.test(issue.message)
              ? issue.message
              : "请检查必填内容、日期、图片和文字长度。",
          )
          .join("；"),
        conflict: false,
      };
    lock.current = true;
    setPending(true);
    try {
      const result = await apiRequest<HomeworkCommandResult>("/api/platform/homework/commands", {
        method: "POST",
        ...jsonBody(parsed.data),
      });
      try {
        await read();
        if (alive.current) setNotice("操作已保存。");
      } catch {
        if (alive.current) {
          setStale(true);
          setNotice(
            command.type === "homework.submit"
              ? `提交已成功，回执为第 ${result.sequence ?? "本"} 次提交。列表读取失败，请重新读取，勿重复提交。`
              : "操作已保存，但最新资料读取失败。请重新读取，无需重复保存。",
          );
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
      lock.current = false;
      if (alive.current) setPending(false);
    }
  }
  return (
    <HomeworkContext.Provider value={{ generation, data, pending, stale, refresh, execute }}>
      {(error || notice) && (
        <div
          className={`p-notice ${error || stale ? "error" : "success"}`}
          role={error || stale ? "alert" : "status"}
        >
          <p>{error || notice}</p>
          {(error || stale) && (
            <button
              type="button"
              className="button secondary"
              disabled={pending}
              onClick={async () => {
                try {
                  await refresh();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "读取失败，请重试。");
                }
              }}
            >
              重新读取作业资料
            </button>
          )}
        </div>
      )}
      {!data && !error && <p role="status">正在读取作业资料…</p>}
      {data && children}
    </HomeworkContext.Provider>
  );
}
export function useHomework() {
  const value = useContext(HomeworkContext);
  if (!value) throw new Error("缺少作业上下文。");
  return value;
}
