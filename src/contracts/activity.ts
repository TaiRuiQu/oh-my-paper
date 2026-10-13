export type AgentTimingRequest = {
  /** 发送请求到收到响应头的时间。 */
  ttfbMs: number;
  /** 响应头之后接收响应体的时间。 */
  bodyMs: number;
  /** HTTP 状态码，请求失败（网络错误等）时为 0。 */
  status: number;
  failed: boolean;
};
export type AgentTiming = {
  requests: AgentTimingRequest[];
  inputTokens: number;
  outputTokens: number;
  outputTokensPerSecond: number;
};
export type AgentEvent = {
  sequence: number;
  at: string;
  type:
    | "started"
    | "step"
    | "timing"
    | "message"
    | "tool_call"
    | "tool_result"
    | "tool_error"
    | "completed"
    | "failed";
  step?: number;
  callId?: string;
  tool?: string;
  text?: string;
  data?: unknown;
  durationMs?: number;
};
export type AgentEventInput = Omit<AgentEvent, "sequence" | "at">;
export type RecognitionActivity = {
  attempt: string | null;
  events: AgentEvent[];
  cursor: number;
  active: boolean;
};
