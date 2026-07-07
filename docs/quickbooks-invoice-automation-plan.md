# QuickBooks Invoice Automation And Shipment Profitability Plan

Generated: 2026-07-07

## Executive Summary

Build the QuickBooks Invoice Automation and Shipment Profitability module as a finance-owned, tenant-safe workflow that turns uploaded customer and vendor invoice PDFs into reviewed invoice records, approved posting batches, QuickBooks invoices/bills, and shipment profitability reporting.

The MVP should not post anything directly to QuickBooks from upload or extraction. Every invoice should pass through staging, review, and approval. QuickBooks posting should happen only from an approved batch, with idempotency checks, full audit logs, original PDF retention, and persistent QuickBooks status fields.

The existing repo already has three useful foundations:

- `INVOICE_VERIFICATION` and `QUICKBOOKS_POSTING` module keys exist as placeholders.
- `CUSTOMER_CASHFLOW` already models customers, shipment files, customer invoices, vendor bills, accounting lines, alerts, and profitability-style rollups.
- QuickBooks OAuth connection scaffolding already exists for tenant-scoped legal-entity connections.

Recommended first implementation PR: create the schema and shells for upload, staging, approval, PDF storage metadata, search, and module navigation. Do not build extraction AI or live QuickBooks posting in PR 1.

## Current Repo Findings

### App Shape

- The app is a Next.js 15, React 19, Prisma, PostgreSQL application.
- Auth is Auth.js v5 with Microsoft Entra ID SSO and database sessions.
- Local development can use `AUTH_DEV_BYPASS=true`, but production cannot.
- User-facing pages live under `src/app/(authenticated)/`.
- Modules live in `src/modules/*`.
- Route handlers live under `src/app/api/*`.
- Tenant-scoped DB access commonly uses `tenantWhere(tenant, where)` from `src/server/tenant-query.ts`.
- The package scripts are:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm run prisma:generate`
  - `npm test`
  - `npm run verify:auth`

### Product Direction

`reference/PRODUCT_OPERATING_BRIEF.md` says Newl Apps is internal-first but SaaS-ready. For this module that means:

- Newl Group is the first seeded tenant, not a hardcoded business assumption.
- Every invoice, PDF, batch, QuickBooks entity cache, mapping, posting result, risk flag, and profitability record must include `tenantId`.
- Integration credentials must remain per tenant and per legal entity.
- Keep invoice verification, QuickBooks posting, and profitability as separable entitlements.

### Auth, Permissions, And Tenant Context

Source files:

- `reference/AUTH_AND_TENANT_CONTEXT.md`
- `src/server/tenant-context.ts`
- `src/server/auth/authorization.ts`
- `src/server/auth/role-policy.ts`

Findings:

- User-facing server code should call `getAuthenticatedContext()`.
- Module access should call `requireModule(context, moduleKey)`.
- Mutations should call `requireMutationAccess(context)`.
- Sensitive finance mutations should also call `requireRole(context, [ADMIN, MANAGER, FINANCE])`.
- `READ_ONLY` can view but cannot mutate.
- `FINANCE` currently has `ASSISTANT`, `INVOICE_VERIFICATION`, `QUICKBOOKS_POSTING`, and `CUSTOMER_CASHFLOW`.
- `OPERATIONS` currently does not have `INVOICE_VERIFICATION` or `QUICKBOOKS_POSTING`, but can access `CUSTOMER_CASHFLOW`.

Recommended permission model:

- Upload customer and vendor invoices: `ADMIN`, `MANAGER`, `FINANCE`, and optionally `OPERATIONS`.
- Review and edit staging fields: `ADMIN`, `MANAGER`, `FINANCE`; optionally `OPERATIONS` for non-accounting fields such as file number and service type.
- Approve invoices for posting: `ADMIN`, `MANAGER`, `FINANCE`.
- Push approved batches to QuickBooks: `ADMIN`, `MANAGER`, `FINANCE`, gated by `QUICKBOOKS_POSTING`.
- View profitability/risk dashboards: `ADMIN`, `MANAGER`, `FINANCE`, `OPERATIONS`, and `READ_ONLY` when the tenant has the relevant module enabled.

## Existing QuickBooks Integration Findings

Source files:

- `src/server/integrations/quickbooks.ts`
- `src/app/api/integrations/quickbooks/connect/route.ts`
- `src/app/api/integrations/quickbooks/callback/route.ts`
- `src/modules/settings/queries.ts`
- `src/app/(authenticated)/settings/page.tsx`
- `src/modules/customer-cashflow/quickbooks.ts`
- `tests/customer-cashflow-quickbooks.test.ts`

Current behavior:

- QuickBooks OAuth connection flow exists.
- Connections are tenant-scoped through `IntegrationCredential`.
- Connections are separated by legal entity:
  - `NEWL_WORLDWIDE`
  - `NEWL_USA`
- `publicConfig` stores legal entity, realm ID, environment, company name, token expiry metadata, connected timestamp, and scopes.
- `secretRef` stores encrypted access and refresh token material using `AUTH_SECRET`.
- Settings UI shows QuickBooks connection cards and connect/reconnect links.
- Existing QuickBooks code can fetch company info but does not currently refresh tokens, sync customer/vendor/item/account lists, create invoices, create bills, attach PDFs, or reconcile posting status.

Existing QuickBooks cashflow helpers:

- Extract file numbers such as `OI1765N97`, `OE1765N71`, `AI532N2`, `AE180N5`, and `TR102N276` from descriptions.
- Infer shipment type from prefix.
- Classify P&L lines as customer revenue, vendor cost, or other.
- Infer business line as ocean, air, trucking, warehousing, or other.
- Normalize QuickBooks customer names and infer CAD/USD variants from labels.
- Group QuickBooks lines by file number and flag vendor-cost-without-customer-invoice cases.

Important gap:

- Existing QuickBooks integration is connection and parsing scaffolding, not a posting integration. Posting and PDF attachment should be designed as new code.

QuickBooks API fields to verify during implementation:

- Customer invoice line description should map to line `Description`.
- Vendor bill line description should map to expense/account line `Description`.
- The customer invoice hidden memo requirement likely maps to the invoice `PrivateNote` field, but this must be verified in a sandbox because QuickBooks UI labels can differ from API field names.
- Customer-facing memo/message fields should not be used for the hidden shipment file number unless finance confirms visibility is acceptable.
- PDF attachment should use QuickBooks attachable/upload APIs if available for the target realm and transaction type.
- Exchange-rate behavior should be verified per connected company because multi-currency configuration changes QuickBooks behavior.

Reference URLs for implementation verification:

- https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice
- https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/bill
- https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/attachable

## Existing File Upload And Storage Findings

Source files:

- `src/modules/shipment-documents/components/garland-daily-pack-client.tsx`
- `src/app/api/shipment-documents/runs/route.ts`
- `src/app/api/shipment-documents/runs/[runId]/route.ts`
- `src/modules/shipment-documents/queries.ts`
- `prisma/schema.prisma`

Current behavior:

- Shipment Documents accepts PDFs in the browser, processes them client-side with `pdf-lib` and `pdfjs-dist`, and posts base64 PDF output to an API route.
- `ShipmentDocumentRun` stores generated PDFs in Postgres `Bytes` columns.
- Search is implemented by a denormalized `searchText` string plus tenant-scoped filters.
- Download is implemented through an authenticated tenant-scoped API route returning `application/pdf`.
- Deletion checks tenant ownership before deleting.

Storage recommendation:

- For MVP, use the existing pattern only if expected PDF volume and file sizes are modest.
- Add a shared file/document metadata model instead of embedding all invoice file details directly in invoice staging rows.
- Store original PDF bytes in Postgres for the first PR if no object storage primitive exists yet, but hide storage behind a small service API so a future PR can move bytes to S3, Azure Blob, SharePoint, or another managed store without rewriting invoice workflows.
- Always persist file name, content type, size, checksum, storage backend, storage key/ref, createdByUserId, and search metadata.

## Existing Accounting, Customer, Shipment, And TMS-Related Findings

Source files:

- `reference/CUSTOMER_CASHFLOW_IMPLEMENTATION_NOTES.md`
- `reference/FINANCE_FS_GROUPINGS_REFERENCE.md`
- `src/modules/customer-cashflow/*`
- `src/modules/shipment-documents/*`
- `src/modules/trademining/ingestion.ts`
- `prisma/schema.prisma`

Existing finance models:

- `CashflowCustomer`
- `CashflowCustomerAlias`
- `CashflowFile`
- `CashflowCustomerInvoice`
- `CashflowVendorBill`
- `CashflowAccountingLine`
- `CashflowCustomerSnapshot`
- `CashflowAlert`
- `CashflowFollowUp`
- `CashflowSettings`

Key design instruction from cashflow notes:

- QuickBooks names are source labels, not canonical customer identity.
- CAD and USD QuickBooks profiles for the same customer must map to one canonical customer when business review confirms they are the same account.
- Finance-specific records should remain finance-owned, but canonical customer identity should roll up to the shared `Company` layer.
- Ocean, air, and trucking revenue/COGS should normally be matched by file number.
- Warehousing should not be forced into false shipment-file exceptions when no shipment file number exists.

Shipment/TMS findings:

- No Teamship/TMS integration appears to exist yet.
- `IntegrationProvider.TMS` exists.
- `AssistantSourceKind.TMS_RECORD` exists.
- Existing shipment-ish operational records are `CashflowFile`, TradeMining import records, and shipment document runs.
- The new module should treat Teamship shipment matching as future work and use shipment file number as the MVP linking key.

## Existing Background Job And Audit Patterns

Source files:

- `AutomationJobRun` in `prisma/schema.prisma`
- `src/modules/ltl-rate-portal/bulk-jobs.ts`
- `src/app/api/ltl-rate-portal/bulk-jobs/route.ts`
- `src/modules/ups-tools/bulk-jobs.ts`
- `src/app/api/ups/bulk-jobs/route.ts`
- `src/modules/trademining/ingestion.ts`

Current behavior:

- Shared `AutomationJobRun` stores `tenantId`, `jobType`, `status`, `startedAt`, `finishedAt`, `input`, `output`, and `errorMessage`.
- LTL and UPS bulk jobs use `AutomationJobRun` plus module-specific detail rows.
- Local processing currently uses `queueMicrotask`.
- Lifecycle actions write `AuditLog` rows.

Recommendation:

- Use `AutomationJobRun` for extraction jobs, customer/vendor sync jobs, and QuickBooks batch posting jobs.
- Add module-specific row tables for per-invoice posting results.
- Keep `queueMicrotask` acceptable for early internal MVP, but design job payloads so a real worker can pick them up later.

## Existing UI Conventions

Source files:

- `src/components/app-shell.tsx`
- `src/components/page-header.tsx`
- `src/components/metric-card.tsx`
- `src/modules/customer-cashflow/components.tsx`
- `src/app/(authenticated)/finance/customer-cashflow/*`
- `src/app/(authenticated)/settings/page.tsx`

Conventions:

- Finance pages use `PageHeader`, tabs, compact metric cards, bordered tables, and small status pills.
- Dashboards are server-rendered and query tenant-scoped summaries.
- Mutations generally happen through server actions or API route handlers.
- The sidebar filters entries based on tenant-enabled module access.
- Settings uses bordered sections for tenant integration configuration.

UI recommendation:

- Add a finance nav item such as `Invoice Automation` under Finance.
- Use tabs:
  - Upload
  - Staging Review
  - Approved Batches
  - Posted
  - Profitability
  - Risk Queue
  - Settings/Mappings
- Keep dense, operational table layouts instead of marketing-style screens.

## Proposed MVP Scope

In scope:

- Tenant-scoped invoice upload for customer invoices and vendor invoices.
- Single and bulk PDF upload.
- Original PDF retention and authenticated PDF download.
- Invoice batches with search by file number, invoice number, customer/vendor name, amount, date, batch, and posting status.
- Staging records with extracted or manually entered invoice metadata.
- Deterministic file-number prefix parsing:
  - `OE` = Ocean Export
  - `OI` = Ocean Import
  - `AE` = Air Export
  - `AI` = Air Import
  - `TR` = Trucking
  - `DR` = Drayage
- Deterministic mapping defaults:
  - Customer invoices:
    - `OE` + `OI` -> Ocean Freight
    - `AE` + `AI` -> Air Freight
    - `TR` -> Trucking unless account/customer rule says Warehouse
  - Vendor invoices:
    - `TR` -> `5015 Trucking Rate`
    - `OE` + `OI` -> `5020 Ocean Freight Rate`
    - `AE` + `AI` -> `5300 Air Freight Rate`
    - warehouse override -> `5014 Warehouse Rate`
- Manual review and approval workflow.
- Customer/vendor dropdowns from synced QuickBooks customer/vendor lists.
- Ambiguous match flags rather than guessing.
- Approved list and approved batch creation.
- Bulk push approved invoices/bills to QuickBooks.
- Store QuickBooks posting status, QuickBooks ID/reference, errors, posting result, and posted timestamp.
- Shipment profitability by file number, service type, account/customer, and date range.
- Risk queue for missing revenue/cost, unapproved vendor invoices, unposted approved invoices, duplicate invoice numbers, FX gaps, tax uncertainty, and unusual/negative margin.

## Explicit Out Of Scope For MVP

- Direct posting to QuickBooks immediately after upload.
- Automatic overwrite/update of posted QuickBooks transactions.
- Customer-facing portals.
- Full Teamship/TMS integration.
- Commission calculation.
- Accounting close workflow.
- Fully automated AI extraction with no review.
- Automatic creation of QuickBooks customers/vendors/items/accounts.
- Automatic guessing between ambiguous CAD/USD QuickBooks profiles.
- Long-term object storage migration, unless PDF volume makes DB storage unsafe before launch.
- Payments, collections automation, and vendor payment posting.
- QuickBooks record correction workflow after posting.

## Recommended Data Model And Schema

Use `tenantId` on every new table. Use tenant-scoped composite uniqueness and indexes for all cross-record lookups.

### Enums

Suggested enums:

```prisma
enum AccountingInvoiceType {
  CUSTOMER_INVOICE
  VENDOR_INVOICE
}

enum AccountingInvoiceLifecycleStatus {
  UPLOADED
  EXTRACTION_PENDING
  EXTRACTION_COMPLETE
  NEEDS_REVIEW
  READY_FOR_APPROVAL
  APPROVED
  POSTING_QUEUED
  POSTING
  POSTED
  POSTING_ERROR
  VOIDED
}

enum AccountingInvoiceIssueCode {
  MISSING_FILE_NUMBER
  UNKNOWN_SERVICE_TYPE
  MISSING_INVOICE_NUMBER
  MISSING_ENTITY
  AMBIGUOUS_QB_MATCH
  MISSING_QB_MATCH
  CURRENCY_PROFILE_MISMATCH
  MISSING_AMOUNT
  TAX_UNCERTAIN
  FX_MISSING
  DUPLICATE_INVOICE
  POSTING_FAILED
  PDF_MISSING
  LOW_MARGIN
  NEGATIVE_MARGIN
}

enum QuickBooksPostingStatus {
  NOT_READY
  READY
  QUEUED
  POSTING
  POSTED
  ERROR
  SKIPPED_DUPLICATE
}

enum AccountingDocumentStorageBackend {
  POSTGRES_BYTES
  OBJECT_STORAGE
  SHAREPOINT
}
```

### File Storage

Add a shared finance document model:

```prisma
model AccountingDocument {
  id             String   @id @default(cuid())
  tenantId       String
  fileName       String
  contentType    String
  sizeBytes      Int
  sha256         String
  storageBackend AccountingDocumentStorageBackend @default(POSTGRES_BYTES)
  storageKey     String?
  pdfBytes       Bytes?
  searchText     String
  uploadedByUserId String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, sha256])
  @@index([tenantId, createdAt])
  @@index([tenantId, searchText])
}
```

Notes:

- The `sha256` uniqueness prevents duplicate binary storage per tenant.
- If the same PDF is uploaded twice, create a new invoice/batch link but reuse the document.
- `pdfBytes` is nullable so object storage can be adopted later.

### Upload Batches

```prisma
model AccountingInvoiceBatch {
  id              String   @id @default(cuid())
  tenantId        String
  batchNumber     String
  source          String   @default("MANUAL_UPLOAD")
  invoiceType     AccountingInvoiceType?
  status          String
  uploadedByUserId String?
  approvedByUserId String?
  approvedAt      DateTime?
  postedByUserId  String?
  postedAt        DateTime?
  totalInvoices   Int      @default(0)
  approvedInvoices Int     @default(0)
  postedInvoices  Int      @default(0)
  errorInvoices   Int      @default(0)
  notes           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  invoices AccountingInvoiceStaging[]

  @@unique([tenantId, batchNumber])
  @@index([tenantId, createdAt])
  @@index([tenantId, status])
}
```

### Staged Invoices

```prisma
model AccountingInvoiceStaging {
  id                 String @id @default(cuid())
  tenantId           String
  batchId            String
  documentId         String
  invoiceType        AccountingInvoiceType
  status             AccountingInvoiceLifecycleStatus @default(UPLOADED)
  postingStatus      QuickBooksPostingStatus @default(NOT_READY)

  legalEntity        CashflowLegalEntity @default(NEWL_WORLDWIDE)
  shipmentFileNumber String?
  shipmentType       String?
  businessLine       CashflowBusinessLine @default(OTHER)

  invoiceNumber      String?
  invoiceDate        DateTime?
  dueDate            DateTime?
  entityNameRaw      String?
  normalizedEntityName String?
  quickBooksEntityId String?
  quickBooksEntityType String?
  quickBooksEntityDisplayName String?
  currency           String?

  subtotalAmount     Decimal? @db.Decimal(14, 2)
  taxAmount          Decimal? @db.Decimal(14, 2)
  totalAmount        Decimal? @db.Decimal(14, 2)
  taxApplicable      Boolean?

  productServiceName String?
  productServiceQbId String?
  expenseAccountName String?
  expenseAccountQbId String?

  exchangeRate       Decimal? @db.Decimal(18, 8)
  exchangeRateDate   DateTime?
  exchangeRateSource String?
  cadSubtotalAmount  Decimal? @db.Decimal(14, 2)
  cadTaxAmount       Decimal? @db.Decimal(14, 2)
  cadTotalAmount     Decimal? @db.Decimal(14, 2)

  confidenceScore    Int?
  extractionJson     Json?
  issues             Json?
  reviewNotes        String?

  approvedByUserId   String?
  approvedAt         DateTime?
  postedByUserId     String?
  postedAt           DateTime?
  quickBooksTxnId    String?
  quickBooksTxnNumber String?
  quickBooksSyncToken String?
  quickBooksPostingResult Json?
  quickBooksError    String?
  postingFingerprint String?

  cashflowCustomerId String?
  cashflowFileId     String?
  cashflowCustomerInvoiceId String?
  cashflowVendorBillId String?

  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  batch    AccountingInvoiceBatch @relation(fields: [tenantId, batchId], references: [tenantId, id], onDelete: Cascade)
  document AccountingDocument @relation(fields: [tenantId, documentId], references: [tenantId, id], onDelete: Cascade)

  @@unique([tenantId, id])
  @@unique([tenantId, postingFingerprint])
  @@index([tenantId, batchId])
  @@index([tenantId, documentId])
  @@index([tenantId, invoiceType, status])
  @@index([tenantId, postingStatus])
  @@index([tenantId, shipmentFileNumber])
  @@index([tenantId, invoiceNumber])
  @@index([tenantId, normalizedEntityName])
  @@index([tenantId, invoiceDate])
  @@index([tenantId, quickBooksTxnId])
}
```

Notes:

- `postingFingerprint` should be a deterministic hash of tenant, legal entity, invoice type, QuickBooks entity ID, invoice number, invoice date, currency, amount, and shipment file number.
- Store raw extraction JSON and raw QuickBooks posting result for auditability.
- Link staged invoices to `CashflowCustomerInvoice` and `CashflowVendorBill` when approved or posted.
- Do not force all staged records into existing cashflow tables before review.

### QuickBooks Directory Cache

Use synced lists for dropdowns and matching:

```prisma
model QuickBooksDirectoryEntity {
  id            String @id @default(cuid())
  tenantId      String
  legalEntity   CashflowLegalEntity
  entityType    String
  qbId          String
  displayName   String
  fullyQualifiedName String?
  normalizedName String
  currency      String?
  active        Boolean @default(true)
  rawJson       Json?
  syncedAt      DateTime @default(now())
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, legalEntity, entityType, qbId])
  @@index([tenantId, legalEntity, entityType, normalizedName])
  @@index([tenantId, legalEntity, entityType, currency])
}
```

Entity types:

- `CUSTOMER`
- `VENDOR`
- `ITEM`
- `ACCOUNT`
- `TAX_CODE`
- `TERM`

### Mapping Rules

Add tenant-configurable mapping tables:

```prisma
model AccountingServiceMappingRule {
  id              String @id @default(cuid())
  tenantId        String
  invoiceType     AccountingInvoiceType
  filePrefix      String?
  businessLine    CashflowBusinessLine?
  entityNamePattern String?
  currency        String?
  qbItemId        String?
  qbItemName      String?
  qbAccountId     String?
  qbAccountName   String?
  priority        Int @default(100)
  active          Boolean @default(true)
  notes           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, invoiceType, active])
  @@index([tenantId, filePrefix])
  @@index([tenantId, priority])
}
```

Use this for TR-to-Warehouse overrides and warehouse expense overrides.

### Posting Batch Results

```prisma
model QuickBooksPostingBatch {
  id             String @id @default(cuid())
  tenantId       String
  legalEntity    CashflowLegalEntity
  batchNumber    String
  invoiceType    AccountingInvoiceType?
  jobRunId       String?
  status         JobStatus
  createdByUserId String?
  startedAt      DateTime?
  finishedAt     DateTime?
  input          Json?
  output         Json?
  errorMessage   String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, batchNumber])
  @@index([tenantId, legalEntity, createdAt])
  @@index([tenantId, status])
}

model QuickBooksPostingBatchItem {
  id             String @id @default(cuid())
  tenantId       String
  postingBatchId String
  stagingInvoiceId String
  status         QuickBooksPostingStatus
  quickBooksTxnId String?
  quickBooksTxnNumber String?
  resultJson     Json?
  errorMessage   String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([tenantId, postingBatchId, stagingInvoiceId])
  @@index([tenantId, stagingInvoiceId])
  @@index([tenantId, status])
}
```

## Invoice Upload Workflow

1. User opens Finance -> Invoice Automation -> Upload.
2. User selects:
   - invoice type: customer, vendor, or mixed batch
   - legal entity
   - optional batch name
   - files
3. Client validates:
   - file type is PDF
   - file count within limit
   - file size within limit
4. Server route:
   - calls `getAuthenticatedContext()`
   - requires `INVOICE_VERIFICATION`
   - requires mutation access
   - allows `ADMIN`, `MANAGER`, `FINANCE`, and optionally `OPERATIONS`
   - calculates SHA-256 for every PDF
   - stores/reuses `AccountingDocument`
   - creates `AccountingInvoiceBatch`
   - creates one `AccountingInvoiceStaging` row per PDF
   - writes `AuditLog` action `accounting.invoice.uploaded`
5. User lands on the staging review page filtered to the new batch.

Bulk upload:

- Use one batch containing many staged invoice rows.
- If a PDF contains multiple invoices, mark it as `NEEDS_REVIEW` and let the reviewer split or duplicate rows in a later enhancement. MVP can assume one invoice per PDF and flag suspected multi-invoice PDFs.

## Extraction And Staging Workflow

MVP extraction should be staged in layers:

1. Deterministic extraction:
   - file number from PDF text and file name
   - service type from prefix
   - candidate invoice number from text patterns
   - candidate dates and amount-like values from text patterns
2. Optional AI extraction:
   - only after deterministic text extraction exists
   - writes `extractionJson`, confidence, and issue codes
   - never approves or posts
3. Human review:
   - missing or uncertain fields remain flagged
   - user can edit all posting-critical fields

Extraction output fields:

- invoice type
- shipment file number
- service type from file prefix
- invoice date
- due date
- customer/vendor name
- invoice number
- currency
- amount before tax
- sales tax/HST
- total amount
- whether sales tax should be added
- product/service line or expense account/category
- notes, confidence, and issues

Recommended file number parser:

- Reuse and extend `src/modules/customer-cashflow/quickbooks.ts`.
- Existing pattern supports `AI`, `AE`, `OI`, `OE`, and `TR`.
- Add `DR` for drayage.
- Treat `DR` as trucking/drayage for default expense mapping unless finance wants separate accounts.

## Manual Review And Approval Workflow

Staging page table columns:

- status
- issue count
- invoice type
- PDF preview/download
- file number
- service type
- customer/vendor
- QB match
- invoice number
- invoice date
- due date
- currency
- subtotal
- tax
- total
- item/account
- approval state
- posting state

Review drawer/detail page:

- PDF viewer/download
- extracted values vs editable fields
- QuickBooks customer/vendor dropdown
- currency profile indicator
- product/service or expense account dropdown
- tax handling fields
- FX fields
- issue checklist
- audit timeline

Approval rules:

- Cannot approve if posting-critical fields are missing:
  - invoice type
  - legal entity
  - invoice number
  - invoice date
  - QuickBooks customer/vendor ID
  - currency
  - total amount
  - product/service for customer invoices
  - expense account/category for vendor invoices
  - file number unless explicitly marked warehouse/non-file-backed
- Cannot approve ambiguous QuickBooks matches.
- Cannot approve missing FX when currency is not CAD.
- Approval writes `approvedByUserId`, `approvedAt`, `status=APPROVED`, and an `AuditLog`.
- Batch approval should only approve rows that already pass validation, then summarize skipped rows.

## QuickBooks Customer And Vendor Matching Design

Sync data:

- QuickBooks customers
- QuickBooks vendors
- QuickBooks product/services/items
- QuickBooks expense accounts/categories
- tax codes
- terms, if needed for due date defaults

Matching inputs:

- raw extracted entity name
- normalized entity name
- invoice type
- legal entity
- currency
- known `CashflowCustomerAlias`
- QuickBooks directory cache
- existing `Company` and `CashflowCustomer` records

Matching algorithm:

1. If user previously selected a QuickBooks entity for the same normalized name, legal entity, invoice type, and currency, suggest that entity.
2. Exact match on normalized QuickBooks display name and currency.
3. Exact match on normalized alias in `CashflowCustomerAlias` and currency.
4. Fuzzy match candidates only as suggestions.
5. If more than one plausible CAD/USD profile exists, mark `AMBIGUOUS_QB_MATCH`.
6. If currency is USD and only CAD profile matches, mark `CURRENCY_PROFILE_MISMATCH`.
7. If no candidate exists, mark `MISSING_QB_MATCH`.

Important rule:

- Never create or pick a QuickBooks customer/vendor automatically in an ambiguous case. The reviewer must choose.

## QuickBooks Posting Design

### Shared Posting Requirements

Before posting:

- Re-load the staged invoice by `tenantId`.
- Verify it is approved.
- Verify it has not already posted.
- Verify the selected QuickBooks connection is active for the tenant and legal entity.
- Refresh the QuickBooks token if needed.
- Build a deterministic posting fingerprint.
- Check local DB for an existing posted invoice with the same fingerprint.
- Optionally query QuickBooks by document number and entity before create.
- Write a posting attempt row before calling QuickBooks.

After posting:

- Store QuickBooks transaction ID, transaction number, sync token if returned, raw response, posted timestamp, and postedByUserId.
- Attach or reference the original PDF.
- Create/update `CashflowCustomerInvoice` or `CashflowVendorBill`.
- Create/update `CashflowFile` by `shipmentFileNumber` for ocean/air/trucking/drayage.
- Recalculate file profitability/risk fields.
- Write `AuditLog`.

Do not overwrite posted QuickBooks records in MVP. Corrections should be a future controlled workflow.

### Customer Invoice Posting

QuickBooks invoice payload should include:

- customer reference
- invoice date
- due date
- currency reference when required
- exchange rate only if QuickBooks/API supports and finance approves using the supplied rate
- product/service line
- quantity default `1`
- amount before tax
- tax code / tax detail as configured
- file number in line description
- file number in hidden/internal memo if supported, likely `PrivateNote` after sandbox verification
- optional customer-facing memo only if finance confirms

Default product/service mapping:

- `OE`, `OI` -> Ocean Freight
- `AE`, `AI` -> Air Freight
- `TR` -> Trucking
- account/customer override -> Warehouse
- `DR` -> Drayage/trucking mapping, confirm exact product/service

### Vendor Bill Posting

QuickBooks bill payload should include:

- vendor reference
- bill date
- due date
- currency reference when required
- exchange rate handling
- expense/category account
- amount before tax
- tax code / tax detail as configured
- file number in expense line description
- PDF attachment/reference

Default expense/category mapping:

- `TR` -> `5015 Trucking Rate`
- `OE`, `OI` -> `5020 Ocean Freight Rate`
- `AE`, `AI` -> `5300 Air Freight Rate`
- warehouse override -> `5014 Warehouse Rate`
- `DR` -> likely `5015 Trucking Rate` unless finance confirms separate drayage handling

## Batch Posting Design

Approved list:

- Shows approved, unposted invoices split by customer/vendor and legal entity.
- Supports filter by batch, file number, entity, currency, status, and issue.
- Allows user to select invoices and create a posting batch.

Posting batch:

- Only one legal entity per posting batch.
- Prefer one invoice type per batch for simpler error handling, though the schema can support mixed later.
- Create `QuickBooksPostingBatch` and `AutomationJobRun`.
- Create `QuickBooksPostingBatchItem` per staged invoice.
- Process sequentially or with very low concurrency to avoid API rate/consistency issues.
- Continue after row-level errors.
- Final status:
  - `SUCCESS` if all posted
  - `ERROR` if all failed
  - `SUCCESS` with error count in output if partially successful, or add a future `COMPLETED_WITH_ERRORS` enum if needed

Idempotency:

- Disable posting button for invoices with `POSTED`.
- Enforce `postingFingerprint` uniqueness per tenant.
- Before each create, re-check DB status inside the posting function.
- If retrying a failed batch, skip already posted rows and record `SKIPPED_DUPLICATE`.

## Shipment Profitability Design

MVP profitability should be invoice-driven:

- Group approved and posted customer invoices and vendor invoices by `shipmentFileNumber`.
- Preserve invoice-level detail.
- Calculate:
  - revenue
  - cost
  - gross profit
  - gross margin
  - customer invoice count
  - vendor bill count
  - unapproved invoice count
  - unposted approved invoice count
  - issue count

Use `CashflowFile` as the shipment/file rollup where possible:

- Create or update `CashflowFile` by `(tenantId, fileNumber)`.
- Set `businessLine` from file number prefix and mapping rules.
- Set `actualRevenue` from customer invoices.
- Set `vendorCost` from vendor invoices.
- Set `grossProfit` and `grossMarginPercent`.
- Set invoice dates from earliest/latest relevant rows.
- Set file status using existing `deriveFileStatus` logic, extended for approved/unposted states.

Account/customer-level profitability:

- Link customer invoices to `CashflowCustomer` through QuickBooks customer aliases and `Company`.
- For vendor invoices, preserve vendor-level detail and file-number linkage.
- Roll up by customer/account over time using invoice dates and CAD-converted amounts.

Warehousing:

- Allow TR file numbers to map to warehouse product/service by explicit rule.
- Allow warehouse invoices without file numbers only when reviewer marks them as warehouse/non-file-backed.
- Report warehouse revenue/cost by customer/period if file number is absent.

## FX Handling Design

Base currency: CAD.

Persist on every invoice:

- original currency
- original subtotal, tax, and total
- exchange rate used
- CAD subtotal, tax, and total
- FX source
- FX rate date

Recommended source priority:

1. QuickBooks exchange rate returned/used on the created transaction.
2. QuickBooks exchange-rate lookup if available before posting.
3. Tenant-approved fallback FX source.
4. Manual reviewer-entered rate.

Rules:

- If currency is CAD, exchange rate is `1`.
- If currency is USD and FX is missing, block approval or mark `FX_MISSING`.
- If QuickBooks supplies a different exchange rate during posting, update stored FX fields from QuickBooks and write an audit log.
- Profitability reports must show an "FX incomplete" warning and exclude or separately group records missing CAD conversion.
- Match CAD/USD QuickBooks profiles using both entity name and invoice currency.

## Risk Detection Rules

Create deterministic rules first. AI can summarize later, but rule outputs should be auditable.

File-number risks:

- Vendor invoice exists but no customer invoice for same file number.
- Customer invoice exists but no vendor invoice for same file number, if the service type usually has vendor cost.
- Posted invoice/bill missing file number where required.
- File number prefix unknown.
- File number present but product/service or expense mapping conflicts with prefix.

Workflow risks:

- Vendor invoice uploaded but not approved.
- Approved invoice not posted to QuickBooks.
- Posting error.
- PDF missing or not downloadable.
- Approved invoice edited after approval, requiring re-approval.

Matching risks:

- Missing QuickBooks customer/vendor match.
- Ambiguous customer/vendor match.
- Currency/profile mismatch.
- QuickBooks entity inactive.
- Customer/vendor selected manually with low confidence.

Financial risks:

- Duplicate invoice number from the same customer/vendor.
- Same file number has negative profit.
- Same file number has unusually low margin.
- Same file number has unusually high vendor cost relative to revenue.
- Currency conversion missing.
- Tax uncertainty.

Tax risks:

- HST/sales tax detected but taxApplicable is false.
- taxApplicable true but tax amount missing.
- currency/profile mismatch with tax code.
- item/account has no tax mapping.

## Permissions And Roles

Use module entitlements:

- `INVOICE_VERIFICATION`: upload, extraction, staging review, approval queue.
- `QUICKBOOKS_POSTING`: approved list and push-to-QuickBooks actions.
- `CUSTOMER_CASHFLOW`: profitability and risk dashboards.

Role recommendations:

- `ADMIN`: full access.
- `MANAGER`: full operational access.
- `FINANCE`: full finance workflow access.
- `OPERATIONS`: upload vendor/customer PDFs and edit non-accounting shipment fields if business approves.
- `SALES`: no MVP access unless customer/account profitability views are later approved for sales leadership.
- `READ_ONLY`: view dashboards and invoice detail only, no upload, edit, approve, or post.

## Audit Trail And Traceability

Write `AuditLog` for:

- upload batch created
- invoice PDF stored/reused
- extraction started/completed/failed
- invoice field edited
- issue added/resolved/ignored
- invoice approved/unapproved
- batch approved
- posting batch created
- posting started
- posting row success/failure/skipped
- posting batch completed
- PDF downloaded, if finance wants access traceability
- QuickBooks customer/vendor/item/account sync started/completed/failed

Keep these direct fields on staged invoices:

- `createdByUserId`
- `approvedByUserId`
- `approvedAt`
- `postedByUserId`
- `postedAt`
- `quickBooksTxnId`
- `quickBooksTxnNumber`
- `quickBooksPostingResult`
- `quickBooksError`

## Search And Recovery Design For Stored PDFs

Search dimensions:

- shipment file number
- invoice number
- customer/vendor name
- QuickBooks customer/vendor display name
- amount
- currency
- invoice date
- due date
- batch number
- upload date
- posting status
- issue code

PDF recovery:

- Authenticated download route checks `tenantId`.
- Download links should be available from staging, approved, posted, profitability file detail, and risk detail.
- Store original file name and normalized display name.
- Store SHA-256 checksum so users can identify duplicate uploads.
- Keep PDFs even after posting.
- Do not delete PDFs when deleting a staging row if another row references the document.

## Testing Plan

Unit tests:

- file number extraction for `OE`, `OI`, `AE`, `AI`, `TR`, and `DR`
- service type mapping
- product/service mapping
- expense/category mapping
- warehouse override rules
- QuickBooks name normalization and CAD/USD matching
- ambiguous match detection
- duplicate invoice detection
- approval validation
- posting fingerprint stability
- FX conversion and missing-FX blocking
- profitability calculations
- risk rule generation

Route/action tests:

- upload rejects unauthenticated requests
- upload rejects disabled module access
- upload rejects `READ_ONLY`
- upload stores only tenant-scoped rows
- staging search cannot see another tenant
- approval requires finance-capable roles
- posting requires `QUICKBOOKS_POSTING`
- posting skips already posted invoice
- PDF download cannot cross tenants

Integration-style tests:

- QuickBooks client builds expected invoice payload.
- QuickBooks client builds expected bill payload.
- QuickBooks posting handles API error and stores row-level error.
- Batch posting partially succeeds without losing failed rows.
- Cashflow rollup updates when invoice posts.

Manual verification:

- `npm run prisma:generate`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run verify:auth` against seeded DB
- QuickBooks sandbox posting test before production credentials are used

## Rollout Plan Split Into PRs

### PR 1: Schema, Module Entitlement, Upload/Staging Shell, Search Shell

Goal:

- Create the safe container for invoice automation without posting or AI complexity.

Work:

- Add invoice automation schema models and migrations.
- Seed/enable `INVOICE_VERIFICATION` and `QUICKBOOKS_POSTING` for Newl Group if not already enabled.
- Add finance nav entry and shell pages.
- Add upload route and document storage service.
- Add staging queue and search page.
- Add tenant-safe PDF download route.
- Add deterministic file-number parser updates, including `DR`.
- Add tests for tenant isolation, upload authorization, search, PDF download, and mapping basics.

### PR 2: Manual Invoice Review/Approval Workflow And Invoice Storage

Goal:

- Make uploaded invoices reviewable and approvable without QuickBooks posting.

Work:

- Add review detail UI.
- Add editable invoice fields.
- Add issue detection and validation.
- Add approve/unapprove actions.
- Add batch approval.
- Link approved rows into `CashflowCustomerInvoice`, `CashflowVendorBill`, and `CashflowFile` where safe.
- Add audit logs.
- Add tests for approval validation and cashflow linkage.

### PR 3: QuickBooks Customer/Vendor Sync And Matching

Goal:

- Populate dropdowns from QuickBooks and suggest matches safely.

Work:

- Add token refresh helper.
- Add QuickBooks query client.
- Sync customers, vendors, items, accounts, tax codes, and terms.
- Store directory cache.
- Add matching service using normalized names, aliases, currency, and legal entity.
- Add mapping settings for product/service and expense/category overrides.
- Add tests for CAD/USD matching and ambiguity.

### PR 4: QuickBooks Posting Batch Workflow

Goal:

- Post approved customer invoices and vendor bills to QuickBooks safely.

Work:

- Add QuickBooks invoice and bill payload builders.
- Add posting batch UI and API.
- Add `AutomationJobRun` posting processor.
- Add row-level result tracking.
- Add idempotency fingerprint enforcement.
- Attach or reference PDFs.
- Store QuickBooks IDs, sync tokens, timestamps, errors, and raw results.
- Add sandbox/manual posting checklist.

### PR 5: Shipment Profitability And Missing Invoice Risk Dashboard

Goal:

- Turn posted/approved invoice records into operational finance insight.

Work:

- Add profitability dashboard by file number, service type, customer/account, and date range.
- Add risk queue.
- Add margin thresholds and settings.
- Extend `CashflowFile` rollups.
- Add search and drill-down pages.
- Add tests for profitability and risk rules.

### PR 6: Teamship Integration, Commission Calculations, And Advanced Analytics

Goal:

- Move beyond invoice uploads toward shipment source-of-truth integration.

Work:

- Integrate Teamship/TMS shipment records.
- Match Teamship customer invoices to uploaded PDFs.
- Add automated shipment-to-invoice matching.
- Add commission calculation from file profits.
- Add close workflow.
- Add negative margin account dashboards and trend analytics.

## Future Phases

- Customer profitability analysis by account, service type, lane, and period.
- Per-shipment profitability with Teamship shipment metadata.
- Per-account profitability and sales owner reporting.
- Commission calculations from shipment file profits.
- Better Teamship/TMS integration.
- Automated matching of Teamship shipments to invoices.
- Dashboard for risky shipments, missing billing, low margins, and negative margin accounts.
- Accounting close workflow.
- Controlled correction workflow for posted QuickBooks records.
- Durable worker for extraction and posting jobs.
- Object storage migration for PDFs.
- AI-assisted extraction with confidence scoring and human review.
- QuickBooks reconciliation import to detect external edits or manual postings.

## Risks And Open Questions

- What is the exact Teamship file number format beyond the prefix examples?
- Are `DR` drayage invoices always trucking expense/category, or should they have a separate QuickBooks mapping?
- Which QuickBooks product/service IDs correspond to Ocean Freight, Air Freight, Trucking, and Warehouse in each legal entity?
- Which QuickBooks expense account IDs correspond to `5014`, `5015`, `5020`, and `5300` in each legal entity?
- How should HST be applied for customer invoices and vendor bills by service type and customer/vendor location?
- Are customer invoice PDFs generated by Teamship guaranteed to contain all posting fields?
- Are vendor invoices single-invoice PDFs, or can one PDF contain multiple invoices?
- What is the maximum expected monthly PDF volume and average PDF size?
- Should Operations be allowed to upload vendor invoices, customer invoices, or both?
- Should Operations be allowed to approve non-accounting fields before Finance approval?
- Should approved but unposted records count in profitability, or only posted records? Recommendation: show both, but default official profitability to posted plus a clear pending amount.
- Should QuickBooks exchange rates be authoritative for reporting, or should Newl use an independent FX source for management reporting?
- Does QuickBooks expose the exact hidden "memo on statement" field through the API for the connected company? Verify in sandbox before PR 4.
- Should Newl attach PDFs to QuickBooks transactions in MVP or only store them in Newl Apps? Recommendation: attach if API support is verified, but do not block MVP if Newl Apps stores the reference.

## Step-By-Step Implementation Checklist

PR 1 checklist:

- Read `reference/PRODUCT_OPERATING_BRIEF.md`, `reference/AUTH_AND_TENANT_CONTEXT.md`, and `reference/CUSTOMER_CASHFLOW_IMPLEMENTATION_NOTES.md`.
- Add Prisma enums and models for documents, batches, staged invoices, QuickBooks directory cache, mapping rules, and posting batches.
- Add tenant-scoped indexes and uniqueness constraints.
- Run `npm run prisma:generate`.
- Add seed updates for `INVOICE_VERIFICATION` and `QUICKBOOKS_POSTING` tenant access if needed.
- Add finance nav entries.
- Add `/finance/invoice-automation` page shell.
- Add upload tab/page.
- Add staging queue tab/page.
- Add approved/posted placeholder tabs.
- Add profitability/risk placeholder tabs that point to future cashflow integration.
- Add PDF upload API route.
- Add PDF download API route.
- Add document storage helper.
- Add invoice search query helper.
- Extend file-number parser for `DR`.
- Add default mapping helper for service type to product/service or expense account name.
- Add audit logs for upload.
- Add Vitest tests for parser, mapping, authorization, tenant isolation, and PDF lookup.
- Run lint, typecheck, build, Prisma generate, and relevant tests.

PR 2 checklist:

- Add invoice detail review page/drawer.
- Add edit action for staged invoice fields.
- Add validation service for approval readiness.
- Add approve single invoice action.
- Add approve reviewed batch action.
- Add issue-generation service.
- Add audit trail display.
- Create/link cashflow records on approval where safe.
- Add tests for missing fields, ambiguous matches, duplicate invoices, read-only blocking, and cashflow linkage.

PR 3 checklist:

- Add QuickBooks token refresh.
- Add QuickBooks query client.
- Add customer/vendor/item/account/tax-code sync job.
- Add directory cache UI in settings.
- Add customer/vendor dropdowns.
- Add matching suggestions and ambiguity flags.
- Add service/account mapping settings.
- Add CAD/USD profile tests.

PR 4 checklist:

- Add QuickBooks invoice payload builder.
- Add QuickBooks bill payload builder.
- Add posting batch creation UI.
- Add posting batch API/job processor.
- Add row-level status updates.
- Add idempotency checks.
- Add QuickBooks PDF attach/reference support after sandbox verification.
- Add tests for payload shape, idempotency, partial failure, and audit logging.

PR 5 checklist:

- Add file profitability query using staged/approved/posted invoice records.
- Update `CashflowFile` rollup service.
- Add risk rule service.
- Add profitability dashboard.
- Add risk queue.
- Add filters by date, customer/account, service type, currency, and posting state.
- Add tests for missing revenue/cost, negative margin, low margin, FX missing, and duplicate invoice rules.

PR 6 checklist:

- Add Teamship/TMS ingestion design.
- Add shipment matching service.
- Add commission calculation design and schema.
- Add close workflow design.
- Add advanced analytics views.

