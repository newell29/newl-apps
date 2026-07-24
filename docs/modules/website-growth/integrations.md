# Website growth and SEO: Integrations

> Evidence status: Confirmed from code for file locations and schema references; business workflow details not explicitly encoded are marked Requires employee confirmation.

## Purpose and status

Website growth and SEO is documented because code, routes, schema, or tests were located. Main evidence: `src/app/(authenticated)/website-growth/*`, `src/modules/website-growth/*`, website growth Prisma models/tests.

## Implemented Scout integrations

- Search Console and GA4 use the existing server-side Google API credentials and save 28-day tenant-scoped metrics.
- Website forms are reduced to counts by page and primary need before Scout sees them. Names, email addresses, phone numbers, and message bodies are excluded.
- SEMrush uses `https://mcp.semrush.com/v1/mcp` through official OAuth in the Codex runtime. Newl Apps does not hold the OAuth token and stores only capped, sanitized evidence rows under the existing SEMrush data source with `transport: official_mcp_oauth` metadata.
- Microsoft Teams delivery runs through the configured OpenClaw Teams account. Newl Apps constructs the message and review links deterministically; Codex cannot choose a recipient or send a message.
- The weekly runner uses Teams' native document attachment support to deliver the SEO performance workbook and, when needed, the SEMrush keyword-import workbook to the same configured target.
- Position Tracking remains read-only through official SEMrush MCP. Newl Apps stores the sanitized weekly snapshot and automatically prepares import rows from approved/built/published Scout briefs after case-insensitive keyword deduplication. Direct SEMrush mutation requires separate Business/API access and is not part of this workflow.
- Scout machine routes use the dedicated `OPENCLAW_WEBSITE_GROWTH_TOKEN` and configured tenant slug.
- Backlink discovery uses the same official read-only Semrush MCP session. Newl Apps receives only the curated prospect contract and aggregate reject counts, never the raw backlink inventory.
- Approved backlink execution uses a separate `OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN`. The executor claim route excludes paid placements and returns only tenant-scoped, human-approved records.
- True outbound automation additionally requires an owner-approved public business profile and dedicated outreach mailbox. Those values belong in the protected OpenClaw runtime, not in Scout output, Teams, source control, or Semrush.

## Workflow / rules summary

- Entry points are protected authenticated pages and/or API routes for this module.
- Server-side pages and mutating APIs should validate tenant context and module entitlement before data access.
- Data persistence uses tenant-scoped Prisma models where a database model exists.
- External calls use `src/server/integrations/*` or module-specific integration helpers. Secret values are not documented here.
- Approval, printing, posting, and live external writes require human approval unless a code path explicitly enforces a safe dry-run.

## Data model

Relevant tables and enums are in `prisma/schema.prisma`. Operationally important fields include primary `id`, `tenantId` where present, status enums, foreign keys to tenant/user/module, timestamps, metadata JSON, and unique/index constraints declared in Prisma.

```mermaid
flowchart LR
  UI[Authenticated UI/API] --> Auth[Auth + module guard]
  Auth --> Service[Module service]
  Service --> DB[(Tenant-scoped Prisma tables)]
  Service --> Ext[External services when configured]
```

## Permissions

Roles and defaults are in `src/server/auth/role-policy.ts`. Runtime checks are in `src/server/auth/authorization.ts`; gaps should be treated as requiring code review before enabling production writes.

## Failure modes

Expected failures include missing tenant entitlement, read-only mutation attempts, validation errors, missing integration credentials, duplicate records, empty parser results, external API errors, timeouts, and partial job completion. Recovery should use module UI review screens, audit/job records, and documented dry-run scripts before live writes.

## Testing

Relevant tests are under `tests/` and generally named after the module. Recommended checks: `npm test`, `npm run lint`, `npm run typecheck`, and targeted route/service tests. Live integration scripts must not be run without explicit approval and safe credentials.

## Source map

| Responsibility | Main files | Supporting files | Tests |
|---|---|---|---|
| UI and routes | See evidence paths above | `src/components/app-shell.tsx` | module-named tests under `tests/` |
| Services/actions/queries | `src/modules/website*` or evidence paths above | `src/server/*` | module-named tests |
| Schema | `prisma/schema.prisma` | `prisma/migrations/*` | schema-dependent unit tests |

## Open questions

- Which status values map to employee-approved business language? Requires employee confirmation.
- Which write actions should require two-person approval? Requires owner confirmation.
- Which external integration credentials should be moved from env fallback to tenant-scoped settings first? Requires owner confirmation.
