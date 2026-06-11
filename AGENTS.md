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

## Reference

- Product operating brief and PR milestones: `reference/PRODUCT_OPERATING_BRIEF.md`
- Lead generation rebuild source of truth: `reference/OPENCLAW_LEAD_GEN_SPEC.md`
- Initial migration plan: `reference/MIGRATION_PLAN.md`
