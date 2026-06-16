# LTL Rate Portal Implementation Plan

Generated: 2026-06-16

## Goal

Build a tenant-safe LTL rate portal in Newl Apps for uploading a CSV of lanes and freight details, rating each row across 7L/common-carrier rates, comparing carrier options, and exporting bulk RFQ/quote results.

This should be a separate operational module, not a UPS subfeature. It may reuse UX patterns from the UPS tools route, but it needs its own module entitlement, tenant-scoped 7L credentials, persisted batch history, and quote result tables.

## Product Fit

- Internal-first for Newl Group RFQs and bulk quote work.
- SaaS-ready by keeping all uploaded lanes, batches, quote attempts, carrier caches, and integration credentials scoped by `tenantId`.
- Separate from UPS tools so tenants can enable parcel tools, LTL rating, transit lookup, invoice verification, or lead generation independently.
- No live booking/dispatch in the first pass unless explicitly enabled later. The first usable milestone should rate and export. Saving a 7L quote can be a controlled follow-up.

## 7L API Facts To Use

Source docs:

- Swagger UI: `https://restapi.my7l.com/api/v1/docs#/`
- OpenAPI JSON referenced by the docs page: `https://restapi.my7l.com/dist/generated_docs.json`
- FreightInfo reference: `https://restapi.my7l.com/dist/referenceFreightInfo.json`

Relevant endpoints:

- `POST /api/v1/login`
  - Body: `{ "username": string, "password": string }`
  - Returns `data.accessToken` and `data.exp` as a Unix timestamp.
- `POST /api/v1/refreshtoken`
  - Body: `{ "token": string }`
  - Returns a new `data.accessToken` and `data.exp`.
- `GET /api/v1/database/ltlaccount`
  - Carrier lookup.
  - Query: optional `carrierType[]` with values `ALL`, `3PL`, `DRY`, `LTL`, `PAK`, `VOL`; optional `includeBillTo`.
  - LTL rating needs the carrier `CarrierHash`.
- `GET /api/v1/ltl/ltlfees`
  - LTL accessorial lookup.
  - Query: optional `default=true`.
  - Response groups accessorials by category and includes code plus description.
- `GET /api/v1/ltl/ltlrates`
  - Core rating endpoint.
  - Required query fields:
    - `carrierHash`
    - `originCity`
    - `originState`
    - `originZipcode`
    - `originCountry` enum `US`, `CA`, `MX`
    - `destinationCity`
    - `destinationState`
    - `destinationZipcode`
    - `destinationCountry` enum `US`, `CA`, `MX`
    - `freightInfo` as a serialized JSON string
    - `UOM` enum `US`, `METRIC`, `MIXED`
  - Optional query fields:
    - `strictResult`
    - `harmonizedCharges`
    - `accessorialsList[]`
    - `pickupDate` format `YYYY-MM-DD`
  - Returns carrier quote options with fields like `Name`, `Code`, `SCAC`, `Error`, `ServiceLevel`, `AccountNmbr`, `TransitDays`, `QuoteNumber`, `RateBreakdown`, `RateRemarks`, `Total`, and `RateType`.
- `POST /api/v1/ltl/rate/save`
  - Body: `{ "rateId": string }`
  - Returns `QuoteNumber7L`.
  - Do not include this in the first automatic bulk flow unless the business confirms quote-save semantics and whether saved quotes create obligations in 7L.

`freightInfo` item shape:

```json
{
  "qty": "1",
  "weight": "180",
  "weightType": "each",
  "length": "74",
  "width": "22",
  "height": "14",
  "dimType": "PLT",
  "class": "100",
  "hazmat": false,
  "UN": "1234",
  "nmfc": "015195-00",
  "stack": false,
  "stackAmount": 5,
  "commodity": "Wooden Crate with furniture parts"
}
```

Validation rules from the 7L reference:

- Required: `qty`, `weight`, `weightType`, `length`, `width`, `height`.
- `qty`, `weight`, `length`, `width`, `height` must be numeric and greater than 0.
- `weightType`: `each` or `total`.
- `dimType`: `CTN`, `PLT`, `CRT`, `CON`, `CYL`, `DRM`, `ENV`, `BOX`, `BDL`.
- `class`: `0`, `50`, `55`, `60`, `65`, `70`, `77.5`, `85`, `92.5`, `100`, `110`, `125`, `150`, `175`, `200`, `250`, `300`, `400`, `500`.
- `hazmat`: boolean.
- `UN`: optional 4-character string.
- `nmfc`: optional 9-character string.
- `stack`: boolean.
- `stackAmount`: required and greater than 0 if `stack=true`.
- `commodity`: optional string.

## Product Decisions To Confirm

These affect authorization or external side effects:

- Should `SALES` have access to `LTL_RATE_PORTAL` because RFQs often sit with sales, or should access remain `ADMIN`, `MANAGER`, and `OPERATIONS` only?
- Should the first version rate all active/default LTL carriers from 7L, or only a tenant-configured subset of preferred carriers?
- Should the portal save quotes back to 7L automatically, only on user selection, or not at all in v1?
- Should quote exports include Newl margin/markup columns in v1, or only raw carrier cost and service data?

Recommended defaults if no answer is available:

- Enable `LTL_RATE_PORTAL` for `ADMIN`, `MANAGER`, and `OPERATIONS`; add `SALES` only after confirming sales RFQ ownership.
- Rate a tenant-configured carrier subset, with an "all active LTL carriers" fallback for Newl's seeded tenant.
- Do not call `POST /api/v1/ltl/rate/save` automatically.
- Export raw carrier costs plus blank internal columns for `sellRate`, `margin`, and `notes`.

## Implementation Phases

### Phase 1: Module, Schema, And Credentials

Add new Prisma enum values:

- `ModuleKey.LTL_RATE_PORTAL`
- `IntegrationProvider.SEVEN_L`

Update:

- `prisma/schema.prisma`
- New migration under `prisma/migrations/*_add_ltl_rate_portal/`
- `prisma/seed.ts`
- `src/server/auth/authorization.ts`
- `tests/authorization.test.ts`
- `src/components/app-shell.tsx`

Seed:

- Module name: `LTL Rate Portal`
- Description: `Bulk LTL rating and RFQ quote comparison using tenant-scoped 7L credentials`
- Newl Group tenant should have the module enabled.

Credentials:

- Reuse `IntegrationCredential`.
- Store non-secret config in `publicConfig`:

```json
{
  "baseUrl": "https://restapi.my7l.com",
  "defaultUom": "US",
  "strictResult": false,
  "harmonizedCharges": true,
  "dryRun": false,
  "carrierMode": "TENANT_SELECTED"
}
```

- Store username/password or a secret-store reference in `secretRef`.
- Do not commit 7L usernames, passwords, access tokens, refresh tokens, API keys, or customer account numbers.
- For local development, allow a dry-run credential with no secret that returns fixture rates from tests.

### Phase 2: Data Model

Add tables with `tenantId` and tenant-scoped indexes.

Suggested models:

```prisma
enum LtlRateBatchStatus {
  UPLOADED
  VALIDATING
  VALIDATION_ERROR
  QUEUED
  RUNNING
  COMPLETED
  COMPLETED_WITH_ERRORS
  ERROR
  CANCELLED
}

enum LtlRateRowStatus {
  PENDING
  VALIDATION_ERROR
  RATING
  RATED
  NO_RATES
  ERROR
}

model LtlRateBatch {
  id              String             @id @default(cuid())
  tenantId        String
  uploadedById    String?
  originalFileName String
  status          LtlRateBatchStatus @default(UPLOADED)
  totalRows       Int                @default(0)
  validRows       Int                @default(0)
  errorRows       Int                @default(0)
  completedRows   Int                @default(0)
  selectedCarriers Json?
  defaultOptions  Json?
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt
  startedAt       DateTime?
  finishedAt      DateTime?

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  rows   LtlRateRow[]

  @@index([tenantId, createdAt])
  @@index([tenantId, status])
}

model LtlRateRow {
  id                 String           @id @default(cuid())
  tenantId           String
  batchId            String
  rowNumber          Int
  status             LtlRateRowStatus @default(PENDING)
  customerReference  String?
  originCity         String
  originState        String
  originZipcode      String
  originCountry      String           @default("US")
  destinationCity    String
  destinationState   String
  destinationZipcode String
  destinationCountry String           @default("US")
  pickupDate         DateTime?
  uom                String           @default("US")
  accessorialCodes   Json?
  freightInfo        Json
  validationErrors   Json?
  rawInput           Json
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt

  batch   LtlRateBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  tenant  Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  results LtlRateResult[]

  @@unique([tenantId, id])
  @@unique([batchId, rowNumber])
  @@index([tenantId, batchId, status])
  @@index([tenantId, originZipcode, destinationZipcode])
}

model LtlRateResult {
  id                  String   @id @default(cuid())
  tenantId            String
  rowId               String
  carrierHash         String
  carrierName         String?
  carrierCode         String?
  scac                String?
  serviceLevel        String?
  serviceLevelCode    String?
  accountNumberMasked String?
  transitDays         Int?
  quoteNumber         String?
  total               Decimal? @db.Decimal(12, 2)
  currency            String   @default("USD")
  rateType            String?
  errorMessage        String?
  rateBreakdown       Json?
  rateRemarks         Json?
  rawResponse         Json
  createdAt           DateTime @default(now())

  row    LtlRateRow @relation(fields: [rowId], references: [id], onDelete: Cascade)
  tenant Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, rowId])
  @@index([tenantId, carrierHash])
  @@index([tenantId, total])
}

model LtlCarrierCache {
  id             String   @id @default(cuid())
  tenantId       String
  carrierHash    String
  name           String
  code           String?
  scac           String?
  defaulted      Boolean?
  electronicDispatch Boolean?
  raw            Json
  lastSyncedAt   DateTime @default(now())

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, carrierHash])
  @@index([tenantId, name])
  @@index([tenantId, scac])
}

model LtlAccessorialCache {
  id           String   @id @default(cuid())
  tenantId     String
  code         String
  category     String?
  description  String?
  raw          Json
  lastSyncedAt DateTime @default(now())

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, code])
  @@index([tenantId, category])
}
```

Also add back-relations to `Tenant`.

Keep `rawInput`, `rawResponse`, `rateBreakdown`, and `rateRemarks` as `Json` so the integration can evolve without losing data. Avoid storing secrets in any raw JSON.

### Phase 3: CSV Template

Create a downloadable CSV template route or server action.

Recommended v1 columns:

```csv
customerReference,originCity,originState,originZipcode,originCountry,destinationCity,destinationState,destinationZipcode,destinationCountry,pickupDate,uom,accessorialCodes,piece1Qty,piece1Weight,piece1WeightType,piece1Length,piece1Width,piece1Height,piece1DimType,piece1Class,piece1Hazmat,piece1UN,piece1NMFC,piece1Stack,piece1StackAmount,piece1Commodity
```

Support up to 5 pieces in v1 by repeating the piece field group:

- `piece2Qty`, `piece2Weight`, ...
- `piece5Qty`, `piece5Weight`, ...

Parsing rules:

- Required row fields: origin city/state/zip/country, destination city/state/zip/country, at least one valid piece.
- Default `originCountry`, `destinationCountry`, and `uom` to `US` where blank.
- Parse `pickupDate` as `YYYY-MM-DD`; reject ambiguous date formats.
- Parse `accessorialCodes` as comma-separated codes, trim, uppercase, and validate against cached 7L accessorials when available.
- Build `freightInfo` as an array of piece objects and serialize it when calling 7L.
- Keep each original CSV row in `rawInput` for audit/replay.

Use a CSV parser dependency rather than hand-rolled parsing. Recommended: `csv-parse` for server-side parsing.

### Phase 4: 7L Client

Create:

- `src/server/integrations/seven-l/types.ts`
- `src/server/integrations/seven-l/client.ts`
- `src/server/integrations/seven-l/auth.ts`
- `src/server/integrations/seven-l/fixtures.ts`

Client responsibilities:

- Load active tenant credential from `IntegrationCredential` with `provider: SEVEN_L`.
- Resolve secret via a small abstraction. For v1 local builds, support dry-run fixture mode. Production should point `secretRef` to a managed secret store.
- Login with `POST /api/v1/login`.
- Cache access token in memory per tenant credential until shortly before `exp`.
- Refresh with `POST /api/v1/refreshtoken` when possible; fall back to login.
- Send bearer token on authenticated 7L calls.
- Use `URLSearchParams`, appending `accessorialsList[]` correctly for each code.
- Serialize `freightInfo` with `JSON.stringify(row.freightInfo)`.
- Normalize 7L errors into a typed error that includes status code, endpoint, safe response message, and retryability.
- Add basic retry/backoff for 429 and transient 5xx responses. Do not retry validation errors.

Do not expose 7L tokens, usernames, passwords, account numbers, or raw auth responses to the browser.

### Phase 5: Server Actions And Processing

Create module folder:

- `src/modules/ltl-rate-portal/actions.ts`
- `src/modules/ltl-rate-portal/queries.ts`
- `src/modules/ltl-rate-portal/csv.ts`
- `src/modules/ltl-rate-portal/validation.ts`
- `src/modules/ltl-rate-portal/rating-service.ts`
- `src/modules/ltl-rate-portal/export.ts`
- `src/modules/ltl-rate-portal/types.ts`

Actions:

- `uploadLtlRateCsv(formData)`
  - `getAuthenticatedContext()`
  - `requireModule(ctx, ModuleKey.LTL_RATE_PORTAL)`
  - `requireMutationAccess(ctx)`
  - Parse and validate CSV.
  - Create `LtlRateBatch` and `LtlRateRow` records in a transaction.
  - Create `AutomationJobRun` with `jobType: "ltl-rate-batch"`.
  - For v1, process synchronously after upload if row count is small. For large files, use a queued job abstraction later.
- `rateLtlBatch(batchId)`
  - Re-fetch batch by `tenantId`.
  - Sync carrier/accessorial cache if stale.
  - For each valid row, rate against selected carriers.
  - Limit concurrency, for example 3 rows x 3 carriers at a time, to avoid hammering 7L.
  - Persist one `LtlRateResult` per carrier result.
  - Update row and batch statuses throughout.
  - Write `AuditLog` entries for upload, rating start, rating completion, and export.
- `exportLtlBatchResults(batchId)`
  - Tenant-check the batch.
  - Return CSV with one row per quote option or one row per lane with best/second/third options, depending on selected export mode.

Queries:

- `getLtlRatePortalShell(ctx)` for dashboard metrics, recent batches, credential status, module enabled status.
- `getLtlRateBatch(ctx, batchId)` with rows and top results.
- `getLtlCarrierOptions(ctx)` from carrier cache.
- `getLtlAccessorialOptions(ctx)` from accessorial cache.

Tenant safety:

- Every query must include `tenantId`.
- Prefer `tenantWhere(ctx, ...)`.
- Never query rows/results by `id` alone.
- Use composite uniqueness or explicit `tenantId` filters for all update/delete paths.

### Phase 6: UI

Routes:

- `src/app/(authenticated)/ltl-rate-portal/page.tsx`
- `src/app/(authenticated)/ltl-rate-portal/[batchId]/page.tsx`
- Optional later: `src/app/(authenticated)/ltl-rate-portal/settings/page.tsx`

Main page:

- Header: `LTL Rate Portal`
- Credential/status panel.
- Download CSV template button.
- Upload CSV form.
- Carrier selection control:
  - All active/default LTL carriers
  - Preferred carriers only
  - Manual selected carriers
- Batch history table with status, uploaded by, created time, row counts, error count, and link to detail.

Batch detail page:

- Summary metrics: total rows, rated rows, error rows, best total, average transit.
- Validation errors table grouped by row number.
- Result table with filters for origin, destination, status, carrier, SCAC, and accessorials.
- Each lane should show best rate, carrier, transit days, quote number, remarks, and a button/expander for full carrier comparison.
- Export buttons:
  - `Export summary CSV`
  - `Export all carrier options CSV`
- If quote-save is approved later, add a per-result `Save quote in 7L` action that calls `/api/v1/ltl/rate/save`.

Design:

- Follow the existing app shell and page header patterns.
- This is an operational tool, so keep it dense, scannable, and table-forward.
- Do not make a landing page or marketing hero.

### Phase 7: Tests

Add unit tests:

- `tests/ltl-rate-csv.test.ts`
  - Valid single-piece CSV.
  - Valid multi-piece CSV.
  - Missing required lane fields.
  - Invalid class, hazmat, stackAmount, country, pickupDate.
  - Accessorial normalization.
- `tests/ltl-rate-validation.test.ts`
  - FreightInfo validation according to 7L reference.
- `tests/ltl-rate-service.test.ts`
  - Dry-run fixture rating.
  - 7L error normalization.
  - Result sorting by total.
- `tests/ltl-rate-tenant-isolation.test.ts`
  - Tenant A cannot read, rate, export, or mutate Tenant B batches.
  - Every query/update path is tenant scoped.
- Extend `tests/authorization.test.ts`
  - Role access for `LTL_RATE_PORTAL`.
  - `READ_ONLY` can view but cannot upload/rate/export if export is treated as an audit-producing action.

Commands to run after implementation:

```bash
npm run lint
npm run typecheck
npm test
npm run prisma:generate
npm run build
```

If auth or seeded DB behavior changes, also run:

```bash
npm run verify:auth
```

## PR Sequence

Keep this as small-to-medium PRs.

### PR 1: Schema And Module Shell

Files:

- `prisma/schema.prisma`
- New migration
- `prisma/seed.ts`
- `src/server/auth/authorization.ts`
- `tests/authorization.test.ts`
- `src/components/app-shell.tsx`
- `src/app/(authenticated)/ltl-rate-portal/page.tsx`
- `src/modules/ltl-rate-portal/queries.ts`
- `src/modules/ltl-rate-portal/types.ts`

Outcome:

- LTL Rate Portal appears in nav for authorized users.
- Module entitlement and role checks work.
- Page shows credential/module status and recent empty state.

### PR 2: CSV Template, Upload, Validation

Files:

- `src/modules/ltl-rate-portal/csv.ts`
- `src/modules/ltl-rate-portal/validation.ts`
- `src/modules/ltl-rate-portal/actions.ts`
- `src/app/(authenticated)/ltl-rate-portal/page.tsx`
- CSV/validation tests.

Outcome:

- Users can download a template.
- Users can upload CSV.
- App persists batches/rows and shows validation errors.
- No live 7L calls yet.

### PR 3: 7L Client And Dry-Run Rating

Files:

- `src/server/integrations/seven-l/*`
- `src/modules/ltl-rate-portal/rating-service.ts`
- Service tests.

Outcome:

- Dry-run fixture mode rates rows and persists results.
- Live client is coded behind tenant credential status but can remain disabled in seed.

### PR 4: Live Rating And Results UI

Files:

- Batch detail route.
- Rating action/service integration.
- Carrier/accessorial cache sync.
- Result tables and filters.
- Export module.

Outcome:

- Authorized users can rate real uploaded lanes through 7L when credentials are configured.
- Users can compare carrier options and export results.

### PR 5: Optional Quote Save

Only after business approval.

Outcome:

- User-selected results can be saved to 7L via `POST /api/v1/ltl/rate/save`.
- Save action is audited.
- No automatic quote saving unless explicitly requested.

## Known Risks And Mitigations

- 7L rate limits: response headers include rate limit fields on the docs request. Add concurrency limits and retries, and store job progress so partial failures are visible.
- CSV row ambiguity: use strict headers and deterministic date/boolean parsing. Reject unknown required values with row-level errors.
- Carrier volume: rating every lane against every carrier can explode request count. Start with preferred carrier selection and visible row/carrier count before submit.
- Secret handling: current `IntegrationCredential.secretRef` is a placeholder pattern. Do not store live 7L passwords in `publicConfig`, Prisma JSON, tests, or committed fixtures.
- Quote side effects: `/api/v1/ltl/rate/save` may create durable quote records in 7L. Keep it out of automatic bulk rating.
- Tenant leakage: all batch, row, result, carrier, and accessorial records must include `tenantId`, and tests must prove cross-tenant reads/exports fail.

## PR Description Template

Use this for the implementing PRs:

```md
## What Changed

## Why It Changed

## Files Changed

## How To Test Locally

## Screens/Pages Affected

## Tenant-Safety Considerations

## Known Limitations
```
