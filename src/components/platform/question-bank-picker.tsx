"use client";
import { useEffect, useState } from "react";
import type { BankQuestion } from "@/contracts/platform";
import type {
  QuestionSearchFilters,
  QuestionSearchMode,
  QuestionSearchResults,
} from "@/contracts/platform-search";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { MarkdownText } from "@/components/markdown-text";
import { QUESTION_LABELS } from "./questions";
import { QuestionSearchControls } from "./question-search-controls";
import { QuestionMaterialSummary } from "./question-materials";
export function useQuestionPage(filters: QuestionSearchFilters, page: number) {
  const [data, setData] = useState<
    Partial<QuestionSearchResults> & {
      questions: BankQuestion[];
      total: number;
      key?: string;
      error?: string;
    }
  >({
    questions: [],
    total: 0,
  });
  const [attempt, setAttempt] = useState(0);
  const query = new URLSearchParams(
    Object.entries({ ...filters, page: String(page) }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  ).toString();
  const key = `${query}:${attempt}`;
  const idle = filters.searchMode === "semantic" && !filters.q?.trim();
  useEffect(() => {
    if (idle) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/platform/questions?${query}`, {
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "题库加载失败");
        if (!controller.signal.aborted) setData({ ...result, key });
      } catch (err) {
        if (!controller.signal.aborted)
          setData({
            key,
            questions: [],
            total: 0,
            error: err instanceof Error ? err.message : "题库加载失败",
          });
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, key, idle]);
  const current = !idle && data.key === key;
  return {
    questions: current ? data.questions : [],
    total: current ? data.total : 0,
    indexedTotal: current ? data.indexedTotal : undefined,
    warning: current ? data.warning : undefined,
    loading: !idle && !current,
    error: current ? (data.error ?? "") : "",
    idle,
    retry: () => setAttempt((value) => value + 1),
  };
}
export function useBankQuestion(id?: string) {
  const [attempt, setAttempt] = useState(0);
  const key = `${id ?? ""}:${attempt}`;
  const [data, setData] = useState<{
    key?: string;
    question?: BankQuestion;
    error?: string;
    status?: number;
  }>({});
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    fetch(`/api/platform/questions?id=${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setData({ key, status: response.status, error: result.error ?? "试题加载失败" });
          return;
        }
        setData({ key, question: result.question });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setData({ key, error: error instanceof Error ? error.message : "试题加载失败" });
      });
    return () => controller.abort();
  }, [id, key]);
  const current = !!id && data.key === key;
  return {
    question: current ? data.question : undefined,
    loading: !!id && !current,
    error: current ? data.error : undefined,
    status: current ? data.status : undefined,
    retry: () => setAttempt((value) => value + 1),
  };
}
export function QuestionBankPicker({
  open,
  onOpenChange,
  subject,
  usedIds,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: string;
  usedIds: string[];
  onImport: (q: BankQuestion) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="p-bank-picker" side="right">
        <SheetHeader>
          <SheetTitle>从题库导入一道题目</SheetTitle>
          <SheetDescription>用关键词或题意查找试题，每页 20 题。</SheetDescription>
        </SheetHeader>
        {open && (
          <BankResults
            subject={subject}
            usedIds={usedIds}
            onImport={(q) => {
              onImport(q);
              onOpenChange(false);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
function BankResults({
  subject,
  usedIds,
  onImport,
}: {
  subject: string;
  usedIds: string[];
  onImport: (q: BankQuestion) => void;
}) {
  const [q, setQuery] = useState(""),
    [searchMode, setSearchMode] = useState<QuestionSearchMode>("keyword"),
    [page, setPage] = useState(1);
  const { questions, total, loading, error, idle, warning, retry } = useQuestionPage(
    { subject, q, searchMode },
    page,
  );
  return (
    <div className="p-bank-results">
      <QuestionSearchControls
        compact
        query={q}
        mode={searchMode}
        onSearch={(query, mode) => {
          setQuery(query);
          setSearchMode(mode);
          setPage(1);
        }}
      />
      <p className="p-muted" role="status">
        {idle ? "输入题意后开始搜索。" : loading ? "正在查询…" : `${total} 道题 · 第 ${page} 页`}
      </p>
      {warning && <p className="p-notice">{warning}</p>}
      {error && (
        <div className="p-notice error" role="alert">
          <p>{error}</p>
          <Button type="button" variant="outline" onClick={retry}>
            重新查询
          </Button>
        </div>
      )}
      <div className="p-bank-results-list" aria-busy={loading}>
        {questions.map((question) => (
          <article className="p-bank-item" key={question.id}>
            <small>
              {question.grade} · {QUESTION_LABELS[question.type]} ·{" "}
              {new Date(question.createdAt).toLocaleDateString("zh-CN")}
            </small>
            <MarkdownText text={question.content.stem} imageHref={`/questions/${question.id}`} />
            <QuestionMaterialSummary
              images={question.content.images}
              detailHref={`/questions/${question.id}`}
            />
            <Button
              type="button"
              variant="outline"
              disabled={loading || usedIds.includes(question.id)}
              onClick={() => onImport(structuredClone(question))}
            >
              {usedIds.includes(question.id) ? "已加入" : "导入本题"}
            </Button>
          </article>
        ))}
        {!idle && !loading && !error && !questions.length && (
          <p>没有匹配的题目，请调整描述或筛选条件。</p>
        )}
      </div>
      <div className="p-actions">
        <Button
          type="button"
          variant="outline"
          disabled={idle || !!error || loading || page === 1}
          onClick={() => setPage(page - 1)}
        >
          上一页
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={idle || !!error || loading || page * 20 >= total}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
