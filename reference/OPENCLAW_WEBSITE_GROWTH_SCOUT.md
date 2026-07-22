# OpenClaw Website Growth Scout

## Decision

Run website research and brief production as a separate OpenClaw agent named **Scout**. Do not add it to Hunter.

Hunter is a TradeMining lead collector. Scout is an evidence and content-production role with different data sources, prompts, approvals, quality measures, and permissions. They may share the same Mac mini runtime, but they should not share an agent identity, queue, state, or write token.

## Responsibilities

Scout may:

- trigger tenant-scoped Search Console, GA4, first-party inbound, and website-inventory reads;
- refresh evidence on non-final opportunities;
- cluster search intent and prepare the weekly approval slate;
- produce or regenerate a page brief in Newl Apps;
- flag numerical, certification, affiliation, customer, comparative, and guarantee claims;
- report stalled or failed producer runs.

Scout may not:

- approve its own brief;
- alter a claim-review disposition;
- access a website repository write token;
- invoke Codex directly;
- open, merge, or publish a website pull request;
- deploy to production or request indexing for an unmerged page.

## Handoff

Newl Apps is the control plane. An Admin or Manager approves the exact saved brief. Approval creates a tenant-scoped `AutomationJobRun` containing an immutable copy of the brief and dispatches the website repository workflow using only the job ID and tenant slug.

The website repository workflow fetches the brief through a tenant-bound bearer-token endpoint, runs Codex in a read-only GitHub job to create and verify a patch, and passes only the patch artifact to a separate GitHub job with write permission. That second job opens a draft PR. Vercel Preview reports its URL back to the same job record. The owner retains the merge decision.

The initial Scout runtime is intentionally narrow: `ops/openclaw/run-website-growth-scout.sh` calls `POST /api/website-growth/scout/produce`, which selects one highest-scoring Reviewing opportunity without a draft and asks Newl Apps to save the brief. The OpenClaw skill contains no GitHub or approval capability.

## Model policy

- Deterministic imports, scoring, deduplication, claim pattern checks, and state transitions: no model.
- Scout default: `gpt-5.6-sol`, medium reasoning.
- Codex developer default: `gpt-5.6-sol`, high reasoning.
- Evaluate `gpt-5.6-terra` for lower-risk briefs after a matched saved-opportunity evaluation.
- Run Kimi K3 only as a shadow producer/challenger until it passes the same factuality, claim, route, design, build, visual, cost, and reviewer-edit evaluation. It must not receive automatic repository write authority during the trial.

## Cadence and limits

Start with one weekly research/brief-preparation run. Keep the existing review guides—up to two core-page items, four supporting items, and six quick optimizations—as queue limits, not publishing targets. No developer build begins without a human brief approval.

## Secrets and tenant scope

Use a dedicated Scout read/prepare token if a remote worker is added. Keep the developer callback token separate. Every request must carry the configured tenant slug, and Newl Apps must resolve that slug to a tenant before reading or changing a record. Never put tokens, credentials, customer data, or the full brief in the GitHub dispatch payload.

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
