# Integrations


## Source evidence

> Evidence status: Confirmed from code unless a bullet explicitly says otherwise.

Key repository evidence: `src/components/app-shell.tsx`, `prisma/schema.prisma`, `src/server/auth/authorization.ts`, `src/server/auth/role-policy.ts`, `src/server/tenant-context.ts`, module files under `src/modules/`, routes under `src/app/`, API handlers under `src/app/api/`, tests under `tests/`, existing plans under `reference/` and legacy docs under `docs/`.


## Summary

- Next.js pages/routes live under `src/app`; module code lives under `src/modules`; shared server primitives live under `src/server`; persistent data is defined in `prisma/schema.prisma`.
- Tenant-safe execution starts with `getAuthenticatedContext()` or ingestion auth, then `requireModule`, `requireMutationAccess`, and tenant-scoped Prisma filters.
- Background or scheduled work is represented by API routes such as `/api/assistant/automations/run-due`, `/api/shipment-documents/teamship-review/email-intake/scheduled`, scripts under `scripts`, and database run/job models including `AutomationJobRun`, `AssistantAutomationRun`, `TeamshipDailySyncRun`, `GarlandEmailSyncRun`, and `TeamshipUpdateJob`.
- Environment variable names are documented in `.env.example`; real values must never be committed.

## Important files

- `package.json` for commands.
- `.env.example` for variable names only.
- `prisma/schema.prisma` for tables, enums, indexes, and relations.
- `src/server/integrations/*` for external clients.
- `.github/workflows/preview-migrations.yml` and `.github/workflows/production-migrations.yml` for migration deployment checks.
