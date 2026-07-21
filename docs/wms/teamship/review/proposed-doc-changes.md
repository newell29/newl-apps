# Proposed Teamship Documentation Changes

Status: Draft. Alex supplied written business-rule confirmations on 2026-07-20. Selected narrow Draft changes are now applied; broader workflow expansion remains proposed.

The following changes should be reviewed before any operational document is promoted from Draft. Owner-written statements are preserved; proposals add evidence, narrow absolute claims, or replace stale `transcript pending` notes.

## Minimal Changes Applied In This Reconciliation

| File | Minimal edit | Why |
| --- | --- | --- |
| `README.md` | Replace the stale `narration not transcribed` status with a link to the Draft reconciliation and retain the missing Record & Replay limitation. | Evidence state changed; no operating rule is promoted. |
| `evidence-ledger.md` | Record the external transcript artifacts, visual set, and review folder; keep all narration claims pending operational approval. | Makes source classification auditable. |
| Existing navigation/screen/overview/question/troubleshooting drafts | Replace only stale `transcript missing` status sentences with links or pointers to the Draft review artifacts. | Prevents the repository from claiming no transcript exists; no operational content is promoted. |

## Draft Changes Applied After Alex's Written Answers

| File | Applied Draft content | Evidence boundary |
| --- | --- | --- |
| `glossary.md` | Annagem, Nemo, LPN, inbound/outbound status meanings, Bulk/E-commerce, Picking/Packing, document behavior, QAD, and the Zeal naming distinction. | `confirmed by Alex`; exact UI-label differences remain visible. |
| `inventory/overview.md` | On Hand/Reserved/Available formula, SKU-only All view, quarantine/serial qualification, and LPN handling-unit meaning. | `confirmed by Alex`; Backordered and quarantine presentation remain open. |
| `shipping-orders/overview.md` | Open/Closed meanings, Bulk/E-commerce, Picking/Packing, and per-control print/download behavior. | `confirmed by Alex`; Complete/Closed and carrier status remain open. |
| `troubleshooting.md` | User-specific views, inbound SKU fallback, alternative serial guidance, SKU-level availability qualification, and print-control distinctions. | Confirmed points are labeled; remaining inferences stay separate. |
| `safety-rules.md` | Teamship role/warehouse/customer scope and known real-print side effects. | Business meaning confirmed; live execution remains prohibited. |
| `open-questions.md` | Removed answered business questions and retained only focused UI/access/promotion gaps. | No unresolved item was silently closed. |

## Proposed Changes Requiring Review

| Destination | Proposed Draft change | Reconciliation IDs | Evidence / approval boundary |
| --- | --- | --- | --- |
| `navigation.md` | Add login landing page, user-scoped warehouse access, screen-specific search behavior, saved-view/filter warning, and Inventory Orders versus Receiving Order naming. | T002-T007, T010, T014, T029, T047 | UI presence is strong; permission and naming meanings need admin/warehouse confirmation. |
| `screen-map.md` | Add exact Inventory tabs; Receiving Order detail fields; e-commerce picking/packing screens; product-history entry point; invoice tabs; User Directory fields; customer account options. | T024, T038, T069-T073, T077-T083, T084-T098 | Mostly visual. Sensitive fields should be named, not populated with examples. |
| `glossary.md` | Add scoped definitions for Available, Reserved, On Hand, Quarantine, Open, On Hold, Draft, Complete, Packing Queue, Outstanding transaction, Generated invoice, stock attribute, EDI field, and Teamship role. | T012, T027-T028, T031, T039, T042-T045, T071, T078, T084, T087, T094, T097 | Meanings stated by Alex; warehouse/CSR/finance/admin sign-off still required. |
| `glossary.md` | Change LPN evidence from inference to `confirmed by Alex as stated`; retain `pallet identifier` as pending warehouse confirmation. | T016-T018 | Narration and visual grouping support the term, not all exceptions. |
| `safety-rules.md` | Add quarantine restrictions, saved-view/filter risk, BOL autosave risk, Release Hold, Start Picking, Fetch Rates, Generate Label, Create Invoice, customer directory confidentiality, and printer routing controls. | T027-T029, T043, T048-T050, T057-T067, T073, T080, T088, T092-T098 | Safety restrictions can be conservative while exact operating permissions remain unapproved. |
| `troubleshooting.md` | Replace inferred placeholders with evidence-led cases: hidden rows from saved views, inbound SKU search limitation, unavailable/requested-serial checks, late pick completion, billing search false positives, and carrier-status ambiguity. | T026, T029, T037, T058, T074, T091 | Do not state root causes as certain unless the relevant status is verified. |
| `open-questions.md` | Replace `transcript missing` questions with the compact confirmation set in `confirmation-checklist.md`. | All | Transcript exists; approval and terminology are now the gaps. |
| `inventory/overview.md` | Add exact All/Ship by LPN/Inventory by Location purposes and visually confirmed columns; add Alex-stated quantity/quarantine/inbound-release meanings as pending warehouse confirmation. | T010-T028, T031-T039 | UI facts high confidence; operational rules remain Draft. |
| `inventory/workflows.md` | Split customer/SKU/LPN/location searches, quarantine inspection, incoming-stock lookup, completed-receipt detail, product history, and LPN history into separate read-only workflows. | T015, T019-T028, T033-T038, T079, T082-T083 | Keep write actions out of documentation workflows. |
| `shipping-orders/overview.md` | Add bulk/e-commerce distinction, status tabs, customer EDI fields, BOL source/override behavior, attachments, pallet fields, picking/packing views, and tracking layers. | T040-T056, T069-T075 | Customer-specific and state-transition meanings need CSR/warehouse confirmation. |
| `shipping-orders/workflows.md` | Split list search, status read, product availability read, BOL field read, pick-status read, packing-status read, tracking-status read, and document-control inspection. | T041-T075 | Mutation/printing workflows remain separate candidates only. |
| `shipping-orders/workflows.md` | Add a prominent correction that document controls do not share one print behavior; the demonstrated Pick Ticket downloaded a PDF, while outbound-label direct print remains unverified by repository tests. | T061-T065; C02; C11 | Controlled printer testing is mandatory. |
| Future `products/` docs | Create Product Details overview and read-only SKU-history workflow rather than overloading Inventory docs. | T076-T083 | New folder should be approved before creation. |
| Future `billing/` docs | Create read-only transaction/invoice orientation; keep Create Invoice as a finance-owned write workflow. | T084-T091 | Finance approval required. |
| Future `admin/` docs | Create restricted User Directory/customer profile orientation with strict confidentiality and role boundaries. | T092-T098 | Admin/security approval required. |

## Proposed Evidence Ledger Pattern

For every promoted statement, retain both dimensions:

- Statement source: `confirmed by Alex`, `observed in Teamship`, or `confirmed by Newl Apps docs/code`.
- Approval state: approved Newl rule, requires Alex confirmation, requires CSR confirmation, requires warehouse-management confirmation, requires finance confirmation, or requires admin/security confirmation.

This prevents `Alex said it` from being mistaken for `Newl approved it` and prevents a visible UI control from being mistaken for an authorized workflow.
