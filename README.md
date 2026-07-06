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
- Found Companies review queue that reviews TradeMining-sourced companies before any sales pipeline handoff.
- Contacts foundation for person-level records under approved Pipeline accounts.
- Contact sequence override and optional Tier 1 draft preview foundation, using mock/local content only.
- Minimal app shell with dashboard, search profiles, Found Companies, pipeline, contacts, settings, and job/audit log pages.
- Tenant-safe query helpers that require a tenant context for business data access.
- Authentication layer: Auth.js v5 with Microsoft Entra ID SSO (production) and optional dev bypass (local only).
- Login page at `/login`, middleware session-cookie gate, and `(authenticated)` layout with database-backed membership validation.
- Role enforcement via `ROLE_MATRIX` and authorization helpers (`requireModule`, `requireMutationAccess`, `requireRole`, `requireAdmin`).

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

`postinstall` runs `prisma generate` so the Prisma client is present after install.

2. Copy environment placeholders:

```bash
cp .env.example .env
```

3. Set `DATABASE_URL` and auth placeholders in `.env`:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/newl_apps
DEFAULT_TENANT_SLUG=newl-group

# Required for Auth.js sessions (generate with: npx auth secret)
AUTH_SECRET=AUTH_SECRET_PLACEHOLDER
AUTH_URL=http://localhost:3000
AUTH_TRUST_HOST=true

# Enable local email/password login (never use in production)
AUTH_DEV_BYPASS=true
SEED_ADMIN_PASSWORD=newl-dev-password
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

Open [http://localhost:3000](http://localhost:3000). Unauthenticated visitors are redirected to `/login`.

### Authentication & Local Login

Production login uses **Microsoft Entra ID SSO**. Users must be admin-provisioned (`User` + `Membership`) before they can sign in; there is no self-signup.

For local development, set `AUTH_DEV_BYPASS=true` (with `NODE_ENV=development`) to show the dev login form on `/login`. After seeding, sign in with:

| Email | Role |
|-------|------|
| `admin@example.com` | Admin |
| `sales@example.com` | Sales |
| `readonly@example.com` | Read Only |

Password: the value of `SEED_ADMIN_PASSWORD` (defaults to `newl-dev-password` when unset).

To test production-like SSO locally, configure Entra env vars from `.env.example` (`AUTH_MICROSOFT_ENTRA_ID_*` or `AZURE_AD_*` aliases) and set `AUTH_DEV_BYPASS=false`.

See `reference/AUTH_AND_TENANT_CONTEXT.md` for Entra callback URLs, provisioning model, and authorization details.

## Scripts

- `npm run dev` - start the Next.js dev server.
- `npm run build` - build the production app.
- `npm run lint` - run ESLint.
- `npm run typecheck` - run TypeScript without emitting files.
- `npm run prisma:generate` - generate the Prisma client.
- `npm run prisma:migrate` - run Prisma migrations locally.
- `npm run prisma:seed` - seed the first tenant and mock/sample data.
- `npm test` - run Vitest unit tests (authorization, tenant context, dev bypass gate).
- `npm run verify:auth` - live DB verification of seeded users, cross-tenant isolation, and role gating (requires a seeded database).

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

Found Companies is the required review queue between ingestion and Pipeline. Ingested TradeMining records are preserved as raw records, normalized into tenant-scoped companies, ranked with deterministic scoring, and shown for human review. Companies are not moved into the sales pipeline by ingestion. Marking a found company as approved creates the first tenant-scoped `Lead` record in the initial pipeline stage; rejecting or disqualifying keeps it out of the active sales workflow.

The Pipeline page is for approved accounts being worked by sales. It intentionally shows only tenant-scoped `Lead` records created through Found Companies approval, not unapproved TradeMining companies. Apollo contact enrichment, contact ranking, sequence recommendations, and sequence enrollment are visible as workflow placeholders and must remain explicit future milestones before any live outreach automation is added.

Contacts are person-level records attached to approved Pipeline accounts. Apollo will populate and enrich contacts in a later milestone; Newl Apps will cache contact snapshots, review status, score, tier, reply/cadence summaries, and audit history. Apollo should remain the future execution system for outreach/cadences, while company and pipeline summaries roll up from contact-level status.

Newl Apps recommends a default sequence/cadence for each contact based on contact tier and simple deterministic fit signals. Sales reps can override the selected sequence when needed, and sequence changes are audited tenant-safely. Tier 1 contacts can have optional Newl Apps draft previews for subject/body review and editing; reviewing those drafts is not mandatory before a future Apollo push. Tier 2 contacts generally rely on Apollo sequence/template drafting later. No Apollo calls, OpenAI/live AI calls, email sends, or sequence enrollments are made by the current Contacts foundation.

Planned boundaries:

- Apollo company/contact matching and sequence push.
- TradeMining import and BOL normalization.
- Google Sheets legacy import/export.
- QuickBooks posting.
- UPS tools.
- OpenClaw legacy operations reporting.
- Website inbound form submission capture.

## Website Inbound

The Website Inbound module stores public website form submissions inside Newl Apps.
It is tenant-scoped, Prisma/PostgreSQL-backed, and protected by the same module
permission system as the other app areas.

- Authenticated review UI: `/website-inbound`
- Public website submission endpoint: `POST /api/website-inbound`
- Required production token: `WEBSITE_INBOUND_API_TOKEN`
- Tenant routing: `WEBSITE_INBOUND_TENANT_SLUG` (falls back to `DEFAULT_TENANT_SLUG`, then `newl-group`)

The module appears in Settings under Role Module Visibility as `Website Inbound`.
Admins can decide which roles can see the page. Read-only users may view it when
enabled but cannot update submission status.

## Tenant Safety

All tenant-owned business tables include `tenantId`. Relations between tenant-owned lead generation records use composite tenant-scoped foreign keys where Prisma can enforce them, such as lead/contact/company links.

Tenant context is resolved from the authenticated session via `getAuthenticatedContext()` in `src/server/tenant-context.ts`: session → User → Membership → Tenant. Role and tenant are re-validated from the database on every request; they are not trusted from the session alone. `getCurrentTenantContext()` is a thin wrapper for callers that only need the tenant subset.

Some cross-cutting fields, such as `AuditLog.actorUserId` and `Lead.ownerUserId`, are stored as IDs without relations. Service code must validate those IDs through tenant membership before writing them.

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
- Auth and tenant context (detailed): `reference/AUTH_AND_TENANT_CONTEXT.md`
- OpenClaw/n8n ingestion API contract: `reference/OPENCLAW_N8N_INGESTION_API.md`
- Initial migration plan: `reference/MIGRATION_PLAN.md`
