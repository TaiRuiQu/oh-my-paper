export type UsageTotals = {
  credits: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  calls: number;
};
export type UsageDashboard = {
  totals: UsageTotals;
  users: (UsageTotals & { id: string; name: string; balance: string; unlimited?: boolean })[];
  models: (UsageTotals & { id: string; name: string; provider: string; apiModel?: string })[];
};
