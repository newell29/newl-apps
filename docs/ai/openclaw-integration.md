# OpenClaw integration

> Evidence status: Confirmed from code unless otherwise marked.


AI support is implemented through the Company Assistant module in `src/modules/assistant` with persistent chat, runs, retrieved sources, knowledge documents/chunks, memory, mailbox sync state, and automations in `prisma/schema.prisma`. External model execution is centralized in `src/server/integrations/assistant-provider.ts`; OpenAI and local LLM are supported provider kinds.

## Operating model

OpenClaw coordinates workflows and interprets employee intent. Newl Apps performs authentication, permission checks, validation, approvals, and audit logging. Deterministic code performs exact comparisons, calculations, Teamship field updates, and printing. Codex changes code only through branches and reviewed pull requests. OpenClaw must not freely improvise production actions through arbitrary browser clicking.

Approved data sources: this repository documentation, authenticated app APIs, tenant-scoped database queries through app code, approved employee feedback after confirmation, and live tools for current operational data. Prohibited tools: production write browser automation without approval, direct database writes, secrets extraction, unreviewed customer communications, financial posting, printing, Teamship writes, and deployment.

## Unresolved Teams turns

The optional `newl-unresolved-turns` OpenClaw plugin and tenant-scoped Newl Apps endpoint capture failed or unanswered Microsoft Teams turns for developer review. Successful turns are deleted; the capture does not retain model reasoning, full conversation history, tool parameters, or raw tool results. Detection, storage fields, developer discovery, privacy boundaries, and known limitations are defined in [openclaw-unresolved-turns.md](openclaw-unresolved-turns.md). The capture package does not include a scheduler.

## Garland Phase 1

The `newl-teamship` plugin also exposes identity-bound Garland tools for Teams PDF review, saved-check explanation, feedback capture, and an admin development-suggestion digest. Trusted inbound media is correlated by OpenClaw session and Teams sender; attachment paths are never model parameters. Newl Apps remains the persistence and authorization boundary.

The daily digest only groups unqueued feedback into `AWAITING_APPROVAL` suggestions. It must state that no development has started. A separate human-approved Codex task and reviewed pull request remain required for implementation.

For scheduled delivery, the plugin may use the configured administrator's Entra object ID only when the OpenClaw run has no interactive requester. Interactive calls always bind the actual Teams sender, preventing another employee from inheriting the scheduled administrator identity.

Garland write-capable assistant tools require `OPENCLAW_ASSISTANT_TOKEN`. They must never fall back to, share, or be configured with the existing `OPENCLAW_TEAMSHIP_READ_TOKEN`. Direct Teams delivery must use an existing personal conversation target such as `user:<aad-object-id>`; a bare UUID can be misinterpreted as a team or group lookup.

## Tests and gaps

Tests named `tests/assistant-*.test.ts`, `tests/openai-integration.test.ts`, and `tests/assistant-provider.test.ts` cover deterministic runtime, provider parsing, automations, knowledge, Microsoft sync, and module workflows. Missing coverage requiring confirmation includes employee-facing factuality evaluations, cost budgets, latency SLOs, and approved tool allowlists per tenant.
