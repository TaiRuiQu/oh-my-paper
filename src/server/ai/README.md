# AI module boundary

`providers.ts` builds configurable Responses, Chat Completions, Anthropic and Google adapters. `settings.ts` stores administrator-managed profiles and task defaults. Credentials are AES-256-GCM encrypted, omitted from client responses, and snapshotted for submitted jobs. The existing `deepseek.ts` CLI adapter remains available. All adapters validate output, cap calls, support cancellation and repair malformed JSON at most once.

Each of the six pipeline stages can select its own provider/model configuration. Prompt presets retain common evidence rules in a stable prefix followed by the current stage and schema; Anthropic marks the end of that stage/schema system block for caching. API-reported cache read/write token usage is retained. See [stage configuration and prompts](../../../docs/ai-providers-and-prompts.md).
