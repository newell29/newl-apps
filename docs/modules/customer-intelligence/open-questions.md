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

## Explicitly out of Phase 1

- Live Microsoft 365 mailbox sync, QuickBooks sync, Brave research, Apollo, and customer communication.
- Applying the migration to any database outside an isolated preview database.
- Any UI, API routes, or nav for Customer Intelligence.
