# Customer Intelligence: Testing

> Evidence status: Confirmed from code.

## Test files

- `tests/customer-intelligence-foundation.test.ts` — 39 tests. Prisma is mocked, but the authorization module is REAL (only `@/server/db` is mocked), so the tests prove the true permission boundary. Covers:
  - Entitlement bootstrap: the corrections migration creates the module, the `newl-group` entitlement, and the three operating companies idempotently; `vercel-build.ts` runs `migrate deploy` without the broad seed.
  - Permissions: SALES denied on every exported query (explicit per-function coverage); OPERATIONS and READ_ONLY denied on reads; FINANCE allowed. **Mutations:** a table-driven test invokes all 12 exported mutations (`registerOperatingCompany`, `upsertCompanyOperatingRelationship`, `refreshRelationshipLifecycle`, `upsertSourceAccount`, `proposeIdentityMatch`, `reviewIdentityMatch`, `upsertServiceMappingRule`, `upsertFxRate`, `recordRevenueLine`, `upsertMonthlyFinancial`, `upsertContactPoint`, `upsertContactEvidence`) with SALES and OPERATIONS contexts and asserts rejection before any database write. A second table-driven test proves the same for READ_ONLY and for FINANCE with `canMutate=false`, also asserting no database write occurred. `refreshRelationshipLifecycle` has an explicit mutation-access check; the cashflow resolver is guarded.
  - Lifecycle isolation: revenue scoped by operating company; approved mappings scoped by operating company; zero revenue + positive open AR activates; inactive accounts with no revenue/open AR → FORMER; three-company rollup.
  - Identity integrity: cross-tenant `companyId`/`candidateCompanyId` rejected; `QUICKBOOKS_ACCOUNT` requires an operating company; **a high-scoring proposal with `companyId: null` stays PROPOSED (never APPROVED)**; **manual approval of a `QUICKBOOKS_ACCOUNT` match requires a tenant-valid operating company (missing and cross-tenant references rejected)**; second manual approval rejected; competing proposals keep one approved target; DB unique-violation backstop returns the authoritative approved match; re-running approved/rejected decisions is idempotent.
  - Contact points: email casing and phone formatting deduplicate; display values preserved; empty values rejected.
  - Contact evidence: accepted facts are never overwritten (CONFLICT + `conflictingValue`); same-value re-observations stay stable; pending values replaced; empty extraction rejected.
  - Regression: operating-company audit, one customer across three operating companies, multiple CAD/USD accounts, same-name tenant isolation, cross-tenant relation-ID attacks, cashflow compatibility, and a structural guard that no migration touches `CashflowCustomer`/`CashflowLegalEntity`.
- `tests/customer-intelligence-identity.test.ts` — 17 tests. Pure identity scoring, normalization, free-mail rules, name-alone never auto-links.
- `tests/customer-intelligence-service-lines.test.ts` — 9 tests. The seven service lines and deterministic precedence.
- `tests/customer-intelligence-lifecycle.test.ts` — 12 tests. Per-relationship lifecycle and rollup ordering.
- `tests/customer-intelligence-migrations.test.ts` — structural migration-guard suite (CP-PHASE-02A). Reads the SQL source of the three Customer Intelligence migrations (`20260805120000_add_customer_intelligence_foundation`, `20260805150000_customer_intelligence_corrections`, `20260805160000_customer_intelligence_identity_integrity`) and proves at the source level that each is:
  - **additive** — a statement-level allowlist admits only `CREATE TYPE` / `ALTER TYPE ... ADD VALUE` / `CREATE TABLE` / `ALTER TABLE` restricted to `ADD COLUMN` and `ADD CONSTRAINT` / `CREATE INDEX` (including `CREATE UNIQUE INDEX`) / `INSERT ... ON CONFLICT`; `UPDATE`, `MERGE`, `REPLACE`, and non-additive `ALTER TABLE` forms (`ALTER COLUMN`, `RENAME`, `DROP`) are explicitly rejected;
  - **idempotent where it writes data** — every data `INSERT` carries `ON CONFLICT` (`DO NOTHING` or `DO UPDATE`);
  - **non-destructive** — no `DROP TABLE`, `TRUNCATE`, `DELETE FROM`, or column/index/constraint/type drops, matched case-insensitively so lowercase destructive SQL cannot pass;
  - **never touching legacy finance** — none of the migrations references `CashflowCustomer`, `CashflowLegalEntity`, or any other `Cashflow*` structure; and
  - **tenant-scoped bootstrap** — the `Module`/`TenantModuleAccess`/`OperatingCompany` bootstrap is scoped to the `newl-group` tenant only.
  The statement splitter removes full-line `--` comment lines before splitting on semicolons, so comment prose containing semicolons can never be parsed as a phantom statement (CP-PHASE-02A confirmed regression, pinned by a dedicated test). It also guards the inventory: exactly the three known migrations may reference Customer Intelligence tables, so renaming, removing, or silently adding a Customer Intelligence migration fails the suite. Phase-2 backfill migrations must pass the same statement allowlist and idempotency guards.
- `tests/authorization.test.ts` — 27 tests including the leadership-only `CUSTOMER_INTELLIGENCE` matrix assertions (ADMIN/MANAGER/FINANCE allowed; SALES/OPERATIONS denied).

The Customer Intelligence + authorization baseline is **104 targeted tests** = 77 Customer Intelligence tests (`foundation` 39 + `identity` 17 + `service-lines` 9 + `lifecycle` 12) + 27 authorization tests.

## Phase 2A adoption baseline

CP-PHASE-02A records the adoption baseline before phase 2. This phase changes no schema, adds no migration, and changes no runtime behaviour; it adds the migration-guard suite above and the documentation below.

### Handoff inventory reconciliation

The handoff inventory was reconciled against this checkout. Every item is present; no discrepancy was found.

| Handoff item | Repository location | Status |
|---|---|---|
| Migration 1: foundation | `prisma/migrations/20260805120000_add_customer_intelligence_foundation/migration.sql` (+ `migration_lock.toml`) | Present |
| Migration 2: corrections | `prisma/migrations/20260805150000_customer_intelligence_corrections/migration.sql` (+ `migration_lock.toml`) | Present |
| Migration 3: identity integrity | `prisma/migrations/20260805160000_customer_intelligence_identity_integrity/migration.sql` (+ `migration_lock.toml`) | Present |
| Module source | `src/modules/customer-intelligence/` — 10 files: `actions.ts`, `audit.ts`, `cashflow-compatibility.ts`, `constants.ts`, `identity-approval.ts`, `identity.ts`, `lifecycle.ts`, `permissions.ts`, `queries.ts`, `service-lines.ts` | Present |
| Customer Intelligence test suites | `tests/customer-intelligence-foundation.test.ts`, `tests/customer-intelligence-identity.test.ts`, `tests/customer-intelligence-service-lines.test.ts`, `tests/customer-intelligence-lifecycle.test.ts` (77 tests) | Present |
| Authorization suite | `tests/authorization.test.ts` (27 tests, including the `CUSTOMER_INTELLIGENCE` leadership matrix) | Present |
| Module documentation | `docs/modules/customer-intelligence/` — `overview.md`, `data-model.md`, `permissions.md`, `business-rules.md`, `integrations.md`, `testing.md`, `open-questions.md` | Present |

### Adoption baseline SHA (controller-owned)

The git-level baseline steps are owned by the controller and recorded at verification time:

- Freshly fetched `origin/main` SHA: _recorded by the controller at verification time_.
- Assertion that the Phase 1 Customer Intelligence merge (the three migrations, `src/modules/customer-intelligence/*`, and the CI test/documentation suites) is contained in `origin/main`: _recorded by the controller at verification time_.
- Overlap check that no open branch changes Customer Intelligence schema or behaviour: _recorded by the controller at verification time_.

### Baseline re-run and baseline debt

- Re-run result of the Customer Intelligence + authorization baseline (104 targeted tests): _recorded by the controller at verification time_.
- Unrelated global failures are recorded separately as baseline debt; they are not introduced by this phase and are listed in "Baseline debt (recorded at CP-PHASE-02A verification time)" below.

## Commands

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## Baseline debt (recorded at CP-PHASE-02A verification time)

- The CP-PHASE-02A run observed **no unrelated global failures**. The three failures previously listed as origin/main baseline debt (the OPERATIONS `accessibleModuleKeys` expectation omitting `WEBSITE_GROWTH`, and one failure each in `assistant-runtime.test.ts` and `settings-queries.test.ts`) were **not reproduced**: `tests/authorization.test.ts` (27 tests), `tests/assistant-runtime.test.ts` (8 tests), and `tests/settings-queries.test.ts` (5 tests) all passed. The OPERATIONS matrix in `tests/authorization.test.ts` now includes `WEBSITE_GROWTH`.
- The only failure in the CP-PHASE-02A verification run was one migration-guard assertion in `tests/customer-intelligence-migrations.test.ts`: the statement-allowlist guard parsed a phantom statement with verb `UNKNOWN` out of the corrections migration's multi-line comment, whose prose contains a semicolon ("well; this index is the database-backed backstop ..."). The splitter split on `;` before stripping `--` comment lines, so the comment fragment `well` was treated as a SQL statement. The migration is additive and was not modified; the guard is fixed to strip full-line comments before splitting and a regression test pins the case. Every Customer Intelligence runtime test passed.
- Any unrelated global failure observed by the controller at verification time is recorded here as baseline debt; this phase introduces none.

## Preview migration validation runbook

> Live execution status: this phase performs no migration run. Executing
> migrations against any preview or production database is owner-approved
> operational work, not engine authority. The engine (Codex/OpenClaw) prepares
> and documents this runbook only; it never executes a migration.

### Safety gate (preview environment label)

Every migration run against an isolated preview PostgreSQL must first pass the database safety gate:

- `npm run db:safety-check -- --require-preview-db` (also invoked automatically by `npm run db:migrate:preview` before `prisma migrate deploy`) fails unless `DATABASE_ENVIRONMENT=preview` and the `DATABASE_URL` is not the production URL.
- `scripts/vercel-build.ts` runs the same `--require-preview-db` safety check for `VERCEL_ENV=preview` builds before `prisma migrate deploy`.
- The gate prints the resolved database signature (`host:port/database`); record it as the evidence anchor for every run.

### Required evidence

Each approved migration validation must record:

1. **Preview identity**: the isolated preview PostgreSQL identity (host, port, database) and the `DATABASE_ENVIRONMENT=preview` label the gate enforced. No other database may be targeted.
2. **Empty-database run**: a fresh preview database with no migrations applied, then `npm run db:migrate:preview` — the full migration history applies cleanly from scratch, including the three Customer Intelligence migrations.
3. **Upgrade-path run**: a preview database advanced to the migration immediately before `20260805120000_add_customer_intelligence_foundation`, then `npm run db:migrate:preview` — the three Customer Intelligence migrations apply on top of the existing schema. The migration-guard suite in `tests/customer-intelligence-migrations.test.ts` is the source-level proof of additivity; the upgrade-path run is the live proof that pre-existing schema/data survive.
4. **Post-run bootstrap verification**: the `Module` catalog row exists, `TenantModuleAccess` is enabled for the `newl-group` tenant only, and exactly the three Newl operating companies exist — no other tenant is enabled or seeded.
5. **Human approval record**: who approved the run, when, and which database identity the approval covered.

### Approval boundary

- Explicit human approval is required **before any migration run**, including preview runs.
- Live execution of a migration is owner-approved operational work, not engine authority; the engine prepares and documents but does not run.
- Production migration requires the separate `db:migrate:production` gate (`DATABASE_ENVIRONMENT=production` plus production database-identity match) and a distinct owner approval per the repository human-approval boundaries.

## Phase exclusions (CP-PHASE-02A)

CP-PHASE-02A confirms the following are excluded and introduces none of them:

- No QuickBooks ingestion or sync.
- No settings/connection UI.
- No Customer Profile UI, API routes, or navigation.
- No Microsoft 365 mailbox integration.
- No Brave or Hunter research.
- No Apollo.
- No Teamship writes or reads.
- No scheduling.
- No production write of any kind.

No new entry points are introduced. Every existing shared data path continues to carry authenticated `tenantId` filtering, and the existing permission and human-approval boundaries are preserved.
