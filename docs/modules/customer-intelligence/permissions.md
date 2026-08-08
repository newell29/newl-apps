# Customer Intelligence: Permissions

> Evidence status: Confirmed from code.

## Role access (v1)

| Action | Roles |
|---|---|
| Read profiles, directory, contacts, financials, matching | ADMIN, MANAGER, FINANCE |
| Approve/reject identity matches, manage service rules, source accounts, FX, financial facts | ADMIN, FINANCE |
| Operating-company, integration, mailbox, retention, and schedule settings | ADMIN |
| Associate an operating company with an ACTIVE QuickBooks credential (`associateQuickBooksCredential`) | ADMIN (plus the tenant mutation gate via `requireWrite`) |
| Trigger read-only QuickBooks customer ingestion (`runQuickBooksCustomerIngestion`, CP-PHASE-02B-2) | ADMIN (via `requireIngestionAdmin`, which stacks `requireAdminSettings` + `requireWrite`) |
| Trigger deterministic identity reconciliation; review identity matches; explicitly create-and-approve a canonical Company (`runIdentityReconciliation`, `reviewIdentityMatch`, `approveIdentityMatchWithNewCompany`, CP-PHASE-02B-3) | ADMIN, FINANCE (via `requireMatchApproval` + `requireWrite`; Company creation additionally requires explicit confirmation) |
| No access | SALES, OPERATIONS, READ_ONLY |

## Implementation

- `ModuleKey.CUSTOMER_INTELLIGENCE` was added to the enum. The `20260805150000_customer_intelligence_corrections` migration bootstraps the `Module` catalog record, enables the module for the approved `newl-group` tenant only, and seeds the three Newl operating companies — so the module is deployable through the normal `prisma migrate deploy` path without the broad development seed. Unrelated tenants are not enabled and get no Newl operating companies.
- `DEFAULT_ROLE_MATRIX` grants ADMIN and MANAGER all modules (`"ALL"`) and adds `CUSTOMER_INTELLIGENCE` to the FINANCE list. SALES and OPERATIONS lists are unchanged, so they have no access.
- READ_ONLY resolves to `"ALL"` with `canMutate: false`, so the leadership-only boundary is enforced at the module guard, not the matrix. Guards live in `src/modules/customer-intelligence/permissions.ts`:

  - `requireReadAccess`: `requireModule(CUSTOMER_INTELLIGENCE)` then `requireRole([ADMIN, MANAGER, FINANCE])`. Excludes READ_ONLY.
  - `requireMatchApproval`: read access then `requireRole([ADMIN, FINANCE])`.
  - `requireAdminSettings`: read access then `requireRole([ADMIN])`.
  - `requireWrite`: read access then `requireMutationAccess` (blocks READ_ONLY and tenant roles with `canMutate=false`).

- Every exported query in `queries.ts` and the guarded resolver in `cashflow-compatibility.ts` call `requireReadAccess`; every mutation action calls the appropriate guard plus `requireWrite`. `refreshRelationshipLifecycle` also calls `requireMutationAccess` because it writes. The CP-PHASE-02B-1 association action (`associateQuickBooksCredential`) calls `requireAdminSettings` then `requireWrite` and is ADMIN-only, so FINANCE and MANAGER cannot associate QuickBooks credentials even though they can read and maintain other Customer Intelligence facts. The CP-PHASE-02B-2 ingestion entry point (`runQuickBooksCustomerIngestion`) calls `requireIngestionAdmin` (`requireAdminSettings` + `requireWrite`) and is ADMIN-only, so SALES, OPERATIONS, READ_ONLY, FINANCE, and MANAGER cannot trigger ingestion — even a zero-write dry run.
- Tenant module access for the seeded tenant is created in `prisma/seed.ts` and by the corrections migration (both idempotent).
