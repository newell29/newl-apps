# AGENTS.md - Newl Apps

This repository is the source of truth for the Newl Apps platform. Future agents must treat the app as an internal-first, SaaS-ready, multi-tenant platform.

## Required agent workflow

1. Read the nearest relevant `docs/modules/<module>/` documentation before changing code.
2. Inspect the existing implementation pattern before adding abstractions.
3. Trace every behaviour change through UI, API route, server action, service layer, database schema, permissions, tests, and documentation.
4. Preserve tenant and organization filtering. Every shared data path must carry `tenantId` from an authenticated or ingestion context.
5. Never expose secret values, tokens, passwords, private keys, service-account JSON, session cookies, or live customer data.
6. Never use production write credentials from Codex, OpenClaw, browser automation, scripts, or tests.
7. Never deploy directly to production.
8. Never merge to `main` automatically.
9. Work only on a feature branch or isolated worktree.
10. Add regression tests for confirmed failures.
11. Update relevant documentation when behaviour changes.
12. Mark inferred business behaviour as requiring confirmation; never present it as approved.
13. Use Vercel Preview for browser validation when web-app behaviour changes.
14. Require explicit human approval for financial posting, Teamship writes, printing, shipping/releasing orders, customer communications, permission changes, database migrations, and production deployment.
15. Final reports must include root cause, files changed, tests added, commands run, preview URL, known limitations, and business questions requiring review.

## Human approval boundaries

OpenClaw may coordinate and prepare actions, but Newl Apps must enforce authentication, permission checks, validation, approval records, and audit logging. Deterministic code must perform exact comparisons, calculations, Teamship field updates, and printing. Codex changes code only through branches and reviewed pull requests.

## Reference documentation

Start with `docs/README.md`, `docs/architecture/overview.md`, `docs/modules/README.md`, and the relevant module folder. For product or lead-gen implementation work, also read `reference/PRODUCT_OPERATING_BRIEF.md` and `reference/OPENCLAW_LEAD_GEN_SPEC.md`.
