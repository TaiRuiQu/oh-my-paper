"use client";

import { useId, useState, type ChangeEvent, type ReactNode } from "react";
import type { QuestionSearchMode } from "@/contracts/platform-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import styles from "./question-search-controls.module.css";

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
  const semantic = mode === "semantic";
  const fieldProps = {
    "aria-label": "搜索试题",
    "aria-describedby": hintId,
    placeholder: semantic ? "描述要查找的题意或知识点" : "搜索题干或知识点",
    maxLength: 200,
    value: draft,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(event.target.value);
      if (mode === "keyword" || !event.target.value.trim()) onSearch(event.target.value, mode);
    },
  };
  const modeSelect = (
    <QuestionSearchModeSelect
      value={mode}
      onChange={(next) => onSearch(next === "semantic" ? "" : draft, next)}
    />
  );
  const searchButton = (
    <Button type="submit" variant="outline" disabled={semantic && !draft.trim()}>
      搜索
    </Button>
  );
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
        {semantic ? (
          <>
            <div className={styles.filters}>
              {modeSelect}
              {children}
            </div>
            <div className={styles.query}>
              <Textarea {...fieldProps} rows={4} />
              {searchButton}
            </div>
          </>
        ) : (
          <>
            {modeSelect}
            <Input {...fieldProps} />
            {searchButton}
            {children}
          </>
        )}
      </form>
      <p id={hintId} className={compact ? "p-muted" : "p-panel-content p-muted"}>
        {mode === "semantic"
          ? "描述题意后点击搜索，结果按语义相关度排列。"
          : "匹配题干文字或知识点，结果按加入时间从新到旧排列。"}
      </p>
    </div>
  );
}
