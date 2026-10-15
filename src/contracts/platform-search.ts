import type { BankQuestion } from "./platform";

export type QuestionSearchMode = "keyword" | "semantic";

export type QuestionSearchFilters = {
  q?: string;
  searchMode?: QuestionSearchMode;
  subject?: string;
  grade?: string;
  type?: string;
};

export type QuestionSearchResults = {
  questions: BankQuestion[];
  total: number;
  page: number;
  pageSize: number;
  searchMode?: QuestionSearchMode;
  indexedTotal?: number;
  warning?: string;
};

export type EmbeddingConfiguration = {
  name: string;
  apiType: "openai" | "google";
  baseURL: string;
  model: string;
  dimensions: number;
  enabled: boolean;
  hasApiKey: boolean;
  version: string;
};

export type QuestionSearchIndex = {
  total: number;
  indexed: number;
  pending: number;
  failed: number;
  enabled: boolean;
  lastError?: string;
};

export type AdminSearchConfiguration = {
  embedding: EmbeddingConfiguration | null;
  searchIndex: QuestionSearchIndex;
};
