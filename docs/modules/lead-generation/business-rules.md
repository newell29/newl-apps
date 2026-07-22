# Lead generation, contacts, TradeMining, Apollo outreach: Business Rules

> Evidence status: Confirmed from code for file locations and schema references; business workflow details not explicitly encoded are marked Requires employee confirmation.

## Purpose and status

Lead generation, contacts, TradeMining, Apollo outreach is documented because code, routes, schema, or tests were located. Main evidence: `src/app/(authenticated)/lead-gen/*`, `src/modules/lead-gen/*`, `src/modules/trademining/ingestion.ts`, Apollo integration files, lead/contact/company Prisma models.

## Workflow / rules summary

- Entry points are protected authenticated pages and/or API routes for this module.
- Server-side pages and mutating APIs should validate tenant context and module entitlement before data access.
- Data persistence uses tenant-scoped Prisma models where a database model exists.
- External calls use `src/server/integrations/*` or module-specific integration helpers. Secret values are not documented here.
- Approval, printing, posting, and live external writes require human approval unless a code path explicitly enforces a safe dry-run.

## TradeMining search profile execution

- Every enabled TradeMining search profile is run once daily by Hunter after its configured local run time.
- `lookbackWindowDays` controls the full trailing TradeMining query window for that individual profile.
- Each daily profile run submits one BOL search containing every configured destination port, origin country, origin port, ship-from port, product keyword, HS code, and minimum-TEU rule.
- The legacy database field `minShipmentVolume` represents minimum TEUs per BOL and is posted to TradeMining as `TEU >= value`.
- A company qualifies for Found Companies only when its shipment evidence for the matched profile, within that profile's lookback window, meets `minShipmentCount`.
- Search profile frequency is a legacy database compatibility field fixed to `daily`; it is not editable and does not control the worker.
- Newl Apps is the source of truth for enabled profiles. Deleting a profile cancels its pending immediate-run requests, and Hunter reloads the enabled profile list before execution so deleted or disabled profiles do not receive future searches.

## Scoring and outreach safety

- Company scoring uses only tenant-scoped TradeMining evidence inside the matched search profile's own `lookbackWindowDays`. The scoring-level lookback is a fallback for unmatched or legacy imports and must cover the recent plus comparison windows.
- Shipment evidence queries are date bounded but not row capped. This prevents arbitrary 25-, 100-, or 250-record limits from changing a score for high-volume companies.
- The matched profile's `minShipmentCount` is a qualification gate for Found Companies; it is not replaced by the fallback scoring lookback.
- Contacts marked `DO_NOT_CONTACT` or `REJECTED` receive score `0`, remain `UNRANKED`, and cannot be assigned a cadence.
- Only contacts explicitly marked `APPROVED` can be queued for Apollo. The queue worker rechecks the contact and blocks companies marked `doNotProspect`, `REJECTED`, or `DISQUALIFIED` before any external write.
- The Contacts directory includes both assigned and unassigned contacts attached to pipeline accounts. Unassigned contacts remain filterable and reviewable, but Apollo queueing is blocked until a sales rep is assigned.
- Contact title and department matching uses normalized phrase boundaries. Sales, business-development, and customer-service roles are deprioritized by default, while a preferred logistics/operations match takes precedence for mixed-function titles.
- Scoring settings reject invalid window combinations, company weights that do not total exactly 100 points, non-descending contact tiers, and incomplete or inverted mid-market TEU ranges.
- Score history is immutable and event-driven. Company opportunity scores are captured after TradeMining ingestion and pipeline approval; contact relevance scores are captured when Apollo status is synchronized or a push is attempted. Opening a page does not create history.
- Every score snapshot records the scoring model version, a deterministic fingerprint of the full scoring configuration, the matched search profile when available, an explanation, and the evidence date. This allows later outcomes to be compared against the score that was actually used.
- Candidate decisions, pipeline stage changes, Apollo cadence enrollment, sequence status changes, and reply status changes are stored as tenant-scoped outcome events.
- Each new outcome links to the latest applicable score snapshot for the same tenant and subject at or before the outcome time. Contact outcomes use contact-relevance snapshots; company and pipeline outcomes use company-opportunity snapshots. Outcomes remain unlinked when no earlier snapshot exists.
- Apollo reply data is refreshed when a user selects contacts and runs **Sync Apollo status**, and during the immediate Apollo lookup used to verify a push. There is currently no scheduled tenant-wide Apollo reply sync. Push-job polling only rechecks pending cadence enrollment and is not a general reply refresh.
- The scoring-history migration is additive and performs no score backfill. Historical reporting begins after the migration is deployed; current Company, Contact, Lead, and TradeMining records are not rewritten.

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
| Services/actions/queries | `src/modules/lead*` or evidence paths above | `src/server/*` | module-named tests |
| Schema | `prisma/schema.prisma` | `prisma/migrations/*` | schema-dependent unit tests |

## Open questions

- Which status values map to employee-approved business language? Requires employee confirmation.
- Which write actions should require two-person approval? Requires owner confirmation.
- Which external integration credentials should be moved from env fallback to tenant-scoped settings first? Requires owner confirmation.
