# Customer Intelligence: Permissions

> Evidence status: Confirmed from code.

## Role access (v1)

| Action | Roles |
|---|---|
| Read profiles, directory, contacts, financials, matching | ADMIN, MANAGER, FINANCE |
| Approve/reject identity matches, manage service rules, source accounts, FX, financial facts | ADMIN, FINANCE |
| Operating-company, integration, mailbox, retention, and schedule settings | ADMIN |
| No access | SALES, OPERATIONS, READ_ONLY |

## Implementation

- `ModuleKey.CUSTOMER_INTELLIGENCE` was added to the enum, the seed module list, and the tenant module access seeding.
- `DEFAULT_ROLE_MATRIX` grants ADMIN and MANAGER all modules (`"ALL"`) and adds `CUSTOMER_INTELLIGENCE` to the FINANCE list. SALES and OPERATIONS lists are unchanged, so they have no access.
- READ_ONLY resolves to `"ALL"` with `canMutate: false`, so the leadership-only boundary is enforced at the module guard, not the matrix:

  - `requireReadAccess` (`actions.ts`): `requireModule(CUSTOMER_INTELLIGENCE)` then `requireRole([ADMIN, MANAGER, FINANCE])`. This excludes READ_ONLY.
  - `requireMatchApproval`: read access then `requireRole([ADMIN, FINANCE])`.
  - `requireAdminSettings`: read access then `requireRole([ADMIN])`.
  - `requireWrite` additionally calls `requireMutationAccess`.

- Every service entry point is guarded server-side; there is no UI or route yet (later phase).
- Tenant module access for the seeded tenant is created in `prisma/seed.ts` (`seedOperatingCompanies` + module access upsert).
