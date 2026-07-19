# OpenClaw integration

> Evidence status: Confirmed from code unless otherwise marked.


AI support is implemented through the Company Assistant module in `src/modules/assistant` with persistent chat, runs, retrieved sources, knowledge documents/chunks, memory, mailbox sync state, and automations in `prisma/schema.prisma`. External model execution is centralized in `src/server/integrations/assistant-provider.ts`; OpenAI and local LLM are supported provider kinds.

## Operating model

OpenClaw coordinates workflows and interprets employee intent. Newl Apps performs authentication, permission checks, validation, approvals, and audit logging. Deterministic code performs exact comparisons, calculations, Teamship field updates, and printing. Codex changes code only through branches and reviewed pull requests. OpenClaw must not freely improvise production actions through arbitrary browser clicking.

Approved data sources: this repository documentation, authenticated app APIs, tenant-scoped database queries through app code, approved employee feedback after confirmation, and live tools for current operational data. Prohibited tools: production write browser automation without approval, direct database writes, secrets extraction, unreviewed customer communications, financial posting, printing, Teamship writes, and deployment.

## Tests and gaps

Tests named `tests/assistant-*.test.ts`, `tests/openai-integration.test.ts`, and `tests/assistant-provider.test.ts` cover deterministic runtime, provider parsing, automations, knowledge, Microsoft sync, and module workflows. Missing coverage requiring confirmation includes employee-facing factuality evaluations, cost budgets, latency SLOs, and approved tool allowlists per tenant.
