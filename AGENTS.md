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
   - Treat the repository's root checkout as a coordination checkout, not a reusable task workspace.
   - If the current checkout is not already dedicated to the active task, start one with `npm run codex:task:start -- <unique-task-slug>`.
   - Create task branches from freshly fetched `origin/main`; never create them from a stale local `main`.
   - Use persistent worktrees under `work/codex/`. Do not create task worktrees under `/tmp` or `/private/tmp`.
   - Never reuse one branch or worktree across unrelated Codex chats.
   - Before opening a pull request, run `npm run codex:task:publish -- ...` so current `main` is incorporated and conflicts are detected before review.
   - After the owner merges the pull request, use `npm run codex:task:cleanup -- <task-slug>` to remove only the confirmed-merged worktree and local branch.
10. Add regression tests for confirmed failures.
11. Update relevant documentation when behaviour changes.
12. Mark inferred business behaviour as requiring confirmation; never present it as approved.
13. Use Vercel Preview for browser validation when web-app behaviour changes.
14. Require explicit human approval for financial posting, Teamship writes, printing, shipping/releasing orders, customer communications, permission changes, database migrations, and production deployment.
15. Final reports must include root cause, files changed, tests added, commands run, preview URL, known limitations, and business questions requiring review.

## Human approval boundaries

OpenClaw may coordinate and prepare actions, but Newl Apps must enforce authentication, permission checks, validation, approval records, and audit logging. Deterministic code must perform exact comparisons, calculations, Teamship field updates, and printing. Codex changes code only through branches and reviewed pull requests.

## Code Review Rules

- Flag any production customer, order, address, email, serial, credential, token, or other live data added to code, tests, fixtures, documentation, generated output, or pull-request text. Safe path: use clearly synthetic reserved examples such as `PS123456`, `SR812345`, and `user@example.com`.
- Flag scope that is not traceable to the approved ticket or its confirmed root cause. Safe path: keep unrelated feedback in a separate suggestion and pull request.
- Flag Teamship writes, printing, shipping/releasing orders, migrations, deployments, financial posting, customer communication, or permission changes without a distinct human approval enforced by deterministic code.
- Flag shared data access that does not carry authenticated `tenantId` filtering through every layer.
- Flag fixes for missing or partial external data unless regression tests cover both partially populated and completely missing evidence.
- Flag a pull request whose description, tests, limitations, business questions, or reported commit do not match the actual diff and commands run.
- Flag overlapping open pull requests when they modify the same behaviour or files without an explicit compatibility check against current `main`.
- For Garland changes, require the repository Garland and Shipment Documents documentation to be read and updated when behaviour changes; generic WMS assumptions are not approved business rules.

## Reference documentation

Start with `docs/README.md`, `docs/architecture/overview.md`, `docs/modules/README.md`, and the relevant module folder. For product or lead-gen implementation work, also read `reference/PRODUCT_OPERATING_BRIEF.md` and `reference/OPENCLAW_LEAD_GEN_SPEC.md`.
