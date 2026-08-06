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

## Requires confirmation

- **Lifecycle rollup ordering** (ACTIVE > DORMANT > FORMER > PROSPECT). Inferred; owner to confirm.
- **"Compatible normalized name"** definition (current implementation: normalized equality or token-contained subset of length >= 2). Employee to confirm.
- **Third operating company display name**: "Newell's Express and Warehousing Ltd." per the plan. Note `tests/invoice-automation-extraction.test.ts` references a different legal-name string; confirm which name is authoritative.
- Whether `READ_ONLY` should ever see Customer Intelligence (v1 excludes it via the leadership guard even though the matrix grants READ_ONLY broad read access).
- Whether two-person approval is required for any identity-match approvals or service-rule changes.
- Which external integration credentials should move from env fallback to tenant-scoped `OperatingCompany.quickBooksCredentialId` first.
- **Open AR lifecycle interpretation**: "open AR within the trailing 12 months" is implemented as any `CustomerMonthlyFinancial` row with `nativeOpenAr > 0` whose `monthKey` falls in the trailing 12 months. Open AR is a point-in-time balance, so this is a materialized-month interpretation; confirm whether current open AR (regardless of age) should count instead.
- **Operating-company scoping of identity matches**: `QUICKBOOKS_ACCOUNT` matches now require `operatingCompanyId`. Confirm that a QuickBooks customer record that serves multiple operating companies should be represented as one match per operating company rather than a single company-level match.

## Blocking legacy-backfill policy questions (CP-02A-BF-1..7)

These questions gate the legacy-cashflow backfill that phase 2 depends on. The backfill phase is **owner-gated**: no backfill migration may be written, reviewed, or scheduled until the owner confirms CP-02A-BF-1..7. All seven are inferred policy questions, not approved business rules, and must never be presented as approved.

- **CP-02A-BF-1 — Lifecycle and revenue dates for backfilled rows**: which `CustomerLifecycle` is assigned to each backfilled relationship, and how are `firstRevenueDate`/`lastRevenueDate` derived from the legacy `CashflowCustomer` history when the backfill creates `CompanyOperatingRelationship` rows?
- **CP-02A-BF-2 — `businessLine`-row collapse policy**: `CashflowCustomer` is unique on `(tenantId, companyId, legalEntity, businessLine)`, so one company can span multiple legacy rows. Which policy collapses those rows into the single `CompanyOperatingRelationship` per `(tenantId, companyId, operatingCompanyId)`, and which fields win or aggregate during the collapse?
- **CP-02A-BF-3 — Inactive rows**: how are legacy rows with `active = false` treated by the backfill — do they produce relationships at all, and what `status`/`lifecycle` do they receive?
- **CP-02A-BF-4 — Ambiguous/missing-mapping policy**: what happens when a legacy row maps to no canonical company, or to more than one — skip-and-report, a review list, or fail the backfill — and what exactly counts as "ambiguous"?
- **CP-02A-BF-5 — Reconciliation-report scope and persistence**: what does the backfill reconciliation report contain — counts, ambiguous/missing detail, per-operating-company counts, and a financial baseline while `CustomerRevenueLine` remains empty until CP-PHASE-02B — and where is that report persisted (`AuditLog` vs documentation vs a data model)?
- **CP-02A-BF-6 — Backfill mechanism**: is the backfill a pure SQL migration executed through the preview migrate-deploy runbook, or a guarded idempotent service action behind a distinct human approval enforced by deterministic code?
- **CP-02A-BF-7 — `newells-express` zero-row confirmation**: confirm that zero legacy rows map to the `newells-express` operating company, and that this expected result is validated and reported — never inferred — as part of the backfill reconciliation.

## Additional builder backfill questions (new IDs, not part of the approved plan's seven)

These questions were raised while preparing the backfill design. They are distinct from CP-02A-BF-1..7 and carry their own IDs; they must never be mistaken for (or renumbered into) the approved plan's IDs. They gate the same owner-gated backfill phase.

- **CP-02A-BFX-1 — Backfill scope**: which legacy `CashflowCustomer` rows are in scope for the relationship backfill (all tenants, only `newl-group`, active rows only, both legal entities, archived rows)? Inferred starting position for discussion: tenant-scoped per authenticated/ingestion context, every tenant that has `CashflowCustomer` rows.
- **CP-02A-BFX-2 — Canonical company resolution**: the backfill reads `CashflowCustomer.companyId`; what happens to rows whose `companyId` is missing or whose referenced `Company` is absent or soft-deleted?
- **CP-02A-BFX-3 — Conflict and re-run semantics**: `CompanyOperatingRelationship` is unique on `(tenantId, companyId, operatingCompanyId)`. On re-run, should backfill keep the first relationship (`DO NOTHING`), refresh lifecycle fields (`DO UPDATE`), or never touch a manually created relationship?
- **CP-02A-BFX-4 — Source-account backfill**: should `CustomerSourceAccount` rows be backfilled from `CashflowCustomer`/`CashflowCustomerAlias`, and which fields (realm id, QuickBooks customer id, display name, currency) are authoritative?
- **CP-02A-BFX-5 — Approval and evidence gate**: what evidence must the owner approve before the backfill runs (dry-run counts, tenant scope, preview upgrade-path result), and is a distinct human approval enforced by deterministic code required per the repository human-approval boundaries?
- **CP-02A-BFX-6 — Phase-2 dependency**: confirm that phase 2 (QuickBooks ingestion and the Customer Profile UI) must not start until the approved backfill policy and the backfill migration are delivered and validated in preview.

Until CP-02A-BF-1..7 are confirmed, no legacy-backfill work may be presented as approved or scheduled; the additional CP-02A-BFX-1..6 questions gate the same backfill phase.

## Explicitly out of Phase 1 and CP-PHASE-02A

- Live Microsoft 365 mailbox sync, QuickBooks sync, Brave research, Apollo, and customer communication.
- Applying the migration to any database outside an isolated preview database (preview validation runbook in `docs/modules/customer-intelligence/testing.md`).
- Any UI, API routes, or nav for Customer Intelligence.
- QuickBooks ingestion, settings/connection UI, Customer Profile UI, Microsoft 365, Brave/Hunter, Apollo, Teamship, scheduling, or any production write (all later-phase exclusions confirmed by CP-PHASE-02A).
