export type AgentEvent = {
  sequence: number;
  at: string;
  type:
    | "started"
    | "step"
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
