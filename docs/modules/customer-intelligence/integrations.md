# Customer Intelligence: Integrations

> Evidence status: CP-PHASE-02B-1 adds the connection model for all three
> operating companies (code and tests only; no OAuth initiation and no live
> connection). CP-PHASE-02B-2 adds the read-only, idempotent QuickBooks customer
> ingestion. The final design is read-only toward Microsoft 365 and QuickBooks;
> no QuickBooks write is ever performed.

## Connection model (CP-PHASE-02B-1)

- The QuickBooks OAuth app is **shared** by all three operating companies (owner decision
  CP-02B-1-Q2, `SAME_APP`): Newl Worldwide, Newl USA, and Newell's Express and Warehousing
  Ltd. each connect through the same OAuth app but keep their own QuickBooks realm/company
  connection. The approved production redirect URL is
  `https://newl-apps.vercel.app/api/integrations/quickbooks/callback`; it is the default in
  `src/server/integrations/quickbooks.ts` and the `QUICKBOOKS_REDIRECT_URI` env override is
  only for preview/sandbox runs.
- Connections are **operating-company-keyed** (owner decision CP-02B-1-Q1,
  `OPERATING_COMPANY_KEYED`): the connect API and the signed OAuth state carry the stable
  operating-company slug (`newl-worldwide`, `newl-usa`, `newells-express`). The legacy
  `NEWL_WORLDWIDE`/`NEWL_USA` legal-entity keys are preserved in stored credential
  `publicConfig.legalEntity` so the existing two connections keep working; the callback
  bridges slug -> legacy key on write (`quickBooksSlugToLegalEntity`).
- The connect route requires `entity` to be one of the three slugs and rejects legacy keys
  and unknown values with 400. The callback derives the connection name and stored legal
  entity from the slug, so all three operating companies write distinct
  `IntegrationCredential` rows (e.g. `QuickBooks - Newell's Express and Warehousing Ltd.`).

## Operating-company credential association

- `associateQuickBooksCredential` (in `src/modules/customer-intelligence/actions.ts`) writes
  the loose `quickBooksRealmId` / `quickBooksCredentialId` references on `OperatingCompany`.
  It is **ADMIN-only** (`requireAdminSettings` + `requireWrite`) and every successful
  association writes an `AuditLog` (`customer-intelligence.operating-company.quickbooks-associated`).
- Validation is deterministic and tenant-scoped: the operating company and the credential
  must belong to the caller's tenant; the credential must be `provider = QUICKBOOKS` and
  `status = ACTIVE`; and the supplied `quickBooksRealmId` must equal the realm stored in the
  credential's `publicConfig`. Transaction-scoped advisory locks serialize claims on both
  the credential ID and realm ID; a connection already associated with another operating
  company in the tenant is rejected before any update. Cross-tenant, duplicate, or
  mismatched references are rejected before any write.
- `registerOperatingCompany` does not accept or persist either QuickBooks association field,
  including when an untyped runtime caller supplies them. All association writes must pass
  through the validated and audited `associateQuickBooksCredential` action; operating-company
  registration cannot bypass the tenant/provider/ACTIVE-status/realm checks.
- Connecting a QuickBooks company never auto-enables live synchronization (owner decision
  CP-02B-8-Q1): live sync needs a separate tenant- and operating-company-scoped enablement
  record that is not part of this phase and any migration for it remains separately
  owner-gated.

## Read-only QuickBooks customer ingestion (CP-PHASE-02B-2)

- **Entry point**: `runQuickBooksCustomerIngestion` in
  `src/modules/customer-intelligence/actions.ts` — an ADMIN-triggered, tenant-scoped,
  audited action (guard `requireIngestionAdmin` in `permissions.ts`). MANAGER, SALES,
  OPERATIONS, READ_ONLY, and FINANCE are denied even for a dry run. Every live run writes an
  `AuditLog` (`customer-intelligence.quickbooks-ingestion.run`); skipped companies and
  errors write their own audited warnings.
- **Transport is GET-only**: customer records are fetched from
  `GET /v3/company/{realmId}/query` with `select * from Customer startposition N maxresults 1000`
  pagination (`src/modules/customer-intelligence/quickbooks-ingestion.ts`). The access token is
  carried by the request `Authorization` header and is never embedded in the query URL. No
  QuickBooks POST/PUT is ever issued. Tests mock `fetch`; pagination mocks parse the encoded
  `query` parameter with the URL API and assert the exact `startposition` progression.
- **Operating-company resolution**: each operating company resolves its associated
  tenant-scoped credential through `quickBooksCredentialId`/`quickBooksRealmId`. Companies
  without an associated credential, or whose credential is missing / not
  `QUICKBOOKS` / not `ACTIVE`, are **skipped with an audited warning** — never guessed.
- **Token refresh**: `getUsableQuickBooksAccessToken` reuses `refreshQuickBooksAccessToken`
  when the stored access token is expired (2-minute freshness buffer). The rotated tokens
  are persisted with an `(id, tenantId)`-constrained update that must affect exactly one
  credential; a foreign or missing tenant-owned credential fails closed. In `dryRun` mode a
  refresh would be a write, so an expired token is reported as a limitation instead of
  being refreshed.
- **Owner-approved staging model (CP-02B-2-Q1, `MATCH_EVIDENCE`)**: no staging table and no
  new migration were needed. New unmatched customers are persisted as `PROPOSED`
  `CustomerIdentityMatch` rows (`QUICKBOOKS_ACCOUNT`, initially `companyId = null`) with the
  available evidence (display/company/given/family names, email, phone, addresses, currency,
  parent account, active status, notes, and last-updated timestamp). A valid QuickBooks customer
  ID remains reviewable even when every descriptive field is absent: its source label is null
  and its evidence contains only the deterministic source marker. No `Company` is created or
  approved (CP-02B-3-Q1, `MANUAL_ONLY`) until a person makes that decision.
- **Idempotency**: matched customers upsert the `CustomerSourceAccount` keyed by
  `(tenantId, realmId, quickBooksCustomerId)` and refresh `lastSyncedAt`. Re-runs never
  overwrite reviewed identity decisions: an existing `APPROVED` match is authoritative for
  matching, and an existing `APPROVED`/`REJECTED` match is returned unchanged. Match,
  proposal, and source-account resolution also require the current `operatingCompanyId`;
  evidence owned by another operating company is never resolved, moved, or refreshed.
  Reviewed `APPROVED`/`REJECTED` decisions are detected by tenant, kind, source key, and
  operating company independently of `companyId`, so a rejection remains authoritative even
  when a reviewer selected a canonical company before rejecting it. Under the same
  transaction-scoped PostgreSQL advisory lock, an existing `PROPOSED` row is also resolved by
  that source ownership key independently of `companyId`. Fresh source label/evidence replaces
  only those unreviewed source fields (including removal of evidence QuickBooks no longer
  supplies), advancing Prisma's `updatedAt`; human-selected `companyId`, `candidateCompanyId`,
  score, reviewer, and review timestamp are preserved. An identical rerun performs no proposal
  update. After waiting, a concurrent losing rerun therefore refreshes or returns the single
  authoritative proposal/reviewed decision and never creates a second null-company proposal.
  This is a migration-free backstop for PostgreSQL's nullable-unique semantics; no schema
  change is introduced. Source-account ownership uses a separate transaction-scoped lock
  over the complete tenant/realm/customer key. Its ownership check and upsert therefore run
  atomically: a concurrent loser for another operating company observes the winner and fails
  closed instead of moving the source account.
- **Missing fields are never invented**: partial or completely missing QuickBooks fields are
  stored as `null` (or omitted from proposed-match evidence). Nullable source-account email,
  phone, address, and parent-account evidence is explicitly cleared when it disappears on a
  refresh. `CustomerSourceAccount.currency` and `active` are required; because no
  owner-approved fallback exists, a matched customer missing either source field or the
  schema-required source-account display name is skipped and reported without changing prior
  data. An unmatched valid ID with no descriptive fields still remains a `PROPOSED` review
  record; only a source record with no QuickBooks `Id` is discarded entirely.
- **Safe error evidence**: reports and audit entries use bounded deterministic failure
  classifications. Arbitrary QuickBooks/OAuth response bodies and thrown provider text are not
  copied into a report or `AuditLog`, preventing upstream tokens or customer content from being
  persisted as diagnostic text. The detailed ADMIN result may contain record-level warnings,
  but the terminal `AuditLog` stores only timestamps, status/count summaries, and aggregate
  totals—never customer IDs, names, contact evidence, or warning text. A per-record processing
  failure increments sanitized `recordErrors`/`skipped` counts and does not prevent remaining
  records or the terminal run audit from completing.
- **Dry-run**: `{ dryRun: true }` performs zero database writes (no source-account upserts,
  no match proposals/refreshes, no audits) and performs the same tenant- and
  operating-company-scoped proposal reads and structural evidence comparison as the live path.
  Per-company and total counts distinguish new proposals (`unmatchedProposed`), evidence
  refreshes (`unmatchedRefreshed`), unchanged proposals (`unmatchedUnchanged`), and preserved
  reviewed decisions; unchanged/reviewed rows are never described as would-change writes.
- **Matched-customer relationship guard**: a matched customer whose
  `(companyId, operatingCompanyId)` relationship does not yet exist is skipped and reported
  as a warning rather than inventing a relationship.

## Phase 1 (foundation)

The foundation records (`CustomerSourceAccount`, `CustomerRevenueLine`,
`CustomerMonthlyFinancial`, `CustomerFxRate`, `ContactPoint`, `ContactEvidence`,
`CustomerIdentityMatch`) are the storage and identity contract that later integration phases
write into.

## Final design intent (not yet implemented)

- **Microsoft 365**: app-only `Mail.Read` via `client_credentials` (see `src/server/integrations/microsoft-graph-application.ts`). Read-only; no mail-write or send permission. Excludes archive mailboxes in v1.
- **QuickBooks**: GET-only customer sync is implemented in CP-PHASE-02B-2
  (`quickbooks-ingestion.ts`). GET-only report sync (revenue, AR aging detail), webhooks,
  CDC recovery, reconciliation, and the job ledger are later phases. No posting.
- **Brave / Hunter cross-sell**: a later `CUSTOMER_CROSS_SELL` research mode. Research may create a reviewable opportunity only; no outreach.
- **Identity matching**: a later phase persists auto-linked matches into `CustomerIdentityMatch` with score >= 90 and no conflicting company.

## Secrets

QuickBooks realm and credential relationships are stored as `quickBooksRealmId` /
`quickBooksCredentialId` on `OperatingCompany` (loose references validated in
`associateQuickBooksCredential`). No secrets are stored in Customer Intelligence records;
real OAuth tokens remain in `IntegrationCredential.secretRef` (encrypted) and environment
variables. The settings page renders realm, company, and environment metadata only and never
renders `secretRef` or token values.
