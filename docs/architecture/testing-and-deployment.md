# Testing and deployment


## Source evidence

> Evidence status: Confirmed from code unless a bullet explicitly says otherwise.

Key repository evidence: `src/components/app-shell.tsx`, `prisma/schema.prisma`, `src/server/auth/authorization.ts`, `src/server/auth/role-policy.ts`, `src/server/tenant-context.ts`, module files under `src/modules/`, routes under `src/app/`, API handlers under `src/app/api/`, tests under `tests/`, existing plans under `reference/` and legacy docs under `docs/`.


## Summary

- Next.js pages/routes live under `src/app`; module code lives under `src/modules`; shared server primitives live under `src/server`; persistent data is defined in `prisma/schema.prisma`.
- Tenant-safe execution starts with `getAuthenticatedContext()` or ingestion auth, then `requireModule`, `requireMutationAccess`, and tenant-scoped Prisma filters.
- Background or scheduled work is represented by API routes such as `/api/assistant/automations/run-due`, `/api/shipment-documents/teamship-review/email-intake/scheduled`, scripts under `scripts`, and database run/job models including `AutomationJobRun`, `AssistantAutomationRun`, `TeamshipDailySyncRun`, `GarlandEmailSyncRun`, and `TeamshipUpdateJob`.
- Environment variable names are documented in `.env.example`; real values must never be committed.

## Customer Intelligence tests

`tests/customer-intelligence-foundation.test.ts`, `tests/customer-intelligence-identity.test.ts`, `tests/customer-intelligence-service-lines.test.ts`, and `tests/customer-intelligence-lifecycle.test.ts` cover the foundation. The foundation suite uses the real authorization module against a mocked Prisma client, proving permission denials (SALES/OPERATIONS/READ_ONLY, `canMutate=false` across the full 12-mutation facade with no-database-write assertions), lifecycle isolation, identity conflicts (including no-approval-without-company and QuickBooks-operating-company manual-approval invariants), contact normalization/evidence preservation, and deployable entitlement bootstrap; `tests/authorization.test.ts` covers the leadership-only matrix. The structural migration-guard suite `tests/customer-intelligence-migrations.test.ts` (CP-PHASE-02A) proves the three Customer Intelligence migrations are additive, idempotent, non-destructive, and never rewrite legacy cashflow structures. Baseline debt (including any unrelated global failure, none of which the CP-PHASE-02A run reproduced) is recorded in `docs/modules/customer-intelligence/testing.md`.

## Important files

- `package.json` for commands.
- `.env.example` for variable names only.
- `prisma/schema.prisma` for tables, enums, indexes, and relations.
- `src/server/integrations/*` for external clients.
- `.github/workflows/preview-migrations.yml` and `.github/workflows/production-migrations.yml` for migration deployment checks.
