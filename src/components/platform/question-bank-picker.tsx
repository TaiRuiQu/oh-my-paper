"use client";
import { useEffect, useState } from "react";
import type { BankQuestion } from "@/contracts/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { MarkdownText } from "@/components/markdown-text";
import { QUESTION_LABELS } from "./questions";
export function useQuestionPage(
  filters: { q?: string; subject?: string; grade?: string; type?: string },
  page: number,
) {
  const [data, setData] = useState<{ questions: BankQuestion[]; total: number }>({
    questions: [],
    total: 0,
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const query = new URLSearchParams({ ...filters, page: String(page) }).toString();
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/platform/questions?${query}`, {
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "题库加载失败");
        setData(result);
      } catch (err) {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "题库加载失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return { ...data, loading, error };
}
export function useBankQuestion(id?: string) {
  const [data, setData] = useState<{ question?: BankQuestion; loading: boolean; error?: string }>({
    loading: !!id,
  });
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    fetch(`/api/platform/questions?id=${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "试题加载失败");
        setData({ question: result.question, loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setData({ loading: false, error: error.message });
      });
    return () => controller.abort();
  }, [id]);
  return data;
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
          <SheetDescription>按加入时间从新到旧排列，每页 20 题。</SheetDescription>
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
    [page, setPage] = useState(1);
  const { questions, total, loading, error } = useQuestionPage({ subject, q }, page);
  return (
    <div className="p-bank-results">
      <Input
        autoFocus
        aria-label="搜索题库"
        placeholder="搜索题干或完整知识点"
        value={q}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(1);
        }}
      />
      <p className="p-muted" role="status">
        {loading ? "正在查询…" : `${total} 道题 · 第 ${page} 页`}
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="p-bank-results-list" aria-busy={loading}>
        {questions.map((question) => (
          <article className="p-bank-item" key={question.id}>
            <small>
              {question.grade} · {QUESTION_LABELS[question.type]} ·{" "}
              {new Date(question.createdAt).toLocaleDateString("zh-CN")}
            </small>
            <MarkdownText text={question.content.stem} />
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
        {!loading && !questions.length && <p>没有匹配的题目。</p>}
      </div>
      <div className="p-actions">
        <Button
          type="button"
          variant="outline"
          disabled={loading || page === 1}
          onClick={() => setPage(page - 1)}
        >
          上一页
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={loading || page * 20 >= total}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
