# Grading module boundary

`service.ts` runs independent reference solving/verification and question-level grading against immutable exam/answer snapshots. Solver inputs omit all student answers and annotations. Model-generated references remain provisional. `score.ts` validates criterion sums, bounds and verdict consistency, aggregates in integer cents, and preserves manual reviews. `tasks.ts` authorizes report ownership, enqueues transactionally and checkpoints each completed question for worker recovery. Exports contain validated scores and separate suggestions.

The five provider prompt presets use stable shared prefixes and record API-reported cache usage. Details, limits and live-test commands: [AI grading](../../../docs/ai-grading.md).
