# Customer Intelligence: Open Questions

> Evidence status: Confirmed from code unless otherwise marked. These items require employee or owner confirmation.

## Confirmed with owner (from the approved Customer Intelligence plan)

- Leadership access means ADMIN, MANAGER, and FINANCE roles only in v1.
- Match/service-rule approval: ADMIN or FINANCE. Settings: ADMIN.
- Sales and operations roles receive no access in v1.
- Identity auto-link threshold is 90; free-mail domains never establish company identity; exact normalized name alone never auto-links.
- The initial history window is 24 months; lifecycle uses a trailing 12-month revenue/open-AR test.
- CAD consolidation is directional management reporting, not statutory accounting.
- Newell's Express defaults unmapped income to `LOCAL_TRUCKING`.
- **CP-02B-3-Q1 — unmatched QuickBooks customers are `MANUAL_ONLY`**: never automatically create or approve a canonical Company from a QuickBooks customer name alone. An unmatched customer remains PROPOSED until a person selects an existing Company or uses the guarded Create-and-Approve control with a separately entered canonical name and explicit confirmation. The latter atomically creates a tenant Company, operating-company relationship, approved match, and audit records; approval without a tenant-valid `companyId` remains impossible.
- **CP-02B-3-Q2 — reconciliation candidates are operating-company-scoped**: automatic reconciliation may consider only canonical companies already associated with the QuickBooks record's operating company. A company without that relationship remains PROPOSED for human review and may still be selected through the guarded manual workflow; it is never auto-linked across operating-company boundaries.
- **CP-02B-5-Q1 — `PNL_DETAIL_PLUS_AGING`**: ProfitAndLossDetail transaction detail is the approved revenue source and AgedReceivablesDetail is the approved open-AR source. Stable transaction identifiers are required; unsupported nested detail or insufficient transaction-currency evidence stops with `LIMITATION` rather than substituting another report or account-level currency.
- **CP-02B-5-Q2 — `COGS_PLUS_OPERATING_COST`**: gross profit is required only for Newl Worldwide, and customer/vendor invoices are connected by shared file number. The confirmed storage correction uses the finance-provided `reference/FINANCE_FS_GROUPINGS_REFERENCE.md` allowlist, associates costs only when every customer invoice on a file resolves to one relationship, and stores each vendor bill's authoritative CAD home amount in its own month under `sourceAccountKey = ALL`, without proportional allocation or independent FX.

## Requires confirmation

- **Lifecycle rollup ordering** (ACTIVE > DORMANT > FORMER > PROSPECT). Inferred; owner to confirm.
- **"Compatible normalized name"** definition (current implementation: normalized equality or token-contained subset of length >= 2). Employee to confirm.
- **Third operating company display name**: confirmed as "Newell's Express and Warehousing Ltd." by owner decision CP-02B-1-Q1 (slug `newells-express`, legal company Newell's Express and Warehousing Ltd.). An unrelated invoice-automation fixture in `tests/invoice-automation-extraction.test.ts` still uses different legal-name strings; the authoritative display/legal name is the owner-confirmed one.
- Whether `READ_ONLY` should ever see Customer Intelligence (v1 excludes it via the leadership guard even though the matrix grants READ_ONLY broad read access).
- Whether two-person approval is required for any identity-match approvals or service-rule changes.
- **Which remaining external integration credentials should move from env fallback to tenant-scoped storage next**: CP-PHASE-02B-1 added the ADMIN-only, audited `OperatingCompany.quickBooksCredentialId` association, and CP-PHASE-02B-2 now consumes it for QuickBooks customer ingestion. Other integration paths that still rely on environment-level fallback remain separate future scope; their migration order requires confirmation.
- **Open AR lifecycle interpretation**: "open AR within the trailing 12 months" is implemented as any `CustomerMonthlyFinancial` row with `nativeOpenAr > 0` whose `monthKey` falls in the trailing 12 months. Open AR is a point-in-time balance, so this is a materialized-month interpretation; confirm whether current open AR (regardless of age) should count instead.
- **Operating-company scoping of identity matches**: `QUICKBOOKS_ACCOUNT` matches now require `operatingCompanyId`. Confirm that a QuickBooks customer record that serves multiple operating companies should be represented as one match per operating company rather than a single company-level match.
- **Address-equivalence heuristics**: confirm whether a future phase may treat street-suffix variants such as `Rd` and `Road` as equivalent. CP-PHASE-02B-3 does not do so; address comparison currently applies case, punctuation, and whitespace normalization only to QuickBooks `Line1`-`Line5`. City, province, postal code, country, and arbitrary address JSON values are explicitly excluded as standalone evidence.
- **File-number pattern (CP-PHASE-02B-5)**: the regex used to extract shipment file numbers from QuickBooks memo/description text (`[A-Z]{2}\d{4,}[A-Z0-9]*`, e.g. `TR0121N1`/`OE123456N1`) is inferred from the approved examples and requires confirmation.
- **Report-column mapping (CP-PHASE-02B-5)**: the ProfitAndLossDetail/AgedReceivablesDetail column-title mapping implemented in `financial-materialization.ts` (e.g. "Txn ID", "Memo/Description", "Total", aging bucket titles) is inferred from the QuickBooks report layout and requires confirmation against a live report sample.
- **Finance production mapping follow-ups (CP-PHASE-02B-5)**: confirm whether Worldwide `4000 Storage` always maps to warehousing, whether `5030 Delivery Rate` remains trucking, and whether grouped-code reporting should be surfaced. These follow-ups do not change the confirmed direct-cost account allowlist or permit arbitrary Expense/Other Expense accounts.
- **Income transaction-type matrix (CP-PHASE-02B-5)**: confirm every ProfitAndLossDetail income transaction type that is authoritative customer revenue beyond Invoice/Credit Memo and its sign semantics. Unrecognized income-bearing detail currently stops with `LIMITATION` rather than understating revenue.
- **Aging snapshot semantics (CP-PHASE-02B-5)**: the open-AR aging snapshot is materialized under the as-of date's month with service line `OTHER`; open AR is a point-in-time balance, and the lifecycle interpretation of "open AR within the trailing 12 months" is a materialized-month interpretation (already flagged above).

## Retired historical legacy-backfill questions (CP-02A-BF-1..7)

These questions are retained only as retired historical material. The legacy
Cashflow backfill is not part of the Customer Intelligence plan, and no phase 2
work depends on it. No Customer Intelligence phase reads or writes
`CashflowCustomer`, `CashflowLegalEntity`, or other Cashflow records. These
questions are not active gates or approved business rules.

- **CP-02A-BF-1 — Lifecycle and revenue dates for backfilled rows**: which `CustomerLifecycle` is assigned to each backfilled relationship, and how are `firstRevenueDate`/`lastRevenueDate` derived from the legacy `CashflowCustomer` history when the backfill creates `CompanyOperatingRelationship` rows?
- **CP-02A-BF-2 — `businessLine`-row collapse policy**: `CashflowCustomer` is unique on `(tenantId, companyId, legalEntity, businessLine)`, so one company can span multiple legacy rows. Which policy collapses those rows into the single `CompanyOperatingRelationship` per `(tenantId, companyId, operatingCompanyId)`, and which fields win or aggregate during the collapse?
- **CP-02A-BF-3 — Inactive rows**: how are legacy rows with `active = false` treated by the backfill — do they produce relationships at all, and what `status`/`lifecycle` do they receive?
- **CP-02A-BF-4 — Ambiguous/missing-mapping policy**: what happens when a legacy row maps to no canonical company, or to more than one — skip-and-report, a review list, or fail the backfill — and what exactly counts as "ambiguous"?
- **CP-02A-BF-5 — Reconciliation-report scope and persistence**: what does the backfill reconciliation report contain — counts, ambiguous/missing detail, per-operating-company counts, and a financial baseline while `CustomerRevenueLine` remains empty until CP-PHASE-02B — and where is that report persisted (`AuditLog` vs documentation vs a data model)?
- **CP-02A-BF-6 — Backfill mechanism**: is the backfill a pure SQL migration executed through the preview migrate-deploy runbook, or a guarded idempotent service action behind a distinct human approval enforced by deterministic code?
- **CP-02A-BF-7 — `newells-express` zero-row confirmation**: confirm that zero legacy rows map to the `newells-express` operating company, and that this expected result is validated and reported — never inferred — as part of the backfill reconciliation.

## Retired additional builder backfill questions (CP-02A-BFX-1..6)

These questions were raised while preparing the now-retired backfill design.
They are preserved solely for historical traceability and do not gate any
Customer Intelligence phase.

- **CP-02A-BFX-1 — Backfill scope**: which legacy `CashflowCustomer` rows are in scope for the relationship backfill (all tenants, only `newl-group`, active rows only, both legal entities, archived rows)? Inferred starting position for discussion: tenant-scoped per authenticated/ingestion context, every tenant that has `CashflowCustomer` rows.
- **CP-02A-BFX-2 — Canonical company resolution**: the backfill reads `CashflowCustomer.companyId`; what happens to rows whose `companyId` is missing or whose referenced `Company` is absent or soft-deleted?
- **CP-02A-BFX-3 — Conflict and re-run semantics**: `CompanyOperatingRelationship` is unique on `(tenantId, companyId, operatingCompanyId)`. On re-run, should backfill keep the first relationship (`DO NOTHING`), refresh lifecycle fields (`DO UPDATE`), or never touch a manually created relationship?
- **CP-02A-BFX-4 — Source-account backfill**: should `CustomerSourceAccount` rows be backfilled from `CashflowCustomer`/`CashflowCustomerAlias`, and which fields (realm id, QuickBooks customer id, display name, currency) are authoritative?
- **CP-02A-BFX-5 — Approval and evidence gate**: what evidence must the owner approve before the backfill runs (dry-run counts, tenant scope, preview upgrade-path result), and is a distinct human approval enforced by deterministic code required per the repository human-approval boundaries?
- **CP-02A-BFX-6 — Former phase-2 dependency premise**: retired. Phase 2 does not depend on a Cashflow backfill, and no Customer Intelligence phase reads or writes Cashflow records.

CP-02A-BF-1..7 and CP-02A-BFX-1..6 are retired and require no answers for
Customer Intelligence delivery. Any future proposal to interact with legacy
Cashflow records would be new, separately owner-gated scope.

## Explicitly out of Phase 1 and CP-PHASE-02A

- Live Microsoft 365 mailbox sync, QuickBooks sync, Brave research, Apollo, and customer communication.
- Applying the migration to any database outside an isolated preview database (preview validation runbook in `docs/modules/customer-intelligence/testing.md`).
- Any UI, API routes, or nav for Customer Intelligence.
- QuickBooks ingestion, settings/connection UI, Customer Profile UI, Microsoft 365, Brave/Hunter, Apollo, Teamship, scheduling, or any production write (all later-phase exclusions confirmed by CP-PHASE-02A).
