# Garland: Review Workflow

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

If a saved Email Intake batch was not picked up by the scheduled review processor, an authorized employee can start only that batch from Email Intake. Newl Apps revalidates the exact attachment identifiers and the displayed PS range within the authenticated tenant before processing. A retry-pending batch may be started immediately by this explicit action; unrelated queued attachments remain untouched. The confirmation explains that the established Garland automation may prepare and approve its supported Teamship cleanup jobs, while printing remains a separate approved workflow.

Exact Garland PS/SR lookups have a separate bounded Teamship pagination allowance from the ordinary daily-order listing. This is necessary because Teamship's shipping-order list can place current orders beyond the first 15,000 returned rows even when descending ordering is requested. The exact lookup continues through at most 100 capped pages (50,000 rows at the default page size), stops as soon as every requested PS/SR pair is confirmed, and reports its scan depth and stop reason when no exact match is found.

Garland PS numbers are the unique shipment-document identity for matching PDF orders to Teamship. SR numbers can repeat in Teamship, so the review should prefer exact PS/pack-slip matches and use SR-only matching only when the SR cannot conflict with a different Teamship PS number.

Teamship list pagination must advance by the number of rows Teamship actually returns. Teamship can cap a requested page below Newl Apps' requested limit, so a shorter response is not proof that the list has ended. Newl Apps stops only on an empty page, a repeated page, the configured safety-page limit, or after every requested PS/SR has been matched.

For a Teams-uploaded multi-order PDF, the CSR must name one exact PS or SR number. Newl Apps stores the complete PDF as source evidence but filters the parsed orders before querying Teamship. An exact PS selects one order. An SR is accepted only when it selects one PDF order; if it repeats, Nemo asks for the PS number. Missing or unmatched references stop without a Teamship query, and the saved response names the selected PS/SR plus the number of other PDF orders ignored.

Employee feedback about these reviews is grouped into stable root-cause families. New reports do not create another development approval while the same family already has an approved Rivet fix; they remain follow-up evidence until the reviewed PR is explicitly recorded as deployed. Evidence reported after that point is presented as one linked regression family.

An employee report remains unapproved evidence until an administrator reviews it. The administrator chooses whether the issue is an incorrect order decision, incorrect/missing Teamship field update, missed processing, notification/response problem, or another workflow problem. Decision issues compare Nemo's original decision with the correct decision. Field-update issues capture the exact Teamship field and actual/correct values instead of forcing a misleading PASS/FAIL mismatch.

Incorrect or missing Teamship updates require the exact saved PS/SR review and its source PDF, or a supporting PDF/image, before confirmation. For a review created from Garland email intake, Newl Apps automatically re-fetches the original PDF through its saved Microsoft Graph message and attachment identifiers, requires an exact filename/PS/SR match, verifies the parsed content hash, and caches the verified bytes as the review artifact. If the email is no longer retrievable, the match is ambiguous, or the problem is visible only in Teamship, the administrator supplies the exact PDF or screenshot. The saved review contributes its exact page numbers and parsed/review snapshot. After confirmation and a queue refresh, the administrator can add **Your instructions for Rivet** on the awaiting-approval suggestion. Only confirmed feedback and its immutable evidence manifest can enter a Rivet packet.

Approving a Garland suggestion records the decision immediately. If a Garland Rivet job is already queued, running, or review-blocked, the later suggestion is shown as **APPROVED — WAITING FOR RIVET** and retains its frozen packet. The worker automatically claims it after the earlier Garland job finishes or is resolved; it does not create overlapping Garland branches.

## Pallet and printing notes

Pallet dimensions, serials, weight, and SKU observations are represented in Teamship review/update types and `GarlandProductDimensionObservation`. The UPS special dimension rule is confirmed in existing documentation and tests should be consulted before changing it. Printer mappings, duplicate print protection, and a general print service were not located; production printing requires explicit human approval.

## Open questions

- Final employee-approved Garland order lifecycle terms. Requires employee confirmation.
- Exact Teamship screen behaviour outside coded API/UI selectors. Requires employee confirmation.
- Whether any customer communications can be automated. Requires owner confirmation.
