# AI module boundary

`providers.ts` builds configurable Responses, Chat Completions, Anthropic and Google adapters. Credentials are encrypted, omitted from client responses and snapshotted at submission. Provider concurrency limits apply to recognition, solutions and grading.

`agent.ts` runs recognition with AI SDK `ToolLoopAgent`. The SDK owns tool choice and iteration. Actual public messages and tool lifecycle events are persisted; private reasoning and provider exceptions are excluded. The SDK generate method avoids gateway stream interruptions; tool lifecycle callbacks still update the activity feed live.

`deepseek.ts` retains structured generation for the existing solutions/grading services. Recognition uses the dedicated agent method and native Markdown/LaTeX tool schemas. Admin settings select `recognition`, `solution` and `grading`; legacy stage keys remain readable for snapshots and defaults.
