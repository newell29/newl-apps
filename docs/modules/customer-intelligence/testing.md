# Customer Intelligence: Testing

> Evidence status: Confirmed from code.

## Test files

- `tests/customer-intelligence-foundation.test.ts` — 36 tests. Prisma is mocked, but the authorization module is REAL (only `@/server/db` is mocked), so the tests prove the true permission boundary. Covers:
  - Entitlement bootstrap: the corrections migration creates the module, the `newl-group` entitlement, and the three operating companies idempotently; `vercel-build.ts` runs `migrate deploy` without the broad seed.
  - Permissions: SALES denied on every exported query (explicit per-function coverage); OPERATIONS and READ_ONLY denied on reads; FINANCE allowed; SALES/OPERATIONS/READ_ONLY denied on mutations; FINANCE with `canMutate=false` denied; `refreshRelationshipLifecycle` requires mutation access; the cashflow resolver is guarded.
  - Lifecycle isolation: revenue scoped by operating company; approved mappings scoped by operating company; zero revenue + positive open AR activates; inactive accounts with no revenue/open AR → FORMER; three-company rollup.
  - Identity integrity: cross-tenant `companyId`/`candidateCompanyId` rejected; `QUICKBOOKS_ACCOUNT` requires an operating company; second manual approval rejected; competing proposals keep one approved target; DB unique-violation backstop returns the authoritative approved match; re-running approved/rejected decisions is idempotent.
  - Contact points: email casing and phone formatting deduplicate; display values preserved; empty values rejected.
  - Contact evidence: accepted facts are never overwritten (CONFLICT + `conflictingValue`); same-value re-observations stay stable; pending values replaced; empty extraction rejected.
  - Regression: operating-company audit, one customer across three operating companies, multiple CAD/USD accounts, same-name tenant isolation, cross-tenant relation-ID attacks, cashflow compatibility, and a structural guard that no migration touches `CashflowCustomer`/`CashflowLegalEntity`.
- `tests/customer-intelligence-identity.test.ts` — pure identity scoring, normalization, free-mail rules, name-alone never auto-links.
- `tests/customer-intelligence-service-lines.test.ts` — the seven service lines and deterministic precedence.
- `tests/customer-intelligence-lifecycle.test.ts` — per-relationship lifecycle and rollup ordering.
- `tests/authorization.test.ts` — leadership-only `CUSTOMER_INTELLIGENCE` matrix assertions (ADMIN/MANAGER/FINANCE allowed; SALES/OPERATIONS denied).

## Commands

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## Known pre-existing failures (present on origin/main, not introduced by this PR)

- `tests/authorization.test.ts > accessibleModuleKeys returns the exact operational module set for OPERATIONS` — the hardcoded expected array omits `WEBSITE_GROWTH`, which the OPERATIONS matrix has always included.
- `tests/assistant-runtime.test.ts` and `tests/settings-queries.test.ts` each have one unrelated failure on origin/main.

All Customer Intelligence tests pass; the full suite reports the same three failures as origin/main.
