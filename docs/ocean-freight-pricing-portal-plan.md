# Ocean Freight Pricing Portal Implementation Plan

Generated: 2026-07-07

## Executive Summary

Build an Ocean Freight Pricing Portal as a separate tenant-safe Newl Apps module for consolidating ocean freight rates received from overseas agents and forwarders. The MVP should ingest relevant mail from `pricing@newlgroup.com` through the existing Microsoft Graph setup, extract candidate ocean rates from email body text and attachments where practical, stage AI-assisted extraction results for human review, and publish only approved records into a searchable internal rate table.

The module should not be a one-off mailbox scraper. It should use the existing platform patterns:

- Authenticated app pages under `src/app/(authenticated)`.
- Tenant context from `getAuthenticatedContext()`.
- Module entitlements through `Module`, `TenantModuleAccess`, `TenantRoleModuleAccess`, and `requireModule`.
- Mutations protected by `requireMutationAccess`.
- Microsoft 365 configuration through tenant-scoped `IntegrationCredential` records.
- Background/process state through `AutomationJobRun`, mailbox sync state patterns, and `AuditLog`.
- Existing internal table/filter/card UI patterns from Lead Gen, Customer Cashflow, UPS Tools, and LTL Rate Portal.

Recommended first implementation PR: add the module entitlement, schema, seed/module access, server-side query/action skeletons, and the first read-only portal shell with seeded/manual sample data support. Follow with ingestion/review in a second PR so schema and permissions can be validated before mailbox processing and AI extraction are introduced.

## Current Repo Findings

### Platform Shape

- The app is a Next.js application with Prisma/PostgreSQL and Auth.js v5.
- The repository uses a multi-tenant model. `Tenant`, `Membership`, `Module`, `TenantModuleAccess`, `TenantRolePolicy`, and `TenantRoleModuleAccess` are already present in `prisma/schema.prisma`.
- The current role set is `ADMIN`, `MANAGER`, `SALES`, `OPERATIONS`, `FINANCE`, and `READ_ONLY`.
- Protected pages live under `src/app/(authenticated)`.
- Public pages live under `src/app/(public)`.
- Module pages consistently call `getAuthenticatedContext()` and then `requireModule(context, ModuleKey.X)`.
- Server mutations call `requireMutationAccess(context)`.
- Shared app navigation lives in `src/components/app-shell.tsx`.
- Settings are centralized at `src/app/(authenticated)/settings/page.tsx` and backed by `src/modules/settings/queries.ts` plus `src/modules/settings/actions.ts`.

### Existing Module Patterns

Useful references:

- `src/modules/lead-gen/*`
  - Mature table/filter workflows, review states, tenant-safe queries, and human approval flows.
- `src/modules/ltl-rate-portal/*`
  - Separate operational module, quote request/result types, dry-run/live split, bulk jobs, CSV parsing, and tenant-scoped 7L configuration.
- `src/modules/ups-tools/*`
  - Quote tools, CSV helpers, dry-run quote engine, bulk-job persistence in `AutomationJobRun`.
- `src/modules/customer-cashflow/*`
  - Finance/customer-facing operational tables, filters, statuses, tabs, and action workflows.
- `src/modules/assistant/*`
  - Microsoft 365 sync, assistant provider abstraction, knowledge indexing, AI runtime, and audit-oriented assistant runs.

### Database And Job Patterns

- `IntegrationCredential` stores tenant-scoped integration settings and optional `secretRef`.
- `AuditLog` stores tenant-scoped action history with `actorUserId`, `before`, and `after`.
- `AutomationJobRun` is the shared job-run table with `tenantId`, `jobType`, `status`, `input`, `output`, and `errorMessage`.
- LTL and UPS bulk jobs use job type strings such as `ltl-rate-portal.bulk-quote` and `ups-tools.bulk-rate-quote`.
- LTL uses a dedicated child table, `LtlBatchQuoteLane`, for row-level results while keeping high-level job status in `AutomationJobRun`.
- Assistant mailbox sync uses `AssistantMailboxSyncState` for resumable mailbox pagination and per-mailbox status.

### Auth And Permissions

- `src/server/auth/role-policy.ts` defines default role/module access.
- `src/server/auth/authorization.ts` enforces role access plus tenant module entitlement.
- `(authenticated)/layout.tsx` resolves allowed enabled modules and passes them to `AppShell`.
- Settings can override role access per tenant using `TenantRoleModuleAccess`.
- There is no dedicated `PRICING` role today. The practical MVP should use existing roles and role-module overrides.

### Existing Pricing/Rate Modules

- UPS Tools and LTL Rate Portal are separate modules.
- Assistant rate tools currently understand UPS and LTL, not ocean.
- `src/modules/assistant/rate-tool-knowledge.ts` indexes UPS/LTL job runs as assistant knowledge.
- LTL has a planning precedent in `docs/LTL_RATE_PORTAL_IMPLEMENTATION_PLAN.md`.

## Existing Microsoft Graph Setup Findings

The Microsoft Graph setup is already substantial and should be reused.

### Tenant Settings

Files:

- `src/server/integrations/microsoft-graph.ts`
- `src/server/integrations/microsoft-graph-account.ts`
- `src/server/integrations/microsoft-graph-application.ts`
- `src/modules/settings/actions.ts`
- `src/modules/settings/queries.ts`
- `src/app/(authenticated)/settings/page.tsx`

Current capabilities:

- Tenant-scoped Microsoft 365 settings are stored in `IntegrationCredential` with provider `MICROSOFT_GRAPH` and name `Microsoft 365 Assistant`.
- Settings include:
  - `mailboxAccessMode`: `SIGNED_IN_USER` or `ADMIN_SELECTED_MAILBOXES`
  - `adminMailboxTargets`
  - `mailLookbackDays`
  - `maxMailMessagesPerMailbox`
  - `mailSyncEnabled`
  - `fileSyncEnabled`
  - `draftingEnabled`
- The Settings UI already supports admin-selected mailbox targets.
- The current placeholder examples use shared mailboxes such as dispatch/warehouse/sales. The ocean module should add or document `pricing@newlgroup.com` as an admin-selected target for the Newl tenant without hardcoding it in business logic.

### Delegated And Application Access

Current capabilities:

- Delegated access uses the Microsoft Entra Auth.js account and refresh token.
- Application mailbox access uses client credentials through `getMicrosoftGraphApplicationAccessToken()`.
- Cross-mailbox sync requires application permissions and an Exchange mailbox access policy.
- Existing runtime checks already distinguish delegated access from admin-selected mailbox access.

### Existing Mail Sync Behavior

File:

- `src/modules/assistant/microsoft-graph-sync.ts`

Current behavior:

- Fetches recent messages with Graph fields:
  - `id`
  - `subject`
  - `bodyPreview`
  - `body`
  - `webLink`
  - `internetMessageId`
  - `conversationId`
  - `receivedDateTime`
  - `from`
  - `toRecipients`
  - `ccRecipients`
- Requests plain text body with `Prefer: outlook.body-content-type="text"`.
- Supports selected mailboxes through `users/{mailbox}/messages`, with fallback user-id resolution.
- Stores mailbox sync progress in `AssistantMailboxSyncState`.
- Maps emails into `AssistantKnowledgeDocument` and assistant memories.
- Does not currently fetch attachments for message processing.
- Does not currently create domain-specific business records from Microsoft mail.

### Graph Implications For Ocean Pricing

The ocean module should reuse the token acquisition, mailbox target settings, and resumable mailbox paging ideas, but should not reuse the assistant knowledge destination as the production data store.

Recommended approach:

- Add ocean-specific ingestion functions that call the same Graph token helpers.
- Use existing `MICROSOFT_GRAPH` tenant settings to locate allowed mailboxes.
- Require the target mailbox to be configured in tenant settings, defaulting operationally to `pricing@newlgroup.com` for Newl seed/setup.
- Fetch email metadata and body text into ocean source tables.
- Add attachment fetching through Microsoft Graph:
  - `GET /users/{mailbox}/messages/{messageId}/attachments`
  - Fetch `fileAttachment.contentBytes` for small files.
  - Store metadata and a content hash; store extracted text/rows where needed.
- Keep raw source and AI extraction separate from approved rate records.

## Proposed MVP Scope

MVP should include:

1. New tenant-enabled module: Ocean Freight Pricing Portal.
2. Settings/admin readiness:
   - Module entitlement.
   - Reuse Microsoft 365 settings and require `pricing@newlgroup.com` or another tenant-configured mailbox target.
3. Email ingestion:
   - Pull messages from configured pricing mailbox targets.
   - Detect likely ocean-rate emails.
   - Store source email metadata.
   - Store normalized body text excerpts and attachment metadata.
   - Parse attachment text/rows where possible.
4. AI-assisted extraction:
   - Create candidate extraction records in staging.
   - Do not publish directly to active rates.
   - Preserve AI model/input/output metadata.
5. Review workflow:
   - Pricing users approve, edit, or reject candidates.
   - Approved candidates become production rates.
6. Searchable rate table:
   - Active rates by default.
   - Optional expired/historical filter.
   - Filters by lane, equipment, agent, shipping line, validity, currency/range, and rating.
7. Agent directory:
   - Agent companies and contacts inferred from emails and manual edits.
   - Internal rating and service/reliability notes.
   - Active/historical rate counts.
8. Manual rate entry/correction:
   - Add rates received outside the pricing mailbox.
   - Correct extracted rates.
   - Mark inactive.
   - Link rate to agent and source.
   - Record correction notes and audit logs.
9. Traceability:
   - Every approved rate links back to source email, attachment, manual entry, or future source.
   - Audit trail of raw input, candidate extraction, user edits, and approval.

## Explicit Out-of-Scope Items For MVP

Do not build in the first MVP:

- External agent portal login.
- Customer portal login, quoting, or booking.
- Direct customer-visible rates.
- Automated publishing of AI-extracted rates without review.
- Booking, shipment creation, carrier tendering, or schedule booking.
- Live sailing schedule integration unless a provider is selected.
- Fully automated outbound sales campaigns.
- Apollo sequence push based on rate advantages.
- Hardcoded Newl-only mailbox logic in business code.
- A new auth system or new tenant model.
- Complex yield management or predictive pricing.
- Contract negotiation workflows.
- Margin approval workflows unless a simple margin field is needed for internal quoting later.

## Recommended Data Model/Schema

Recommended module enum:

```prisma
enum ModuleKey {
  ...
  OCEAN_FREIGHT_PRICING
}
```

Recommended source/status enums:

```prisma
enum OceanRateSourceType {
  EMAIL_BODY
  ATTACHMENT
  MANUAL_ENTRY
  AGENT_PORTAL
}

enum OceanRateStatus {
  ACTIVE
  EXPIRED
  INACTIVE
  SUPERSEDED
}

enum OceanExtractionStatus {
  NEW
  NEEDS_REVIEW
  APPROVED
  REJECTED
  ERROR
}

enum OceanEquipmentType {
  TWENTY_FT
  FORTY_FT
  FORTY_HQ
  FORTY_FIVE_HQ
  LCL
  OTHER
}
```

### `OceanFreightAgent`

Tenant-scoped agent company/directory record.

Fields:

- `id`
- `tenantId`
- `name`
- `normalizedName`
- `website`
- `primaryEmailDomain`
- `countriesServed` Json
- `portsServed` Json
- `lanesServed` Json
- `internalRating` Int?
- `reliabilityNotes`
- `serviceNotes`
- `internalNotes`
- `lastRateReceivedAt`
- `activeRateCount` Int default 0
- `historicalRateCount` Int default 0
- `createdAt`
- `updatedAt`

Indexes:

- `@@unique([tenantId, normalizedName])`
- `@@index([tenantId, internalRating])`
- `@@index([tenantId, lastRateReceivedAt])`

### `OceanFreightAgentContact`

Contacts gathered from emails or manual entry.

Fields:

- `id`
- `tenantId`
- `agentId`
- `fullName`
- `email`
- `phone`
- `title`
- `sourceEmailAddress`
- `lastObservedAt`
- `notes`
- `createdAt`
- `updatedAt`

Indexes:

- `@@unique([tenantId, agentId, email])`
- `@@index([tenantId, email])`
- `@@index([tenantId, agentId])`

### `OceanFreightSourceEmail`

Source email metadata and normalized text for traceability.

Fields:

- `id`
- `tenantId`
- `mailboxAddress`
- `graphMessageId`
- `internetMessageId`
- `conversationId`
- `subject`
- `fromName`
- `fromAddress`
- `toRecipients` Json
- `ccRecipients` Json
- `receivedAt`
- `webLink`
- `bodyPreview`
- `normalizedBodyText`
- `bodyContentHash`
- `rateDetected` Boolean
- `detectionReason`
- `processedAt`
- `createdAt`
- `updatedAt`

Indexes:

- `@@unique([tenantId, mailboxAddress, graphMessageId])`
- `@@index([tenantId, receivedAt])`
- `@@index([tenantId, fromAddress])`
- `@@index([tenantId, rateDetected])`

### `OceanFreightSourceAttachment`

Attachment metadata and extracted content where practical.

Fields:

- `id`
- `tenantId`
- `sourceEmailId`
- `graphAttachmentId`
- `fileName`
- `contentType`
- `sizeBytes`
- `contentHash`
- `storageRef`
- `extractedText`
- `extractedRowsJson`
- `parseStatus`
- `parseError`
- `createdAt`
- `updatedAt`

Indexes:

- `@@unique([tenantId, sourceEmailId, graphAttachmentId])`
- `@@index([tenantId, sourceEmailId])`
- `@@index([tenantId, contentHash])`

### `OceanFreightRateCandidate`

AI or deterministic extraction staging record.

Fields:

- `id`
- `tenantId`
- `sourceType`
- `sourceEmailId`
- `sourceAttachmentId`
- `agentId`
- `agentContactId`
- `status`
- `originPort`
- `originCountry`
- `originRegion`
- `destinationPort`
- `destinationCountry`
- `destinationRegion`
- `equipmentType`
- `equipmentLabelRaw`
- `rateAmount` Decimal?
- `currency`
- `agentCompanyNameRaw`
- `agentContactNameRaw`
- `agentContactEmailRaw`
- `shippingLine`
- `validityStartDate`
- `validityEndDate`
- `freeTimeNotes`
- `detentionDemurrageNotes`
- `transitTimeDays`
- `transitTimeNotes`
- `scheduleNotes`
- `notes`
- `confidence` Int
- `extractionModel`
- `extractionPromptVersion`
- `rawExtractionJson`
- `reviewedAt`
- `reviewedByUserId`
- `rejectionReason`
- `approvedRateId`
- `createdAt`
- `updatedAt`

Indexes:

- `@@index([tenantId, status, createdAt])`
- `@@index([tenantId, originPort, destinationPort])`
- `@@index([tenantId, agentId])`
- `@@index([tenantId, validityEndDate])`

### `OceanFreightRate`

Approved production rate table.

Fields:

- `id`
- `tenantId`
- `agentId`
- `agentContactId`
- `sourceType`
- `sourceEmailId`
- `sourceAttachmentId`
- `sourceCandidateId`
- `originPort`
- `originCountry`
- `originRegion`
- `destinationPort`
- `destinationCountry`
- `destinationRegion`
- `equipmentType`
- `equipmentLabel`
- `rateAmount` Decimal
- `currency`
- `shippingLine`
- `validityStartDate`
- `validityEndDate`
- `status`
- `freeTimeNotes`
- `detentionDemurrageNotes`
- `transitTimeDays`
- `transitTimeNotes`
- `scheduleNotes`
- `notes`
- `correctionNotes`
- `createdByUserId`
- `updatedByUserId`
- `approvedByUserId`
- `approvedAt`
- `inactiveAt`
- `inactiveByUserId`
- `inactiveReason`
- `createdAt`
- `updatedAt`

Indexes:

- `@@index([tenantId, status, validityEndDate])`
- `@@index([tenantId, originPort, destinationPort])`
- `@@index([tenantId, originCountry, destinationCountry])`
- `@@index([tenantId, equipmentType])`
- `@@index([tenantId, agentId])`
- `@@index([tenantId, shippingLine])`
- `@@index([tenantId, currency, rateAmount])`
- `@@index([tenantId, createdAt])`

Important behavior:

- `ACTIVE` should mean manually active and within validity dates.
- Expired rows should remain in `OceanFreightRate`.
- A scheduled or query-time status function should treat `validityEndDate < today` as expired even if the stored status has not yet been updated.

### `OceanFreightRateAudit`

Dedicated change trail if `AuditLog` alone is not enough for field-level rate history.

Fields:

- `id`
- `tenantId`
- `rateId`
- `candidateId`
- `actorUserId`
- `action`
- `before`
- `after`
- `note`
- `createdAt`

Recommendation:

- Use shared `AuditLog` for all MVP actions.
- Add `OceanFreightRateAudit` only if users need a dedicated in-page history timeline with field-level diffs.

### Tenant Relations

Add relations from `Tenant` to:

- `oceanFreightAgents`
- `oceanFreightAgentContacts`
- `oceanFreightSourceEmails`
- `oceanFreightSourceAttachments`
- `oceanFreightRateCandidates`
- `oceanFreightRates`

Add optional relations from `User` to rate review/create/update fields if useful, or use raw user IDs plus `AuditLog` as existing code often does.

## API/Backend Changes

Recommended module path:

- `src/modules/ocean-freight-pricing/`

Recommended files:

- `types.ts`
  - Rate, candidate, filter, agent, and ingestion DTOs.
- `constants.ts`
  - Equipment options, default filters, source labels, status labels.
- `queries.ts`
  - Tenant-scoped rate table query.
  - Candidate review queue query.
  - Agent directory query.
  - Dashboard/shell summary.
- `actions.ts`
  - Manual create/edit/inactivate actions.
  - Candidate approve/reject actions.
  - Agent rating/note update actions.
- `ingestion.ts`
  - Microsoft Graph mailbox fetch orchestration.
  - Rate email detection.
  - Attachment metadata fetch.
  - Source email/attachment upsert.
- `extraction.ts`
  - Deterministic extraction helpers.
  - AI extraction orchestration through existing assistant/OpenAI provider abstraction.
  - Candidate creation.
- `normalization.ts`
  - Port name normalization.
  - Equipment type normalization.
  - Currency/rate parsing.
  - Agent company/contact normalization.
- `audit.ts`
  - Shared helper for consistent `AuditLog` writes.
- `jobs.ts`
  - `OCEAN_FREIGHT_EMAIL_INGESTION_JOB_TYPE = "ocean-freight-pricing.email-ingestion"`.
  - Job create/run/status helpers using `AutomationJobRun`.

Recommended API routes:

- `src/app/api/ocean-freight-pricing/ingest/route.ts`
  - `POST`
  - Authenticated/manual trigger.
  - Requires module and mutation access.
- `src/app/api/ocean-freight-pricing/ingest-step/route.ts`
  - `POST`
  - Optional resumable mailbox processing, similar to assistant sync-step.
- `src/app/api/ocean-freight-pricing/candidates/[candidateId]/approve/route.ts`
  - Optional route if server actions are not enough.
- `src/app/api/ocean-freight-pricing/rates/export/route.ts`
  - Follow-up for CSV export.

For scheduled ingestion:

- Reuse machine-to-machine ingestion auth only if the endpoint is run by n8n/OpenClaw or a server cron.
- Otherwise prefer an authenticated admin/manual trigger first.
- For a scheduled endpoint, add a route similar to `src/app/api/assistant/microsoft-graph/sync/route.ts` that uses `authenticateIngestionRequest(request)` and tenant slug resolution.

## Frontend Pages/Components

Recommended route:

- `src/app/(authenticated)/ocean-freight-pricing/page.tsx`

Navigation:

- Add under Operations Tools in `src/components/app-shell.tsx`.
- Label: `Ocean Freight Pricing`.
- Module key: `OCEAN_FREIGHT_PRICING`.

Recommended module components:

- `components/ocean-freight-pricing-client.tsx`
  - Client table/filter shell.
- `components/rate-table.tsx`
  - Active/historical rates grid.
- `components/rate-filters.tsx`
  - Origin/destination, country/region, equipment, agent, shipping line, validity, amount, status.
- `components/candidate-review-table.tsx`
  - Extracted candidate staging queue.
- `components/rate-editor.tsx`
  - Manual entry and correction form.
- `components/agent-directory-table.tsx`
  - Agent list with active/historical counts.
- `components/agent-detail-panel.tsx`
  - Contacts, notes, lanes, ratings.
- `components/source-email-panel.tsx`
  - Traceback to email metadata/body excerpt/attachment references.
- `components/ingestion-controls.tsx`
  - Manual sync trigger, last job status, mailbox readiness.

Recommended tabs:

- `Rates`
  - Default active rates only.
  - Filter to include expired/inactive.
- `Review Queue`
  - AI/deterministic candidates awaiting approval.
- `Agents`
  - Agent directory and ratings.
- `Sources`
  - Ingested source emails and attachments.
- `Jobs`
  - Recent ingestion/extraction jobs.

UI style:

- Use dense operational layout, not a marketing page.
- Follow current card/table patterns from Lead Gen and Customer Cashflow.
- Keep controls practical: filters, segmented status controls, select inputs, checkboxes, and clear buttons.
- Agent rating should be visible inline in rate rows.
- Use "Schedule not provided" explicitly when no schedule/transit detail exists.

## Permissions/Roles

Recommended default module access:

- `ADMIN`: access and mutate.
- `MANAGER`: access and mutate.
- `OPERATIONS`: access and mutate.
- `SALES`: access, with mutations allowed by current role policy unless tenant overrides disable it.
- `READ_ONLY`: access but no mutations.
- `FINANCE`: no default access unless tenant overrides grant it.

Reasoning:

- The user explicitly named pricing and sales teams as users.
- There is no dedicated `PRICING` role yet.
- `TenantRoleModuleAccess` can narrow or expand per tenant without schema changes.

Implementation:

- Add `ModuleKey.OCEAN_FREIGHT_PRICING`.
- Update `DEFAULT_ROLE_MATRIX` in `src/server/auth/role-policy.ts`.
- Update `ROLE_DESCRIPTIONS` visibility copy if needed.
- Update `tests/authorization.test.ts`.
- All pages and APIs call `requireModule(context, ModuleKey.OCEAN_FREIGHT_PRICING)`.
- All writes call `requireMutationAccess(context)`.

Future:

- If pricing needs finer controls, add action-level policy helpers such as:
  - `canApproveOceanRate`
  - `canEditOceanAgentRating`
  - `canRunOceanIngestion`
- Avoid adding a new `PRICING` role in MVP unless business ownership requires it.

## Email Ingestion Design

### Source Mailbox

Use existing Microsoft Graph settings:

- Tenant admins configure `pricing@newlgroup.com` in Microsoft 365 settings as an admin-selected mailbox target.
- The module should look for pricing mailboxes from a tenant-scoped ocean config, or from the Graph admin mailbox targets.
- Avoid hardcoding `pricing@newlgroup.com`; seed or docs can recommend it for the Newl tenant.

### Ingestion Flow

1. User or scheduled job starts ingestion.
2. Create `AutomationJobRun` with job type `ocean-freight-pricing.email-ingestion`.
3. Load tenant Microsoft Graph settings through `parseMicrosoftGraphSettings`.
4. Require `mailboxAccessMode = ADMIN_SELECTED_MAILBOXES` for shared pricing mailbox ingestion.
5. Acquire application token via existing `getMicrosoftGraphApplicationAccessToken()`.
6. Resolve mailbox path with existing logic or shared utility extracted from assistant sync.
7. Fetch messages in a lookback window.
8. Detect likely rate emails.
9. Upsert `OceanFreightSourceEmail`.
10. Fetch attachments for likely rate emails.
11. Upsert `OceanFreightSourceAttachment`.
12. Extract body/attachment candidate rates.
13. Create `OceanFreightRateCandidate` rows.
14. Update job output/progress.
15. Write `AuditLog` rows for start, completion, and failure.

### Rate Email Detection

Use deterministic rules first:

- Subject/body includes terms such as:
  - ocean rate
  - freight rate
  - FCL
  - LCL
  - 20GP
  - 40GP
  - 40HQ
  - 45HQ
  - validity
  - valid until
  - POL
  - POD
  - port to port
  - carrier
  - shipping line
  - free time
  - demurrage
  - detention
  - promo
  - promotion
  - rate sheet
- Attachments include likely spreadsheet/PDF names.
- Sender domain is known or previously observed agent domain.

Add AI classification only after deterministic prefiltering:

- Classify ambiguous emails as rate-related or not.
- Store classification confidence and reason.
- Do not discard permanently; store `rateDetected=false` with reason for later review.

### Attachments

MVP attachment support should be practical:

- CSV: parse with existing CSV helper patterns from UPS/LTL.
- XLSX/XLS: likely requires adding a spreadsheet parser dependency or using a server-side extraction library. Plan as MVP if dependency is acceptable; otherwise put full Excel parsing in PR 2.
- PDF: existing app has `pdf-lib` and `pdfjs-dist`, but PDF table extraction can be unreliable. Start with text extraction only and send extracted text to the candidate extractor.
- Images/scans: out of scope for MVP unless OCR is added later.

Attachment storage:

- Do not store secrets.
- Store attachment metadata, content hash, and extracted text/rows.
- If binary retention is required, add a tenant-scoped file storage primitive instead of storing large bytes in the database.

## AI Extraction/Staging/Review Workflow

The extraction workflow must be review-first.

1. Ingest raw email metadata/body/attachments.
2. Run deterministic extraction:
   - Dates.
   - Currency.
   - Equipment labels.
   - Common POL/POD patterns.
   - Shipping line labels.
3. Run AI extraction for body text and attachment text when deterministic extraction is insufficient.
4. Save AI result to `OceanFreightRateCandidate`.
5. Show candidate in Review Queue.
6. User edits fields and approves or rejects.
7. Approved candidate creates or updates `OceanFreightRate`.
8. Rejected candidate remains in staging for audit and model improvement.

AI safety requirements:

- Never publish AI-extracted rates directly.
- Store model name, prompt version, raw extracted JSON, confidence, and source ids.
- Store user edits separately from raw extraction.
- Prefer strict JSON schema output.
- Validate all required fields before approval:
  - origin port
  - destination port
  - equipment type
  - rate amount
  - currency
  - agent
  - validity end date
- Flag missing schedule as `scheduleNotes = "Schedule not provided"` or a null schedule with UI fallback.

Recommended provider:

- Reuse existing assistant/OpenAI provider abstractions in `src/server/integrations/assistant-provider.ts` and `src/server/integrations/openai.ts`.
- Keep prompts server-side.
- Use a dedicated prompt version such as `ocean-rate-extraction-v1`.
- Add tests with fixed extraction samples; avoid live model dependency in unit tests.

## Manual Entry Workflow

Manual rate entry should be first-class because not all rates arrive through `pricing@newlgroup.com`.

Workflow:

1. User opens `Add rate`.
2. User selects or creates an agent.
3. User enters lane:
   - origin port/country/region
   - destination port/country/region
   - equipment type
   - amount/currency
   - shipping line
   - validity dates
   - free time/detention/demurrage notes
   - transit/schedule notes
   - general notes
4. User sets source type:
   - `MANUAL_ENTRY`
   - Optional free-text external source note.
5. Save creates `OceanFreightRate`.
6. Save writes `AuditLog` action `ocean-freight.rate.created`.

Correction workflow:

1. User opens rate detail/edit panel.
2. User changes fields and provides correction notes.
3. Save writes `before` and `after` to `AuditLog`.
4. If correction changes lane/equipment/amount/validity, preserve updated timestamp and actor.

Inactive workflow:

1. User chooses `Mark inactive`.
2. User enters reason.
3. Rate status becomes `INACTIVE`.
4. Audit log captures actor/reason.

## Agent Directory Workflow

Agent directory should connect email extraction, manual entry, and rate table usability.

Agent creation sources:

- Sender domain/name from source emails.
- AI-extracted company names.
- Manual user creation.
- Future agent portal account association.

Agent matching:

- Normalize company names.
- Use sender email domain as a strong signal.
- Avoid auto-merging low-confidence matches; stage possible duplicates for review later.

Agent contact creation:

- From email `from` name/address.
- From signature phone numbers in body text.
- From manual edits.
- From future portal users.

Agent metrics:

- `lastRateReceivedAt`
- active rate count
- historical rate count
- lanes/ports served
- countries/regions served

Agent rating:

- Store `internalRating` as an integer scale, likely 1-5.
- Show rating in rate table.
- Allow notes for reliability, service quality, response quality, and lane specialization.
- Audit changes to rating and notes.

## Active Vs Expired Rate Handling

Default table behavior:

- Show only active, non-expired rates.
- A rate is active when:
  - `status = ACTIVE`
  - `validityStartDate <= today` if start date exists
  - `validityEndDate >= today` if end date exists

Historical behavior:

- Expired rates remain in the database.
- Filters allow:
  - Active only
  - Expired only
  - Inactive
  - Include all historical
- Historical rates support comparisons, trend analysis, and future pricing intelligence.

Status update options:

- Query-time computed status is safest for MVP.
- Optional daily job can mark expired rows as `EXPIRED` for faster filtering and clearer status.
- Manual `INACTIVE` should override computed active status.

Recommended UI:

- Use a status pill:
  - Active
  - Expired
  - Inactive
  - Future valid
- For missing validity end date, show `Needs validity` and keep candidate out of production unless a user explicitly approves with a warning.

## Audit Trail And Traceability

Traceability requirements:

- Every rate must show source:
  - email body
  - attachment
  - manual entry
  - future agent portal
- Email-derived rates must link to:
  - mailbox address
  - Graph message ID
  - internet message ID
  - received date
  - sender
  - subject
  - Graph web link if available
  - attachment id/name if applicable
- Candidates must preserve:
  - raw AI output
  - model/prompt version
  - confidence
  - original source ids
  - user review decision
- Production rate updates must write `AuditLog`.

Recommended `AuditLog` actions:

- `ocean-freight.ingestion.started`
- `ocean-freight.ingestion.completed`
- `ocean-freight.ingestion.failed`
- `ocean-freight.source-email.detected`
- `ocean-freight.candidate.created`
- `ocean-freight.candidate.approved`
- `ocean-freight.candidate.rejected`
- `ocean-freight.rate.created`
- `ocean-freight.rate.updated`
- `ocean-freight.rate.inactivated`
- `ocean-freight.agent.created`
- `ocean-freight.agent.updated`
- `ocean-freight.agent.rating-updated`

## Schedule Challenge

Customers ask for vessel schedules, but agents often omit schedule details.

MVP handling:

- Display `Schedule not provided` when no schedule is included.
- Store `scheduleNotes` and `transitTimeNotes` separately from numeric `transitTimeDays`.
- Allow pricing users to manually add schedule/transit notes during approval or correction.
- Do not block rate approval because schedule is missing.

Future options:

- Add sailing schedule provider integration if Newl selects a source.
- Add manual schedule attachment/reference fields.
- Add freshness warnings when rates are active but schedule notes are stale.
- Add assistant support to answer schedule availability only from explicit stored schedule notes or provider data.

## Testing Plan

Unit tests:

- Authorization:
  - Add module to role matrix tests.
  - Verify `SALES`/`OPERATIONS`/`READ_ONLY` behavior.
- Tenant safety:
  - Queries always include tenant filters.
  - Approval by candidate id cannot access another tenant.
  - Rate edit/inactivate cannot cross tenants.
- Normalization:
  - Equipment labels: `20`, `20GP`, `20FT`, `40`, `40GP`, `40HQ`, `45HQ`, `LCL`.
  - Currency and amount parsing.
  - Date parsing for validity windows.
  - Agent name/domain normalization.
- Email detection:
  - Rate emails detected.
  - Non-rate promotional/noise emails ignored or marked low confidence.
- AI extraction:
  - Mock provider returns strict JSON.
  - Invalid JSON creates `ERROR` candidate/job state, not production rates.
- Manual actions:
  - Create/edit/inactivate with audit log.
- Candidate actions:
  - Approve creates production rate.
  - Reject preserves candidate and reason.

Integration-style tests:

- Mock Microsoft Graph fetch:
  - selected mailbox message paging
  - attachment fetch
  - duplicate message id upsert
  - job progress updates
- API routes:
  - auth required
  - `requireModule` called
  - `requireMutationAccess` blocks `READ_ONLY`

UI tests:

- Rate filters default to active.
- Include expired toggle works.
- Agent rating appears in rate rows.
- Candidate review can edit required fields before approve.
- Source panel shows email trace metadata.

Commands after implementation:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run prisma:generate`
- `npm run build`
- Relevant live DB check if auth/module changes affect seeded state.

## Rollout Plan

### PR 1: Module And Schema Foundation

- Add `OCEAN_FREIGHT_PRICING` module enum/migration.
- Add ocean schema tables/enums.
- Add seed module row and Newl tenant access.
- Update role policy/tests.
- Add navigation entry.
- Add basic protected portal page.
- Add tenant-safe read queries returning empty states.

### PR 2: Manual Rates And Agent Directory

- Add manual rate create/edit/inactivate actions.
- Add agent create/edit/rating actions.
- Add rate table filters.
- Add audit logs.
- Add tests for tenant isolation and manual workflows.

### PR 3: Microsoft Graph Email Source Ingestion

- Add ocean ingestion job helpers.
- Reuse Graph application token and mailbox settings.
- Fetch messages from configured pricing mailbox.
- Store source email metadata and body text.
- Detect likely rate emails.
- Add ingestion controls and job history.

### PR 4: Attachment Parsing

- Fetch attachment metadata/content where safe.
- Parse CSV and text/PDF body content.
- Add XLSX support if dependency is approved.
- Store extracted text/rows.
- Add attachment parser tests.

### PR 5: AI Extraction And Review Queue

- Add extraction prompt/provider wrapper.
- Create candidate staging rows.
- Add review queue UI.
- Add approve/reject/edit flow.
- Add audit trail and tests.

### PR 6: Polish, Export, And Analytics Prep

- Add CSV export.
- Add source detail panels.
- Add agent metrics.
- Add active/expired trend summaries.
- Add assistant knowledge adapter for approved ocean rates if useful.

## Future Phases

### Agent Portal

Design now, build later:

- External agent users associated with `OceanFreightAgent`.
- Agent-submitted rates with approval workflow.
- Agent portal source type `AGENT_PORTAL`.
- Rate submissions remain tenant-scoped.
- Agents can only see their own submitted rates and submission history.

### Customer Portal

Design now, build later:

- Customer users and customer tenant/account mapping.
- Customer-visible rate views with margin/permission controls.
- Booking request workflow.
- Customer-specific rates and markups.
- Audit customer quote views and booking requests.

### Outbound Sales Automation

After pricing data is reliable:

- Compare active ocean rates against TradeMining lanes.
- Identify lanes where Newl has a pricing advantage.
- Match companies from TradeMining that import/export on those lanes.
- Use Apollo to find contacts.
- Generate AI-assisted email drafts referencing relevant lane/rate advantages.
- Require human approval before sending or sequence enrollment.
- Keep this as a future phase, not MVP.

### Sailing Schedule Integration

Potential future additions:

- Sailing schedule provider integration.
- Manual schedule source records.
- Schedule confidence/freshness.
- Schedule notes in customer-facing rate views.

### Pricing Intelligence

Potential future additions:

- Lane trend charts.
- Agent reliability scoring from historical correction/rejection rates.
- Rate expiration alerts.
- Best-rate recommendations by lane/equipment/date.
- Margin guidance and sell-rate suggestions.

## Risks/Open Questions

### Risks

- Email content is inconsistent; extraction accuracy will vary.
- Promotional emails may look like rates but lack validity or lane structure.
- Attachment formats may require new dependencies or specialized parsers.
- PDF tables are notoriously unreliable without careful extraction and review.
- Microsoft Graph application mailbox access requires tenant/admin configuration and Exchange mailbox access policy.
- AI extraction could hallucinate fields if not constrained and reviewed.
- Duplicate rates may be difficult to detect across repeated promotional blasts.
- Agent identity matching can accidentally merge unrelated companies if over-aggressive.
- Storing full raw email/attachment content may create privacy and retention concerns.

### Open Questions

- Should `pricing@newlgroup.com` be the only initial mailbox, or should other mailboxes be included from day one?
- Should `SALES` be allowed to edit rates, or only view them? Current role model allows mutation unless tenant overrides say otherwise.
- What internal agent rating scale should be used: 1-5, 1-10, or labels?
- Should approved rates require validity end date, or allow manual override?
- Should the app store full attachment binaries, or only extracted text plus Graph source references?
- Which attachment formats must be supported in the first ingestion PR: CSV, XLSX, PDF, or all three?
- Is there an existing preferred sailing schedule provider?
- Should ocean pricing eventually integrate into the existing assistant rate tools?
- Should rate amount represent buy rate only, or should MVP also store sell rate/margin?

## Step-by-Step Implementation Checklist

1. Confirm MVP assumptions:
   - Module key `OCEAN_FREIGHT_PRICING`.
   - Default role access includes `SALES` and `OPERATIONS`.
   - Newl tenant config uses `pricing@newlgroup.com`.
   - AI extraction is review-only.
2. Create schema migration:
   - Add module enum.
   - Add ocean source, agent, candidate, and rate tables.
   - Add tenant relations and indexes.
3. Update seed:
   - Add module row.
   - Enable module for Newl tenant.
   - Optionally seed a small dry-run/manual sample agent and rate only if desired for local UX.
4. Update role policy and tests:
   - Add `OCEAN_FREIGHT_PRICING` to relevant roles.
   - Add authorization tests.
5. Add navigation:
   - Operations Tools entry.
6. Add module shell:
   - Protected page under `(authenticated)`.
   - `requireModule`.
   - Empty-state cards for rates, review queue, agents, and ingestion readiness.
7. Add tenant-safe queries:
   - Rate list.
   - Candidate queue.
   - Agent directory.
   - Recent jobs.
8. Add manual workflows:
   - Create rate.
   - Edit/correct rate.
   - Mark inactive.
   - Create/update/rate agent.
   - Audit logs.
9. Add ingestion job foundation:
   - Job type constant.
   - Start/run helpers.
   - Source email upsert.
   - Detection rules.
   - Job progress output.
10. Add Graph attachment support:
    - Fetch attachment list.
    - Store metadata/hash.
    - Parse supported formats.
11. Add extraction staging:
    - Deterministic extraction helpers.
    - AI provider wrapper.
    - Candidate persistence.
    - Candidate confidence/reason.
12. Add review UI:
    - Candidate table.
    - Edit-before-approval form.
    - Approve/reject actions.
13. Add active/historical filters:
    - Active by default.
    - Include expired/inactive toggle.
14. Add tests:
    - Tenant isolation.
    - Auth/mutations.
    - Detection/normalization.
    - Candidate approval.
    - Manual edits/audit.
    - Graph mocks.
15. Run checks:
    - `npm run prisma:generate`
    - `npm run lint`
    - `npm run typecheck`
    - `npm test`
    - `npm run build`
16. Prepare PR summary:
    - What changed.
    - Why it changed.
    - Files changed.
    - How to test locally.
    - Screens/pages affected.
    - Tenant-safety considerations.
    - Known limitations.
