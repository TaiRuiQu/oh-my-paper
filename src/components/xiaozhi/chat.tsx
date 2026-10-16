"use client";
/* Authenticated attachment previews use the original asset URLs. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  FileText,
  House,
  Menu,
  MoreHorizontal,
  Origami,
  PanelLeftClose,
  Paperclip,
  Plus,
  Search,
  SlidersHorizontal,
  Square,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import type { PlatformState } from "@/contracts/platform";
import type {
  XiaozhiConversation,
  XiaozhiConversationSummary,
  XiaozhiMessage,
  XiaozhiPart,
  XiaozhiSkill,
} from "@/contracts/xiaozhi";
import { MarkdownText } from "@/components/markdown-text";
import { SignOutButton } from "@/components/sign-out-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SkillsPanel } from "./skills-panel";
import { groupXiaozhiMessages, splitXiaozhiReply } from "@/lib/xiaozhi-transcript";

type HomeData = {
  conversations: XiaozhiConversationSummary[];
  models: { id: string; name: string }[];
  skills: XiaozhiSkill[];
};
type Attachment = { url: string; name: string; mediaType: string };
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "操作未完成，请重试。");
  return body as T;
}
const toolNames: Record<string, string> = {
  describe_api: "了解操作参数",
  website_request: "操作教学平台",
  list_skills: "查找技能",
  read_skill: "加载技能",
  read_skill_resource: "查阅技能资料",
  view_image: "查看材料",
  sandbox: "处理附件与计算",
  wait_for_task: "等待任务完成",
};
const operationLabels: Record<string, string> = {
  "question.save": "保存题目",
  "question.delete": "删除题目",
  "paper.save": "保存题本",
  "paper.delete": "删除题本",
  "paper.rename": "重命名题本",
  "classroom.save": "保存班级",
  "student.save": "保存学生",
  "student.delete": "移除学生",
  "assessment.save": "保存作业或考试",
  "assessment.publish": "更新成绩发布状态",
  "assessment.rename": "重命名教学安排",
  "template.save": "保存答题卡",
  "template.delete": "删除答题卡",
  "submission.save": "录入作答",
  "review.save": "保存评阅",
  "user.create": "创建账号",
  "user.permissions": "配置教学权限",
  "user.role": "调整账号角色",
  "provider.save": "保存模型配置",
  "provider.delete": "删除模型供应商",
  IMPORT: "识别材料",
  ENRICH: "补全题目",
  ASSEMBLE: "自主组卷",
  TEMPLATE: "制作答题卡",
  GRADE: "批改作答",
  RECOMMEND: "推荐练习",
  CONSOLIDATE: "错题巩固",
  LESSON_PREPARE: "生成候选教案",
  PRACTICE_GRADE: "练习反馈候选",
};
function readable(value: unknown) {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}
function MessagePart({ part }: { part: XiaozhiPart }) {
  if (part.type === "text") return <MarkdownText text={part.text} />;
  if (part.type === "file") {
    if (["image/png", "image/jpeg", "image/webp"].includes(part.mediaType))
      return <MessagePart part={{ type: "image", url: part.url, name: part.name }} />;
    return (
      <a className="xz-message-file" href={part.url} target="_blank" rel="noreferrer">
        <FileText size={17} aria-hidden="true" />
        {part.name ?? "附件"}
      </a>
    );
  }
  if (part.type === "image")
    return (
      <a className="xz-message-image" href={part.url} target="_blank" rel="noreferrer">
        <img src={part.url} alt={part.name ?? "附件"} loading="lazy" />
      </a>
    );
  if (part.type === "thinking")
    return (
      <div className="xz-thinking">
        <MarkdownText text={part.text} />
      </div>
    );
  const input = part.input as
    | {
        method?: string;
        path?: string;
        operation?: string;
        id?: string;
        body?: { type?: string; kind?: string };
      }
    | undefined;
  return (
    <details className="xz-tool">
      <summary>
        <span className={`xz-tool-state ${part.state}`} aria-hidden="true">
          {part.state === "completed" ? (
            <Check size={14} />
          ) : part.state === "failed" ? (
            <CircleAlert size={14} />
          ) : (
            <span className="xz-working-dot" />
          )}
        </span>
        <span>{toolNames[part.name] ?? part.name}</span>
        <span className="xz-tool-caption">
          {operationLabels[input?.operation ?? input?.body?.type ?? input?.body?.kind ?? ""] ?? ""}
        </span>
        <ChevronDown size={13} />
        <span className="sr-only">
          {part.state === "completed" ? "已完成" : part.state === "failed" ? "失败" : "正在执行"}
        </span>
      </summary>
      <div className="xz-tool-details">
        <p>操作参数</p>
        <pre>{readable(part.input)}</pre>
        {part.output !== undefined && (
          <>
            <p>执行结果</p>
            <pre>{readable(part.output)}</pre>
          </>
        )}
      </div>
    </details>
  );
}
function ChatMessage({
  messages,
  running = false,
}: {
  messages: XiaozhiMessage[];
  running?: boolean;
}) {
  const message = messages[0];
  const { reply, process } =
    message.role === "assistant"
      ? splitXiaozhiReply(messages)
      : { reply: message.parts, process: [] };
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const text = reply
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  return (
    <article
      className={`xz-message xz-message-${message.role}`}
      aria-label={message.role === "user" ? "你的消息" : "小纸的回复"}
    >
      {message.role === "assistant" && (
        <div className="xz-message-avatar">
          <Origami size={22} aria-hidden="true" />
        </div>
      )}
      <div className="xz-message-content">
        {process.length > 0 && (
          <details className="xz-execution">
            <summary>
              <ChevronDown size={14} aria-hidden="true" />
              {running ? "正在处理" : "查看执行过程"}
            </summary>
            <div className="xz-execution-content">
              {process.map((part, index) => (
                <MessagePart key={part.type === "tool" ? part.id : index} part={part} />
              ))}
            </div>
          </details>
        )}
        {reply.map((part, index) => (
          <MessagePart key={part.type === "tool" ? part.id : index} part={part} />
        ))}
        {message.role === "assistant" && text && !running && (
          <button
            className="xz-icon-button xz-copy"
            aria-label={copied ? "已复制回复" : "复制回复"}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                timer.current = setTimeout(() => setCopied(false), 1800);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        )}
      </div>
    </article>
  );
}

export function XiaozhiClient({
  actor,
  initialId,
  initialData,
}: {
  actor: PlatformState["actor"];
  initialId: string | null;
  initialData: HomeData;
}) {
  const [data, setData] = useState(initialData);
  const [activeId, setActiveId] = useState(initialId);
  const activeRef = useRef(activeId);
  const [chat, setChat] = useState<XiaozhiConversation | null>(null);
  const [draft, setDraft] = useState("");
  const [modelId, setModelId] = useState(initialData.models[0]?.id ?? "");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [desktopSidebar, setDesktopSidebar] = useState(true);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"steer" | "followUp">("steer");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const running = !!chat && ["QUEUED", "RUNNING"].includes(chat.status);
  const loading = !!activeId && chat?.id !== activeId && !error;
  const messages = chat?.view.messages ?? [];
  const completedReply =
    !running && !loading
      ? messages
          .findLast(
            (message) =>
              message.role === "assistant" && message.parts.some((part) => part.type === "text"),
          )
          ?.parts.filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
      : undefined;
  const hasMessages = messages.length > 0 || !!chat?.pending.length;
  const reload = useCallback(async () => {
    setData(await api<HomeData>("/api/xiaozhi"));
  }, []);
  const choose = useCallback((id: string | null) => {
    activeRef.current = id;
    setActiveId(id);
    setChat(null);
    setError("");
    setSidebar(false);
    setDeleteConfirm(false);
    nearBottom.current = true;
    window.history.pushState({}, "", id ? `/xiaozhi?chat=${encodeURIComponent(id)}` : "/xiaozhi");
  }, []);
  useEffect(() => {
    const back = () => {
      const id = new URL(window.location.href).searchParams.get("chat");
      activeRef.current = id;
      setActiveId(id);
      setChat(null);
      setError("");
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  useEffect(() => {
    if (!activeId) return;
    let disposed = false;
    const source = new EventSource(`/api/xiaozhi/${encodeURIComponent(activeId)}/events`);
    const receive = (event: MessageEvent) => {
      if (disposed) return;
      const next = JSON.parse(event.data) as XiaozhiConversation;
      setChat(next);
      setConnection(false);
      if (next.modelId) setModelId(next.modelId);
      setSkillIds(next.skillIds);
      setData((current) => ({
        ...current,
        conversations: [
          {
            id: next.id,
            title: next.title,
            modelId: next.modelId,
            skillIds: next.skillIds,
            updatedAt: next.updatedAt,
          },
          ...current.conversations.filter((item) => item.id !== next.id),
        ],
      }));
    };
    source.addEventListener("snapshot", receive);
    source.onerror = () => {
      if (disposed) return;
      setConnection(true);
      void api<XiaozhiConversation>(`/api/xiaozhi/${encodeURIComponent(activeId)}`)
        .then((next) => {
          if (!disposed) {
            setChat(next);
          }
        })
        .catch((cause: Error) => {
          if (!disposed) {
            setError(cause.message);
          }
        });
    };
    return () => {
      disposed = true;
      source.close();
    };
  }, [activeId]);
  useEffect(() => {
    if (nearBottom.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [chat]);
  const updateSettings = async (settings: { modelId?: string; skillIds?: string[] }) => {
    setError("");
    try {
      if (activeId)
        await api(`/api/xiaozhi/${activeId}`, { method: "PATCH", body: JSON.stringify(settings) });
      if (settings.modelId) setModelId(settings.modelId);
      if (settings.skillIds) setSkillIds(settings.skillIds);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (sending || uploading || !modelId || (!draft.trim() && !attachments.length) || loading)
      return;
    setSending(true);
    setError("");
    const originalId = activeId;
    try {
      let id = activeId;
      if (!id) {
        const created = await api<XiaozhiConversation>("/api/xiaozhi", {
          method: "POST",
          body: JSON.stringify({ modelId, skillIds }),
        });
        id = created.id;
        activeRef.current = id;
        setActiveId(id);
        setChat(created);
        window.history.replaceState({}, "", `/xiaozhi?chat=${id}`);
      }
      const message = {
        id: crypto.randomUUID(),
        role: "user" as const,
        parts: [
          ...(draft.trim() ? [{ type: "text" as const, text: draft }] : []),
          ...attachments.map((file) => ({
            type: "file" as const,
            mediaType: file.mediaType,
            url: file.url,
            filename: file.name,
          })),
        ],
      };
      await api(`/api/xiaozhi/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message, mode }),
      });
      if (activeRef.current === originalId || activeRef.current === id) {
        setDraft("");
        setAttachments([]);
        nearBottom.current = true;
        if (textarea.current) textarea.current.style.height = "auto";
        setChat((current) =>
          current?.id === id
            ? {
                ...current,
                status: "QUEUED",
                pending: [...current.pending, { id: message.id, message, mode }],
              }
            : current,
        );
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSending(false);
    }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length || uploading) return;
    setUploading(true);
    setError("");
    try {
      let count = attachments.length;
      for (const file of Array.from(files)) {
        if (count >= 20) throw new Error("每条消息最多添加 20 个附件，请分批发送。");
        if (file.size > 30000000) throw new Error("每个附件不能超过 30 MB。");
        const form = new FormData();
        form.set("file", file);
        const result = await api<Attachment>("/api/xiaozhi/attachments", {
          method: "POST",
          body: form,
        });
        count++;
        setAttachments((current) => [...current, result]);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const sidebarContent = (
    <>
      <div className="xz-sidebar-brand">
        <Link
          href="/xiaozhi"
          onClick={(event) => {
            event.preventDefault();
            choose(null);
          }}
        >
          <Origami size={26} />
          <span>
            小纸<small>Oh My Paper</small>
          </span>
        </Link>
        <button
          className="xz-icon-button"
          aria-label="收起会话侧栏"
          onClick={() => {
            setDesktopSidebar(false);
            setSidebar(false);
          }}
        >
          <PanelLeftClose size={19} />
        </button>
      </div>
      <button
        className="xz-new-chat"
        onClick={() => {
          choose(null);
          setDraft("");
          setAttachments([]);
          textarea.current?.focus();
        }}
      >
        <SquarePen size={18} />
        新对话
        <Plus size={16} />
      </button>
      <div className="xz-sidebar-links">
        <button onClick={() => setSearching((value) => !value)}>
          <Search size={17} />
          搜索对话
        </button>
        <button onClick={() => setSkillsOpen(true)}>
          <SlidersHorizontal size={17} />
          技能库<span>{data.skills.length}</span>
        </button>
        <Link href="/workspace">
          <House size={17} />
          教学工作台
          <ArrowUpRight size={14} />
        </Link>
      </div>
      {searching && (
        <div className="xz-search">
          <input
            aria-label="搜索历史对话"
            placeholder="搜索对话标题"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoFocus
          />
        </div>
      )}
      <div className="xz-recents-label">最近对话</div>
      <nav className="xz-history" aria-label="历史对话">
        {data.conversations
          .filter((item) => item.title.toLowerCase().includes(search.toLowerCase()))
          .map((item) => (
            <button
              key={item.id}
              className={item.id === activeId ? "active" : ""}
              aria-current={item.id === activeId ? "page" : undefined}
              onClick={() => choose(item.id)}
              title={item.title}
            >
              {item.title}
            </button>
          ))}
        {!data.conversations.length && (
          <p>
            从一个问题开始，
            <br />
            之后可以在这里继续。
          </p>
        )}
        {data.conversations.length > 0 &&
          !data.conversations.some((item) =>
            item.title.toLowerCase().includes(search.toLowerCase()),
          ) && <p>没有找到相关对话。</p>}
      </nav>
      <div className="xz-sidebar-footer">
        <span className="xz-user-avatar">{actor.name.slice(0, 1)}</span>
        <span className="xz-user-name">
          {actor.name}
          <small>{{ ADMIN: "管理员", TEACHER: "教师", STUDENT: "学生" }[actor.role]}</small>
        </span>
        <SignOutButton />
      </div>
    </>
  );
  const suggestions =
    actor.role === "STUDENT"
      ? ["帮我看看最近的薄弱知识点", "整理我的错题，安排一次复习", "这道题可以怎么理解？"]
      : ["帮我准备一份练习", "看看班里的薄弱知识点", "把这份试卷录入题库"];
  return (
    <div className={`xz-app${desktopSidebar ? "" : " xz-sidebar-collapsed"}`}>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {completedReply ? `小纸回复：${completedReply}` : ""}
      </div>
      {desktopSidebar && <aside className="xz-sidebar xz-desktop-sidebar">{sidebarContent}</aside>}
      <Sheet open={sidebar} onOpenChange={setSidebar}>
        <SheetContent side="left" className="xz-mobile-sidebar">
          <SheetHeader className="sr-only">
            <SheetTitle>小纸会话导航</SheetTitle>
            <SheetDescription>新建和查找对话，访问技能库与教学工作台。</SheetDescription>
          </SheetHeader>
          {sidebarContent}
        </SheetContent>
      </Sheet>
      <main className="xz-main" id="main">
        <header className="xz-header">
          <div className="xz-header-left">
            <button
              className={`xz-icon-button ${desktopSidebar ? "xz-mobile-toggle" : ""}`}
              aria-label="打开会话侧栏"
              onClick={() => {
                if (window.matchMedia("(max-width: 760px)").matches) setSidebar(true);
                else setDesktopSidebar(true);
              }}
            >
              <Menu size={21} />
            </button>
            <span className="xz-header-name">
              小纸
              <ChevronDown size={14} aria-hidden="true" />
            </span>
            <span className="xz-header-description">你的教学助手</span>
          </div>
          <div className="xz-header-actions">
            <Link href="/workspace" className="xz-workspace-link">
              教学工作台
              <ArrowUpRight size={14} />
            </Link>
            {activeId && (
              <details className="xz-chat-menu">
                <summary className="xz-icon-button" aria-label="对话操作">
                  <MoreHorizontal size={21} />
                </summary>
                <div>
                  <button
                    onClick={async () => {
                      const title = window.prompt("对话名称", chat?.title);
                      if (!title?.trim()) return;
                      try {
                        await api(`/api/xiaozhi/${activeId}`, {
                          method: "PATCH",
                          body: JSON.stringify({ title }),
                        });
                        await reload();
                      } catch (cause) {
                        setError((cause as Error).message);
                      }
                    }}
                  >
                    重命名对话
                  </button>
                  <button
                    disabled={running}
                    className="xz-danger"
                    onClick={async () => {
                      if (!deleteConfirm) {
                        setDeleteConfirm(true);
                        return;
                      }
                      try {
                        await api(`/api/xiaozhi/${activeId}`, { method: "DELETE" });
                        choose(null);
                        await reload();
                      } catch (cause) {
                        setError((cause as Error).message);
                      }
                    }}
                  >
                    <Trash2 size={14} />
                    {deleteConfirm ? "确认删除这段对话" : "删除对话"}
                  </button>
                </div>
              </details>
            )}
          </div>
        </header>
        <div
          ref={scroll}
          className={`xz-conversation${hasMessages ? "" : " xz-conversation-empty"}`}
          onScroll={() => {
            if (scroll.current)
              nearBottom.current =
                scroll.current.scrollHeight -
                  scroll.current.scrollTop -
                  scroll.current.clientHeight <
                2;
          }}
          onWheel={(event) => {
            if (event.deltaY < 0) nearBottom.current = false;
          }}
          onTouchStart={() => {
            nearBottom.current = false;
          }}
          onPointerDown={() => {
            nearBottom.current = false;
          }}
        >
          {loading ? (
            <div className="xz-chat-loading" role="status">
              <span />
              <span />
              <span />
              <p>正在打开对话…</p>
            </div>
          ) : !hasMessages ? (
            <div className="xz-welcome">
              <Origami size={43} strokeWidth={1.3} aria-hidden="true" />
              <h1>你好，我是小纸</h1>
              <p>
                {actor.role === "STUDENT"
                  ? "一起理清思路，让每一次练习都有收获。"
                  : "从备课到阅卷，把繁琐的事交给我。"}
              </p>
            </div>
          ) : (
            <div className="xz-transcript">
              {groupXiaozhiMessages(messages).map((group, index, groups) => (
                <ChatMessage
                  key={group.id}
                  messages={group.messages}
                  running={running && index === groups.length - 1}
                />
              ))}
              {chat?.pending
                .filter((input) => !messages.some((message) => message.id === input.id))
                .map((input) => (
                  <article className="xz-pending" key={input.id}>
                    <span>{input.mode === "steer" ? "调整当前任务" : "排队继续"}</span>
                    <p>
                      {input.message.parts
                        .filter((part) => part.type === "text")
                        .map((part) => part.text)
                        .join("\n") || "附件消息"}
                    </p>
                  </article>
                ))}
              {running && (
                <div className="xz-run-status" role="status">
                  <span className="xz-working-dot" />
                  {chat?.view.compacting
                    ? "正在整理上下文，继续处理…"
                    : chat?.view.retrying
                      ? "连接模型后将继续处理…"
                      : chat?.status === "QUEUED"
                        ? "已加入任务，等待小纸开始…"
                        : "小纸正在处理，可以继续补充要求"}
                </div>
              )}
            </div>
          )}
        </div>
        <div className={`xz-composer-dock${hasMessages ? "" : " xz-composer-welcome"}`}>
          <div className="xz-composer-width">
            {(error || chat?.error) && (
              <div className="xz-error" role="alert">
                <CircleAlert size={17} />
                <span>{error || chat?.error}</span>
                <button
                  className="xz-icon-button"
                  aria-label="关闭错误提示"
                  onClick={() => {
                    setError("");
                    setChat((value) => (value ? { ...value, error: null } : value));
                  }}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            {connection && !error && (
              <p className="xz-connection" role="status">
                连接暂时中断，正在重连；后台任务仍会继续。
              </p>
            )}
            {!data.models.length && (
              <p className="xz-no-model">
                {actor.role === "ADMIN" ? (
                  <Link href="/admin/models">
                    接入一个 AI 模型，开始和小纸对话
                    <ArrowUpRight size={14} />
                  </Link>
                ) : (
                  "还没有可用模型，请联系管理员接入。"
                )}
              </p>
            )}
            <form className="xz-composer" onSubmit={(event) => void send(event)}>
              {attachments.length > 0 && (
                <div className="xz-attachments">
                  {attachments.map((file, index) => (
                    <div className="xz-attachment" key={`${file.url}-${index}`}>
                      <FileText size={15} />
                      <span title={file.name}>{file.name}</span>
                      <button
                        type="button"
                        className="xz-icon-button"
                        aria-label={`移除附件 ${file.name}`}
                        disabled={sending || uploading}
                        onClick={() =>
                          setAttachments((current) =>
                            current.filter((_, position) => position !== index),
                          )
                        }
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                ref={textarea}
                aria-label="给小纸发送消息"
                placeholder={running ? "补充要求，或调整正在进行的任务…" : "有什么想交给小纸的？"}
                value={draft}
                maxLength={30000}
                rows={2}
                onChange={(event) => {
                  setDraft(event.target.value);
                  event.target.style.height = "auto";
                  event.target.style.height = `${Math.min(240, event.target.scrollHeight)}px`;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="xz-composer-toolbar">
                <div className="xz-composer-tools">
                  <input
                    ref={fileInput}
                    className="sr-only"
                    type="file"
                    multiple
                    aria-label="上传附件"
                    onChange={(event) => void upload(event.target.files)}
                  />
                  <button
                    type="button"
                    className="xz-icon-button"
                    aria-label="添加附件"
                    title="添加附件"
                    disabled={uploading || sending}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Paperclip size={20} />
                  </button>
                  <button
                    type="button"
                    className={`xz-skills-button${skillIds.length ? " selected" : ""}`}
                    onClick={() => setSkillsOpen(true)}
                  >
                    <SlidersHorizontal size={16} />
                    技能{skillIds.length ? ` ${skillIds.length}` : ""}
                  </button>
                  {running && (
                    <label className="xz-mode-select xz-skills-button">
                      <span className="sr-only">补充消息的处理方式</span>
                      <select
                        aria-label="补充消息的处理方式"
                        value={mode}
                        onChange={(event) => setMode(event.target.value as typeof mode)}
                      >
                        <option value="steer">调整当前任务</option>
                        <option value="followUp">排队继续</option>
                      </select>
                      <ChevronDown size={13} aria-hidden="true" />
                    </label>
                  )}
                  {uploading && (
                    <span className="xz-upload-status" role="status">
                      正在上传附件…
                    </span>
                  )}
                </div>
                <div className="xz-composer-send">
                  <label className="xz-model-select">
                    <span className="sr-only">选择 AI 模型</span>
                    <select
                      value={modelId}
                      disabled={running || !data.models.length || sending}
                      onChange={(event) => void updateSettings({ modelId: event.target.value })}
                    >
                      {!data.models.length && <option value="">未配置模型</option>}
                      {data.models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} aria-hidden="true" />
                  </label>
                  {running && (
                    <button
                      className="xz-stop"
                      type="button"
                      aria-label="停止当前任务"
                      title="停止当前任务"
                      onClick={async () => {
                        try {
                          await api(`/api/xiaozhi/${activeId}/stop`, { method: "POST" });
                        } catch (cause) {
                          setError((cause as Error).message);
                        }
                      }}
                    >
                      <Square size={13} fill="currentColor" />
                    </button>
                  )}
                  <button
                    type="submit"
                    className="xz-send"
                    aria-label={running ? "发送补充要求" : "发送消息"}
                    disabled={
                      sending ||
                      uploading ||
                      loading ||
                      !modelId ||
                      (!draft.trim() && !attachments.length)
                    }
                  >
                    <ArrowUp size={20} />
                  </button>
                </div>
              </div>
            </form>
            {!running && !hasMessages && !loading ? (
              <div className="xz-suggestions">
                {suggestions.map((text) => (
                  <button
                    key={text}
                    onClick={() => {
                      setDraft(text);
                      textarea.current?.focus();
                    }}
                  >
                    {text}
                    <ArrowUpRight size={14} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="xz-composer-note">小纸会调用平台功能完成操作，请核对重要结果。</p>
            )}
          </div>
        </div>
      </main>
      <Sheet open={skillsOpen} onOpenChange={setSkillsOpen}>
        <SheetContent side="right" className="xz-skills-sheet">
          <SheetHeader>
            <SheetTitle>小纸的技能库</SheetTitle>
            <SheetDescription>按需选择，也可以写下你自己的工作方法。</SheetDescription>
          </SheetHeader>
          <SkillsPanel
            skills={data.skills}
            selected={skillIds}
            locked={running}
            onSelect={(ids) => updateSettings({ skillIds: ids })}
            onChanged={reload}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
