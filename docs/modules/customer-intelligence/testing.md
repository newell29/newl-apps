# Customer Intelligence: Testing

> Evidence status: Confirmed from code.

## Test files

- `tests/customer-intelligence-foundation.test.ts` — tenant-safe actions and queries with a hermetic Prisma mock. Covers:
  - One customer shared across three operating companies with rolled-up lifecycle.
  - Multiple CAD/USD QuickBooks accounts mapping to one canonical customer relationship.
  - Same-name companies isolated across tenants on every query and write.
  - Cross-tenant relation-ID read/write attacks.
  - Reviewed match decisions preserved across re-runs; auto-link at score >= 90; no auto-link when the source record is approved to another company; free-mail deferral.
  - Partial and completely missing external evidence.
  - Lifecycle refresh from tenant-scoped revenue and account evidence.
  - Cashflow compatibility: legacy enum mapping, operating-company lookup scoped to tenant, no cashflow row rewrites, and a structural guard that the migration does not touch `CashflowCustomer`/`CashflowLegalEntity`.
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
