"use client";

import { useId, useState, type ReactNode } from "react";
import type { QuestionSearchMode } from "@/contracts/platform-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function QuestionSearchModeSelect({
  value,
  onChange,
}: {
  value: QuestionSearchMode;
  onChange: (value: QuestionSearchMode) => void;
}) {
  return (
    <select
      aria-label="搜索方式"
      value={value}
      onChange={(event) => onChange(event.target.value as QuestionSearchMode)}
    >
      <option value="keyword">关键词搜索</option>
      <option value="semantic">语义搜索</option>
    </select>
  );
}

export function QuestionSearchControls({
  query,
  mode,
  onSearch,
  children,
  compact = false,
}: {
  query: string;
  mode: QuestionSearchMode;
  onSearch: (query: string, mode: QuestionSearchMode) => void;
  children?: ReactNode;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(query);
  const hintId = useId();
  return (
    <div>
      <form
        role="search"
        aria-label="搜索题库"
        className={compact ? "p-actions" : "p-toolbar p-toolbar-wrap"}
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSearch(draft, mode);
        }}
      >
        <QuestionSearchModeSelect
          value={mode}
          onChange={(next) => onSearch(next === "semantic" ? "" : draft, next)}
        />
        <Input
          aria-label="搜索试题"
          aria-describedby={hintId}
          placeholder={mode === "semantic" ? "描述要查找的题意或知识点" : "搜索题干或知识点"}
          maxLength={200}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (mode === "keyword" || !event.target.value.trim())
              onSearch(event.target.value, mode);
          }}
        />
        <Button type="submit" variant="outline" disabled={mode === "semantic" && !draft.trim()}>
          搜索
        </Button>
        {children}
      </form>
      <p id={hintId} className={compact ? "p-muted" : "p-panel-content p-muted"}>
        {mode === "semantic"
          ? "描述题意后点击搜索，结果按语义相关度排列。"
          : "匹配题干文字或知识点，结果按加入时间从新到旧排列。"}
      </p>
    </div>
  );
}
