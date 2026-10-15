"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { AccountCredentials } from "@/contracts/auth";
import type { ScanUploadPage } from "@/contracts/uploads";
import type { PlatformCommand, PlatformState } from "@/contracts/platform";
import type { PlatformArea } from "@/contracts/navigation";
import { apiRequest, jsonBody } from "@/lib/http-client";

type DomainContext = {
  state: PlatformState;
  area: PlatformArea;
  pending: boolean;
  mutate: (
    command: PlatformCommand,
  ) => Promise<{ id?: string; error?: string; credentials?: AccountCredentials }>;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  scanFiles: ScanUploadPage[];
  setScanFiles: Dispatch<SetStateAction<ScanUploadPage[]>>;
};
const Context = createContext<DomainContext | null>(null);
const commandDomains: Record<string, string> = {
  question: "questions",
  paper: "papers",
  classroom: "classrooms",
  student: "classrooms",
  assessment: "assessments",
  template: "templates",
  submission: "submissions",
  review: "reviews",
};

export function DomainProvider({
  initialState,
  area,
  children,
}: {
  initialState: PlatformState;
  area: PlatformArea;
  children: ReactNode;
}) {
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState(false);
  const [scanFiles, setScanFiles] = useState<ScanUploadPage[]>([]);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const notify = useCallback((text: string, error?: boolean) => setNotice({ text, error }), []);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timeout = setTimeout(() => setNotice(undefined), 4000);
    return () => clearTimeout(timeout);
  }, [notice]);
  const refresh = useCallback(async () => {
    setState(
      await apiRequest<PlatformState>(
        `/api/platform/${area}/state${initialState.reviewing ? "?scope=reviewing" : ""}`,
      ),
    );
  }, [area, initialState.reviewing]);
  const mutate = useCallback(
    async (command: PlatformCommand) => {
      setPending(true);
      try {
        const domain = commandDomains[command.type.split(".")[0]];
        const result = await apiRequest<{ id: string; credentials?: AccountCredentials }>(
          `/api/platform/${domain}/commands`,
          {
            method: "POST",
            ...jsonBody(command),
          },
        );
        await refresh();
        notify("已保存。");
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "保存失败，请重试。";
        notify(message, true);
        return { error: message };
      } finally {
        setPending(false);
      }
    },
    [refresh, notify],
  );
  return (
    <Context.Provider
      value={{ state, area, pending, mutate, refresh, notify, scanFiles, setScanFiles }}
    >
      {notice &&
        createPortal(
          <div
            className={`p-notice p-operation-notice ${notice.error ? "error" : "success"}`}
            role={notice.error ? "alert" : "status"}
          >
            <span>{notice.text}</span>
            <button
              type="button"
              className="p-notice-close"
              aria-label="关闭操作提示"
              onClick={() => setNotice(undefined)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>,
          document.body,
        )}
      {children}
    </Context.Provider>
  );
}

export function useDomain() {
  const context = useContext(Context);
  if (!context) throw new Error("页面缺少业务数据上下文。");
  return context;
}

export function useOptionalDomain() {
  return useContext(Context);
}
