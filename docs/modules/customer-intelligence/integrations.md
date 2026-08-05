# Customer Intelligence: Integrations

> Evidence status: Phase 1 ships no external integration calls. The final design is read-only toward Microsoft 365 and QuickBooks.

## Phase 1 (this PR)

No Microsoft 365, QuickBooks, Brave, or Apollo client is implemented. The foundation records (`CustomerSourceAccount`, `CustomerRevenueLine`, `CustomerMonthlyFinancial`, `CustomerFxRate`, `ContactPoint`, `ContactEvidence`, `CustomerIdentityMatch`) are the storage and identity contract that later integration phases write into.

## Final design intent (not yet implemented)

- **Microsoft 365**: app-only `Mail.Read` via `client_credentials` (see `src/server/integrations/microsoft-graph-application.ts`). Read-only; no mail-write or send permission. Excludes archive mailboxes in v1.
- **QuickBooks**: GET-only customer/report sync reusing the existing OAuth client in `src/server/integrations/quickbooks.ts`. Webhooks, CDC recovery, reconciliation, and job ledger are later phases. No posting.
- **Brave / Hunter cross-sell**: a later `CUSTOMER_CROSS_SELL` research mode. Research may create a reviewable opportunity only; no outreach.
- **Identity matching**: a later phase persists auto-linked matches into `CustomerIdentityMatch` with score >= 90 and no conflicting company.

## Secrets

QuickBooks realm and credential relationships are stored as `quickBooksRealmId` / `quickBooksCredentialId` on `OperatingCompany` (loose references validated in service code). No secrets are stored in Customer Intelligence records; real credentials remain in `IntegrationCredential.secretRef` and environment variables.
