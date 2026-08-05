# Architecture overview

> Evidence status: Confirmed from code.

Newl Apps is a Next.js 15 / React 19 internal business platform backed by PostgreSQL through Prisma. Auth.js v5 provides Microsoft Entra ID SSO and database sessions; local dev bypass and temporary password login exist behind environment gates. The platform is multi-tenant: `Tenant`, `Membership`, module entitlement, integration credential, audit, job, and business records are tenant-scoped in `prisma/schema.prisma`.

## Primary technologies

| Area | Evidence |
|---|---|
| Frontend/backend | Next.js app router in `src/app`, shared React components in `src/components`, module UI in `src/modules/*/components*`. |
| Database/ORM | PostgreSQL datasource and Prisma models in `prisma/schema.prisma`; migrations in `prisma/migrations`. |
| Auth | `src/server/auth/auth.config.ts`, `src/server/tenant-context.ts`, `src/middleware.ts`. |
| Permissions | `src/server/auth/authorization.ts`, `src/server/auth/role-policy.ts`, settings access code in `src/modules/settings`. |
| Hosting/build | `next.config.ts`, `scripts/vercel-build.ts`, `.github/workflows/*migrations.yml`, `docs/deployment.md`. |
| Tests | Vitest suites in `tests/`; package scripts in `package.json`. |

## High-level request flow

```mermaid
flowchart LR
  User[Employee browser] --> Next[Next.js route]
  Next --> Auth[getAuthenticatedContext]
  Auth --> Membership[Membership lookup]
  Next --> Guard[requireModule / requireMutationAccess]
  Guard --> Module[Module service/action]
  Module --> Prisma[Prisma tenant-scoped query]
  Prisma --> DB[(PostgreSQL)]
  Module --> Integrations[External integrations when configured]
```

## High-level data flow

```mermaid
flowchart TB
  TradeMining --> IngestionAPI[/TradeMining ingestion API/]
  Website[Website forms/Search Console uploads] --> WebsiteModules[Website modules]
  Graph[Microsoft Graph mail] --> GarlandEmail[Garland email intake]
  GarlandPDF[Garland PDFs] --> Parser[PDF/text parsers]
  Teamship --> Review[Teamship review and sync]
  QuickBooks --> Finance[Cashflow and invoice automation]
  Apollo --> LeadGen[Lead enrichment/outreach]
  OpenAI[OpenAI or local LLM] --> Assistant[Company Assistant]
  Assistant --> Knowledge[(Assistant knowledge/memory)]
  Codex[Codex] --> Git[Branches and PRs]
```

## Module map

Confirmed module keys: `ASSISTANT`, `LEAD_GEN`, `UPS_TOOLS`, `LTL_RATE_PORTAL`, `TRANSIT_LOOKUP`, `SHIPMENT_DOCUMENTS`, `INVOICE_VERIFICATION`, `QUICKBOOKS_POSTING`, `CUSTOMER_CASHFLOW`, `WEBSITE_INBOUND`, `WEBSITE_GROWTH`, `OCEAN_FREIGHT_PRICING`, and `CUSTOMER_INTELLIGENCE` in `prisma/schema.prisma`.

## Customer Intelligence

The `CUSTOMER_INTELLIGENCE` module is a leadership-only foundation (see `docs/modules/customer-intelligence/overview.md`). It adds tenant-scoped `OperatingCompany`, `CompanyOperatingRelationship`, `CustomerSourceAccount`, `ContactPoint`, `ContactEvidence`, `CustomerIdentityMatch`, `QuickBooksServiceMappingRule`, `CustomerFxRate`, `CustomerRevenueLine`, and `CustomerMonthlyFinancial` records around the canonical `Company`. It is additive: the legacy `CashflowLegalEntity` / `CashflowCustomer` finance records are preserved and resolved through operating-company relationships in later phases. The `20260805150000_customer_intelligence_corrections` migration bootstraps the module record, the `newl-group` entitlement, and the three Newl operating companies so the module is deployable through `prisma migrate deploy` without the development seed.

## Major security boundaries

- User sessions are distinct from machine ingestion tokens (`src/server/ingestion-auth.ts`).
- Role access and tenant entitlements are enforced server-side in `requireModule`.
- Read-only users are blocked from mutations by `requireMutationAccess`.
- Integration credentials should be tenant scoped through `IntegrationCredential`; several runtime fallbacks still use environment variables.
