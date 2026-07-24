# AI overview

> Evidence status: Confirmed from code unless otherwise marked.


AI support is implemented through the Company Assistant module in `src/modules/assistant` with persistent chat, runs, retrieved sources, knowledge documents/chunks, memory, mailbox sync state, and automations in `prisma/schema.prisma`. External model execution is centralized in `src/server/integrations/assistant-provider.ts`; OpenAI and local LLM are supported provider kinds.

Administrator-approved development suggestions may be handled by the separate local [Rivet approved-development worker](rivet-development-worker.md). Rivet groups similar feedback before approval, requires repository workflow context, invokes the locally authenticated Codex CLI, and may open only reviewed draft pull requests.

## Tests and gaps

Tests named `tests/assistant-*.test.ts`, `tests/openai-integration.test.ts`, and `tests/assistant-provider.test.ts` cover deterministic runtime, provider parsing, automations, knowledge, Microsoft sync, and module workflows. Missing coverage requiring confirmation includes employee-facing factuality evaluations, cost budgets, latency SLOs, and approved tool allowlists per tenant.
