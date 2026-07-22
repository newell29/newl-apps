# OpenClaw Website Growth Scout

## Decision

Run website research and brief production as a separate OpenClaw agent named **Scout**. Do not add it to Hunter.

Hunter is a TradeMining lead collector. Scout is an evidence and content-production role with different data sources, prompts, approvals, quality measures, and permissions. They may share the same Mac mini runtime, but they should not share an agent identity, queue, state, or write token.

## Responsibilities

Scout may:

- trigger tenant-scoped Search Console, GA4, first-party inbound, and website-inventory reads;
- query the official read-only SEMrush MCP server through OAuth;
- refresh evidence on non-final opportunities;
- cluster search intent and prepare the weekly approval slate;
- produce or regenerate a page brief in Newl Apps;
- flag numerical, certification, affiliation, customer, comparative, and guarantee claims;
- report stalled or failed producer runs.

Scout may not:

- approve its own brief;
- alter a claim-review disposition;
- access a website repository write token;
- run any Codex session with repository write access;
- open, merge, or publish a website pull request;
- deploy to production or request indexing for an unmerged page.

## Handoff

Newl Apps is the control plane. An Admin or Manager approves the exact saved brief. Approval creates a tenant-scoped `AutomationJobRun` containing an immutable copy of the brief and dispatches the website repository workflow using only the job ID and tenant slug.

The website repository workflow fetches the brief through a tenant-bound bearer-token endpoint, runs Codex in a read-only GitHub job to create and verify a patch, and passes only the patch artifact to a separate GitHub job with write permission. That second job opens a draft PR. Vercel Preview reports its URL back to the same job record. The owner retains the merge decision.

The scheduled Scout runtime calls `POST /api/website-growth/scout/prepare`. Newl Apps refreshes Search Console, GA4, and sanitized first-party form evidence, creates the bounded weekly slate, and returns a candidate packet. The packet also carries the versioned page-pattern library, current repository inventory, and recent approved/rejected/built/published decisions so form, hero, CTA, section, FAQ, and internal-link conventions persist across runs. The worker then runs an ephemeral Codex session with a read-only sandbox in the website repository. Codex must query the official SEMrush MCP server through OAuth and return the repository-owned JSON schema. `POST /api/website-growth/scout/complete` validates the candidate scope, stores only sanitized SEMrush evidence, saves the drafts, and returns the deterministic Teams review message. The legacy `/produce` endpoint remains available as a narrow fallback but is not the scheduled path.

## Model policy

- Deterministic imports, scoring, deduplication, claim pattern checks, and state transitions: no model.
- Scout default: Codex `gpt-5.6-sol`, high reasoning.
- Codex developer default: `gpt-5.6-sol`, high reasoning.
- Evaluate `gpt-5.6-terra` for lower-risk briefs after a matched saved-opportunity evaluation.
- Run Kimi K3 only as a shadow producer/challenger until it passes the same factuality, claim, route, design, build, visual, cost, and reviewer-edit evaluation. It must not receive automatic repository write authority during the trial.

Kimi is not part of Scout. The Kimi key belongs in the `newl_website` developer runner's protected secret store, not Newl Apps, Vercel, the Scout packet, or Teams. Dual Codex/Kimi branches and Vercel previews require a separate reviewed change to the website repository workflow.

## Cadence and limits

Run Scout on Monday at 9:15 AM in `America/Toronto`, after the evidence refresh performed inside the same job. The initial candidate packet is capped at six items even though the queue guides remain up to two core-page items, four supporting items, and six quick optimizations. These are limits, not publishing targets. No developer build begins without a human brief approval.

## Secrets and tenant scope

Use a dedicated Scout read/prepare token and environment file. Keep the developer callback token separate. Every request must carry the configured tenant slug, and Newl Apps must resolve that slug to a tenant before reading or changing a record. SEMrush OAuth state stays in the Codex/OpenClaw runtime; Newl Apps receives only sanitized evidence rows. Never put tokens, credentials, customer data, or the full brief in the GitHub dispatch payload.

## Evaluation gates

Before widening volume or changing models, review at least 20 saved opportunities across core pages, supporting content, and quick optimizations. Record:

- correct search intent and route decision;
- duplication/cannibalization rate;
- unsupported claim count and severity;
- human edits before approval;
- successful lint and production build rate;
- visual-review accept/revise/reject result;
- latency and model cost per approved brief and PR;
- post-merge Search Console, GA4, and first-party lead movement at 28 and 90 days.
