# Teamship Evidence Ledger

Status: Draft. Not approved or complete.

This ledger defines how statements in the Teamship documentation are sourced. It exists to prevent visual observations or Codex inferences from becoming approved Newl operating rules.

## Source Categories

| Source category | Meaning | Current status |
| --- | --- | --- |
| Direct visual observation | A screen, label, tab, table, field, or control was visible in sampled frames from `Teamship Overview 07-20-26.mov`. | Used in this draft. |
| Existing repository code or documentation | Supported by committed or working-tree Newl Apps code/docs. | Used only where explicitly stated; not broadly reconciled yet. |
| Inference | Codex interpreted likely meaning from UI context, naming, or existing WMS conventions. | Must not be treated as a business rule. |
| Narration | Alex's spoken walkthrough explanation, locally transcribed with whisper.cpp small.en. | Reconciled in Draft review artifacts and supplemented by written owner answers; remaining gaps are explicitly listed. |
| Written owner follow-up | Alex's written answers to the seven grouped confirmation questions on 2026-07-20. | Used as `confirmed by Alex` evidence for the exact answered rules; unanswered UI mechanics remain open. |
| Focused Playwright observation | A read-only, authenticated browser discovery performed with Alex's approval on 2026-07-20. It confirms visible routes, labels, table fields, technical IDs, search behavior, and blocked mutation controls. | Used in Draft capability and Playwright review artifacts; it does not approve business rules or write automation. |
| Pending Alex confirmation | Product/process meaning needs Alex to confirm before it becomes Newl documentation. | Applies to most operational meaning in this draft. |
| Pending CSR confirmation | CSR workflow, customer/document handling, order review, or shipping-document practice needs CSR validation. | Applies to shipping-order and document workflows. |
| Pending warehouse-management confirmation | Inventory, receiving, location, LPN, movement, picking, packing, or warehouse handling meaning needs warehouse leadership validation. | Applies to inventory and receiving workflows. |

## Current Evidence Summary

- Video file located at `/Users/alexnewell/Desktop/OpenClaw recordings/Teamship Overview 07-20-26.mov`.
- Durable extracted artifacts are under `/Users/alexnewell/Desktop/OpenClaw recordings/Teamship Overview 07-20-26 artifacts` and remain outside Git.
- Visual evidence includes 41 frames sampled approximately once every 60 seconds and three contact sheets.
- Audio was transcribed locally with whisper.cpp small.en into raw, timestamped, and segment CSV outputs. The original MOV and WAV were not changed.
- Record & Replay did not capture the full 40-minute walkthrough. A later focused Playwright discovery captured exact semantic targets and UI behavior for warehouse mapping, inventory, LPN/location, receiving, and product history; other workflows remain incomplete.
- The focused Playwright discovery performed no Save, Edit, Add, Deactivate, Quarantine, Ship, Receive, Complete, Delete, Print, billing, or administrative mutation. No screenshots or raw browser artifacts were written into Git paths.
- A focused read-only customer-profile extraction reviewed 280 profiles and captured 61 active profiles with 90 exact customer-to-warehouse assignment rows. The detailed customer map and full audit remain in the external artifacts folder; only aggregate counts and unresolved warehouse labels are recorded in Git.
- A supervised headed-browser validation on 2026-07-20 exercised the guarded Inventory All, Ship by LPN, Receiving Order, and Product History readers with one approved Garland Canada Distribution / Annagem example each. All four returned the expected minimized scoped evidence, no Teamship writes were performed, and the detailed report remains in the external artifacts folder. The application-level disabled gate was also verified to emit sanitized `TOOL_DISABLED` audit payloads without invoking the browser adapter.
- Alex reviewed the extracted mapping on 2026-07-20, confirmed that it looks good, and directed Newl Apps to ignore `New Toronto Street`, `49th`, and `New Huntington Road` because those warehouses are not in use. The filtered configuration candidate contains 87 entries across the nine confirmed warehouses; it has not been applied.
- Draft reconciliation artifacts are under `docs/wms/teamship/review/`. They do not promote any statement into approved policy.
- Alex's written follow-up confirms that he may approve all captured Teamship business meanings. This does not replace Teamship role authorization, focused UI evidence, or separate approval for live write/print automation.

## Reconciliation Rules

- Do not finalize these docs until the Draft reconciliation and confirmation checklist are reviewed.
- Record a statement as `confirmed by Alex` only when the transcript explicitly supports that Alex said it; separately record whether the operational rule is approved.
- Keep any mismatch between visual evidence and narration in a contradictions list.
- Keep unclear or ambiguous claims in `open-questions.md` with an owner for confirmation.
