# Newl Apps

Internal-first, SaaS-ready app platform for logistics operations.

## Purpose

Newl Apps hosts operational tools for Newl Group and is designed so individual modules can later become tenant-scoped SaaS products for other logistics companies.

The first module is the Apollo + TradeMining lead generation app. This scaffold intentionally does not call Apollo, TradeMining, Google Sheets, QuickBooks, UPS, OpenClaw, or n8n yet. Those integrations are represented by tenant-scoped schema and service boundaries only.

## What Is Built

- Next.js App Router application with TypeScript.
- Tailwind CSS styling.
- Prisma schema using PostgreSQL.
- Multi-tenant core models:
  - `Tenant`
  - `User`
  - `Membership`
  - `Module`
  - `TenantModuleAccess`
  - `IntegrationCredential`
  - `AuditLog`
  - `AutomationJobRun`
- Initial lead generation models:
  - `Company`
  - `TradeMiningImportRecord`
  - `TradeMiningSearchProfile`
  - `Contact`
  - `Lead`
- Seed data for Newl Group as the first tenant.
- Sample TradeMining search profiles for Houston Import Leads and Charlotte Warehouse Leads.
- Tenant-scoped OpenClaw/n8n ingestion API contract for fetching enabled profiles, creating job runs, posting TradeMining batches, and updating job status.
- Minimal app shell with dashboard, search profiles, candidate feed, pipeline, settings, and job/audit log pages.
- Tenant-safe query helpers that require a tenant context for business data access.

## Architecture Principles

- Every major business table includes `tenantId`.
- Newl Group is seeded tenant data, not hardcoded business logic.
- Modules are separated by entitlement so tenants can enable only the apps they need.
- Integration credentials are tenant-scoped.
- Permissions support Admin, Manager, Sales, Operations, Finance, and Read Only roles.
- All future queries must be tenant-safe.

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Copy environment placeholders:

```bash
cp .env.example .env
```

3. Set `DATABASE_URL` in `.env` to a local PostgreSQL database:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/newl_apps
DEFAULT_TENANT_SLUG=newl-group
```

4. Generate the Prisma client:

```bash
npm run prisma:generate
```

5. Create database tables:

```bash
npm run prisma:migrate
```

6. Seed the first tenant and sample lead-gen data:

```bash
npm run prisma:seed
```

7. Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `npm run dev` - start the Next.js dev server.
- `npm run build` - build the production app.
- `npm run lint` - run ESLint.
- `npm run typecheck` - run TypeScript without emitting files.
- `npm run prisma:generate` - generate the Prisma client.
- `npm run prisma:migrate` - run Prisma migrations locally.
- `npm run prisma:seed` - seed the first tenant and mock/sample data.

## Integration Boundaries

Live external calls are intentionally not wired yet. Future integration clients should be implemented behind tenant-scoped service boundaries and use `IntegrationCredential` records with encrypted secret references.

Use `IntegrationCredential.publicConfig` only for non-secret settings such as API base URLs, dry-run flags, enabled ports, display names, or placeholder external IDs. API keys, OAuth tokens, passwords, service account JSON, private keys, webhook secrets, refresh tokens, and production sequence/custom-field IDs must stay out of source and be referenced through `secretRef`.

TradeMining search profiles are tenant-scoped configuration in Newl Apps. The OpenClaw/n8n ingestion API can fetch active profiles from Newl Apps and post raw TradeMining batch results back without making live external calls from the app itself.

The first OpenClaw/n8n ingestion API boundary is documented in `reference/OPENCLAW_N8N_INGESTION_API.md`. It uses placeholder tenant-scoped token config for now:

```bash
INGESTION_API_TOKEN=replace-with-long-random-token
INGESTION_TENANT_SLUG=newl-group
```

The VM-based OpenClaw worker can later call these endpoints to fetch enabled search profiles, create job runs, post TradeMining batches, and update job status. OpenClaw remains a replaceable worker/collector; Newl Apps remains the source of truth for configuration, ingestion persistence, scoring, approvals, pipeline, and audit history.

Planned boundaries:

- Apollo company/contact matching and sequence push.
- TradeMining import and BOL normalization.
- Google Sheets legacy import/export.
- QuickBooks posting.
- UPS tools.
- OpenClaw legacy operations reporting.

## Tenant Safety

All tenant-owned business tables include `tenantId`. Relations between tenant-owned lead generation records use composite tenant-scoped foreign keys where Prisma can enforce them, such as lead/contact/company links.

The temporary tenant resolver in `src/server/tenant-context.ts` is development-only and reads `DEFAULT_TENANT_SLUG`. Production must replace it with authenticated membership/session tenant resolution before serving real users.

Some future cross-cutting fields, such as `AuditLog.actorUserId` and `Lead.ownerUserId`, are currently stored as IDs without relations because user ownership and impersonation semantics need the auth layer first. Service code must validate those IDs through tenant membership before writing them.

## Branding And Theming

Newl Apps uses centralized semantic theme tokens in `src/app/globals.css` and `tailwind.config.ts`, including `primary`, `primaryHover`, `primaryActive`, `accent`, `accentSoft`, `accentBorder`, `sidebar`, `sidebarHover`, `sidebarActive`, `sidebarStrong`, `border`, `muted`, `success`, `warning`, and `danger`.

The default text-based `Newl Apps` mark lives in `src/branding/tenant-branding.ts`. Future SaaS tenants should load branding from tenant-scoped settings instead of relying on the default internal Newl theme.

## Branding Status

Current theme uses the provided Newl color swatch as its source palette: Mandy `#EB4464`, Oxford Blue `#3C445B`, Azalea `#F9C7CF`, and Shuttle Gray `#545C6C`. Production logo assets and final usage rules should still be confirmed before production use.

Raw brand source tokens are centralized in `src/app/globals.css`; components should continue using semantic tokens only so the theme can be swapped by editing one token section.

## Reference

- Project instructions: `AGENTS.md`
- Product operating brief and PR milestones: `reference/PRODUCT_OPERATING_BRIEF.md`
- Lead generation rebuild source of truth: `reference/OPENCLAW_LEAD_GEN_SPEC.md`
- OpenClaw/n8n ingestion API contract: `reference/OPENCLAW_N8N_INGESTION_API.md`
- Initial migration plan: `reference/MIGRATION_PLAN.md`
