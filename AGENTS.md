# AGENTS.md - Newl Apps

This repository is the source of truth for the Newl Apps platform.

## Project Strategy

When building Newl Apps, treat it first and foremost as an internal Newl Group app platform for employees. It should host operational tools such as Apollo + TradeMining lead generation, UPS calculators, transit time lookup, invoice verification and QuickBooks posting, and future sales, finance, and operations tools.

Design internal-first, SaaS-ready. The architecture must allow individual apps/modules to later be sold to other logistics companies as SaaS products without rewriting the platform foundation.

Core architecture rules:

- Use multi-tenant architecture from day one.
- Every major business table must include `tenantId`.
- Users must belong to a tenant/company.
- App/module access must be configurable per tenant.
- Integration credentials must be stored per tenant.
- Do not hardcode Newl Group in business logic.
- Treat Newl Group as the first seeded tenant, not a special-case platform assumption.
- Keep modules separated so one tenant can use only lead generation, another can use UPS tools, and another can use invoice verification.
- Billing can remain a placeholder initially, but the data model must not block future billing, subscriptions, plans, entitlements, or usage metering.
- Permissions must support `Admin`, `Manager`, `Sales`, `Operations`, `Finance`, and `Read Only` roles.
- All queries must be tenant-safe to prevent cross-company data access.

Implementation expectations:

- Read `reference/PRODUCT_OPERATING_BRIEF.md` before product or lead-gen implementation work.
- Make `tenantId` part of service-layer inputs, database constraints, indexes, authorization checks, and test fixtures.
- Prefer tenant-scoped integration configuration over global env-only credentials for production app behavior.
- Keep lead generation, UPS tools, transit lookup, invoice verification, QuickBooks posting, and future tools as separate modules with explicit entitlements.
- Use shared platform primitives for auth, tenants, roles, audit logs, jobs, integrations, files, and billing placeholders.
- Add tests or review checks for tenant isolation on every shared data path.

## Development Workflow

- Work in small-to-medium PRs, not massive rewrites.
- Before coding, summarize the intended implementation plan.
- After coding, run lint, typecheck, build, and relevant Prisma checks.
- Never push directly to main.
- Always create a PR.
- Include a PR summary with:
  1. What changed
  2. Why it changed
  3. Files changed
  4. How to test locally
  5. Screens/pages affected
  6. Tenant-safety considerations
  7. Any known limitations
- Do not ask the user for minor implementation decisions.
- Make practical assumptions consistent with AGENTS.md.
- Ask only when a decision affects product direction, security, data model, or external integrations.

## Security

- Never commit secrets, API keys, service account JSON, private keys, refresh tokens, passwords, or webhook tokens.
- Use placeholders in committed examples, such as `APOLLO_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEETS_ID`, and `OPENCLAW_TOKEN`.
- Store production credentials in a managed secret store or tenant-scoped encrypted integration credential storage.

## Authentication & Tenant Context

Production authentication uses **Auth.js v5** with **Microsoft Entra ID SSO** and database-backed sessions. Users must be **admin-provisioned** (`User` + `Membership` rows) before they can sign in. There is **no self-signup**; the `signIn` callback rejects emails with no membership.

For local development only, set `AUTH_DEV_BYPASS=true` (with `NODE_ENV` not `production`) to enable the dev email/password login form and seeded credentials. Never enable dev bypass in production; `isDevLoginEnabled()` enforces this.

**Tenant resolution:** use `getAuthenticatedContext()` in user-facing server code (pages, server actions, route handlers that serve the app UI). `getCurrentTenantContext()` is a thin wrapper that returns only the tenant subset for existing tenant-scoped query helpers. Role and tenant are **always re-validated from the database** via `Membership` on every call — never trust tenant or role claims from the session alone.

**Authorization helpers** live in `src/server/auth/authorization.ts`:

- `requireModule(ctx, moduleKey)` — role may access the module **and** the tenant has it enabled
- `requireMutationAccess(ctx)` — blocks `READ_ONLY` from writes
- `requireRole(ctx, allowedRoles)` — role must be in the allowed list
- `requireAdmin(ctx)` — shorthand for `ADMIN` only

High-level **ROLE_MATRIX** (six roles):

| Role | Module access | May mutate |
|------|---------------|------------|
| `ADMIN` | All modules | Yes |
| `MANAGER` | All modules | Yes |
| `SALES` | `LEAD_GEN` | Yes |
| `OPERATIONS` | `LEAD_GEN`, `UPS_TOOLS`, `TRANSIT_LOOKUP` | Yes |
| `FINANCE` | `INVOICE_VERIFICATION`, `QUICKBOOKS_POSTING` | Yes |
| `READ_ONLY` | All modules (read) | No |

**Route architecture:** `(public)` holds `/login`; `(authenticated)` holds all app pages. Middleware performs a lightweight session-cookie gate; the `(authenticated)` layout calls `getAuthenticatedContext()` for authoritative DB validation. Unauthenticated visitors are redirected to `/login`. Place new protected pages under `src/app/(authenticated)/`.

**Testing:** run `npm test` (Vitest, hermetic unit tests) and `npm run verify:auth` (live DB checks against a seeded database).

**Ingestion auth is separate:** machine-to-machine TradeMining ingestion uses `INGESTION_API_TOKEN` (Bearer or `x-newl-ingestion-key` header), not user sessions. See `src/server/ingestion-auth.ts` and `reference/OPENCLAW_N8N_INGESTION_API.md`.

Full architecture, env vars, Entra setup, and file index: `reference/AUTH_AND_TENANT_CONTEXT.md`.

## Reference

- Product operating brief and PR milestones: `reference/PRODUCT_OPERATING_BRIEF.md`
- Lead generation rebuild source of truth: `reference/OPENCLAW_LEAD_GEN_SPEC.md`
- Auth and tenant context (detailed): `reference/AUTH_AND_TENANT_CONTEXT.md`
- Initial migration plan: `reference/MIGRATION_PLAN.md`
