# OpenClaw integration

> Evidence status: Confirmed from code unless otherwise marked.


AI support is implemented through the Company Assistant module in `src/modules/assistant` with persistent chat, runs, retrieved sources, knowledge documents/chunks, memory, mailbox sync state, and automations in `prisma/schema.prisma`. External model execution is centralized in `src/server/integrations/assistant-provider.ts`; OpenAI and local LLM are supported provider kinds.

## Operating model

OpenClaw coordinates workflows and interprets employee intent. Newl Apps performs authentication, permission checks, validation, approvals, and audit logging. Deterministic code performs exact comparisons, calculations, Teamship field updates, and printing. Codex changes code only through branches and reviewed pull requests. OpenClaw must not freely improvise production actions through arbitrary browser clicking.

Approved data sources: this repository documentation, authenticated app APIs, tenant-scoped database queries through app code, approved employee feedback after confirmation, and live tools for current operational data. Prohibited tools: production write browser automation without approval, direct database writes, secrets extraction, unreviewed customer communications, financial posting, printing, Teamship writes, and deployment.

## Unresolved Teams turns

The optional `newl-unresolved-turns` OpenClaw plugin and tenant-scoped Newl Apps endpoint capture failed or unanswered Microsoft Teams turns for developer review. This includes explicit capability-gap replies and local spreadsheet paths that were not delivered as attachments. Successful turns are deleted; the capture does not retain model reasoning, full conversation history, tool parameters, or raw tool results. Detection, storage fields, developer discovery, privacy boundaries, and known limitations are defined in [openclaw-unresolved-turns.md](openclaw-unresolved-turns.md). The capture package does not include a scheduler.

## Teams spreadsheet attachments

The identity-bound `newl_create_spreadsheet` tool in the Newl Teamship plugin creates a bounded `.xlsx` under the active OpenClaw workspace from already-authorized current-conversation data. It neutralizes formula-like text and accepts at most 25 columns and 500 rows. The `teams-spreadsheet` skill then requires Teams' native `message(action=upload-file)` action in the same direct message; a local path or Markdown link is never a valid employee deliverable.

Enabling this workflow requires adding both `newl_create_spreadsheet` and `message` to Nemo's approved tool allowlist and installing the `teams-spreadsheet` skill. The `message` permission is used only for the trusted current Teams direct-message target in this workflow. Plugin installation, live allowlist changes, and reload remain separate human-approved rollout actions.

## Approval-gated printing

The separate `newl-print` OpenClaw plugin exposes plan, approve, and status tools for one exact numeric Teamship shipping-order number. OpenClaw never receives Teamship credentials and never controls a printer directly. Newl Apps binds the trusted Teams sender to a current membership, requires Assistant and Shipment Documents access plus mutation permission, stores an immutable audit record, and queues work only after a separate explicit approval by the same employee.

The local `teamship-print-worker` has a dedicated credential and tenant scope. It validates all destinations and the live pallet count before the first print, reselects printers per order, and does not retry uncertain jobs. See [Nemo printing rollout](nemo-printing-rollout.md).

## Garland Phase 1

The `newl-teamship` plugin also exposes identity-bound Garland tools for Teams PDF review, saved-check explanation, feedback capture, and an admin development-suggestion digest. Trusted inbound media is correlated by OpenClaw session and Teams sender; attachment paths are never model parameters. Newl Apps remains the persistence and authorization boundary.

The daily digest only groups unqueued feedback into `AWAITING_APPROVAL` suggestions. It must state that no development has started. A separate human-approved Codex task and reviewed pull request remain required for implementation.

For scheduled delivery, the plugin may use the configured administrator's Entra object ID only when the OpenClaw run has no interactive requester. Interactive calls always bind the actual Teams sender, preventing another employee from inheriting the scheduled administrator identity.

Garland write-capable assistant tools require `OPENCLAW_ASSISTANT_TOKEN`. They must never fall back to, share, or be configured with the existing `OPENCLAW_TEAMSHIP_READ_TOKEN`. Direct Teams delivery must use an existing personal conversation target such as `user:<aad-object-id>`; a bare UUID can be misinterpreted as a team or group lookup.

The reviewed production sequence, approval gates, supervised Teams PDF test, digest activation, and rollback steps are defined in [nemo-garland-production-rollout.md](nemo-garland-production-rollout.md).

## Tests and gaps

Tests named `tests/assistant-*.test.ts`, `tests/openai-integration.test.ts`, and `tests/assistant-provider.test.ts` cover deterministic runtime, provider parsing, automations, knowledge, Microsoft sync, and module workflows. Missing coverage requiring confirmation includes employee-facing factuality evaluations, cost budgets, latency SLOs, and approved tool allowlists per tenant.
