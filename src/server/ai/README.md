# AI module boundary

`providers.ts` builds configurable Responses, Chat Completions, Anthropic and Google adapters. `settings.ts` stores administrator-managed profiles and task defaults. Credentials are AES-256-GCM encrypted, omitted from client responses, and snapshotted for submitted jobs. The existing `deepseek.ts` CLI adapter remains available. All adapters validate output, cap calls, support cancellation and repair malformed JSON at most once.

Exam prompt presets retain common domain constraints in a stable prefix. Anthropic marks this prefix for caching; API-reported cache read/write token usage is retained. See [configuration and official sources](../../../docs/ai-providers-and-prompts.md).
