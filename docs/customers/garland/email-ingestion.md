# Garland: Email Ingestion

> Evidence status: Confirmed from code unless otherwise marked.


Garland-specific implementation is part of Shipment Documents. Evidence files include `src/modules/shipment-documents/garland-email-intake.ts`, `garland-email-agent-automation.ts`, `garland-pdf-server-extraction.ts`, `teamship-review.ts`, `teamship-review-types.ts`, `garland-product-dimensions.ts`, `garland-product-dimension-directory.ts`, `teamship-update-jobs.ts`, `teamship-phase2-agent-execution.ts`, Teamship API routes under `src/app/api/shipment-documents/teamship-review`, pages under `src/app/(authenticated)/shipment-documents/teamship-review`, `src/data/garland-product-dimensions.json`, tests named `garland-*` and `teamship-*`, and `reference/GARLAND_TEAMSHIP_REVIEW_FINDINGS.md`.

## Confirmed workflow

```mermaid
flowchart TB
  Graph[Microsoft Graph mailbox] --> Intake[Garland email intake]
  Intake --> Email[GarlandSourceEmail]
  Intake --> Attach[GarlandSourceAttachment]
  PDF[PDF extraction] --> Parse[Garland PS/SR/order parsing]
  Parse --> Review[Teamship review run/order]
  Teamship[Teamship API/UI evidence] --> Review
  Review --> Human[Human review/approval]
  Human --> Job[TeamshipUpdateJob]
  Job --> Worker[Phase 2 dry-run or live worker]
  Worker --> TeamshipUpdate[Teamship update if explicitly allowed]
```

Emails are classified using Garland-domain, PS-range, order/page-count, attachment, and correction signals. Attachments are hashed for duplicate detection. Parsed PDF pages extract PS number, SR number, ship-to data, PO, freight terms, order date, ship-via, instructions, and item rows when present. Teamship review compares Garland parsed data with Teamship details.

The scheduled attachment queue prioritizes the most recently received unprocessed Garland PDFs. A `PDF_PARSE_FAILED` attachment is not retried by normal scheduled runs because a permanently failing older PDF must not consume the bounded queue and delay a newer order. Failed PDFs can be retried only through an explicit operator-controlled retry.

`Scan now` refreshes Microsoft Graph email intake only. When an email was saved but its review processor was missed, an authenticated operator with Shipment Documents mutation access can select **Run Teamship review** on that exact Email Intake batch. The action requires an explicit confirmation, submits only the tenant-scoped ready or retry-pending PDF attachment identifiers shown in that batch, records request and completion audits, and invokes the same deterministic Garland review/update preparation used by the scheduled processor. It does not print.

When a newly parsed PDF contains orders but none of them are yet visible in Teamship, the attachment remains pending and becomes eligible for another scheduled lookup after 5 minutes. This bounded timing-race retry runs at most three times and is not used for a partially matched batch.

## Pallet and printing notes

Pallet dimensions, serials, weight, and SKU observations are represented in Teamship review/update types and `GarlandProductDimensionObservation`. The UPS special dimension rule is confirmed in existing documentation and tests should be consulted before changing it. Printer mappings, duplicate print protection, and a general print service were not located; production printing requires explicit human approval.

## Open questions

- Final employee-approved Garland order lifecycle terms. Requires employee confirmation.
- Exact Teamship screen behaviour outside coded API/UI selectors. Requires employee confirmation.
- Whether any customer communications can be automated. Requires owner confirmation.
