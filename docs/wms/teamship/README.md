# Teamship WMS Overview

Status: Draft. Not approved or complete.

This folder captures Newl's working knowledge of Teamship, the browser-based WMS used in current warehouse workflows. It is intended to become source material for Nemo, Newl Apps, and future approved deterministic browser/API tools.

## Evidence Status

This draft is based on a visual pass over `Teamship Overview 07-20-26.mov`, sampled at roughly one frame per minute, a local small.en transcript of Alex's narration, and existing Newl Apps Teamship context. The transcript and raw visual/audio artifacts remain outside Git and are not approved operating documentation.

Do not treat this draft as approved operating procedure. Treat UI labels and screen presence as `observed in Teamship`; treat operational meanings as `requires Alex confirmation`, `requires CSR confirmation`, or `requires warehouse-management confirmation` unless separately confirmed.

See [evidence-ledger.md](evidence-ledger.md) for source classification rules and [review/transcript-reconciliation.md](review/transcript-reconciliation.md) for the Draft reconciliation. Narration has been reconciled as evidence, and the status of each grouped owner confirmation is tracked in [review/confirmation-checklist.md](review/confirmation-checklist.md).

Alex supplied written answers to the grouped confirmation questions on 2026-07-20 and confirmed that he is the approving owner for the captured business meanings. Those answers are incorporated into selected Draft sections. Remaining gaps concern focused UI evidence, execution permissions, and an explicit request to promote documentation.

## First Nemo Knowledge Release

The first release uses only the four curated Draft documents under [nemo/](nemo/) through an explicit assistant-registry allowlist. Review artifacts, raw evidence, contradictions, open questions, and inferred material are excluded from normal retrieval. See [read-only-vertical-slice.md](read-only-vertical-slice.md) for the capability matrix, authorization boundary, tool contracts, and supervised enablement plan.

## Critical Gap

The remaining critical gap is approval and focused interaction evidence. The transcript captures Alex's explanations, but it is a machine transcription and does not automatically establish approved Newl rules. High-risk status, search, printing, autosave, role, and warehouse workflows still need focused confirmation.

Record & Replay was not the primary source for this walkthrough. That means we are also missing structured event-stream details such as exact click targets, selected/focused elements, typed values, and full accessibility trees at each interaction point. The video still provides useful screen evidence, but future deterministic tools should be validated with focused Record & Replay or Playwright traces.

## Observed Screen Families

- Dashboard/main navigation.
- Inventory Orders.
- Inventory with several views, including details, ship by LPN, and inventory by location.
- Warehouse Directory.
- Product Details and product barcode/stock allocation sections.
- Receiving Orders and receiving order detail.
- Shipping Orders and shipping order/ship inventory detail.
- Picking, packing, BOL, pallet, shipping date, additional charges, and print-related controls.
- Inventory History.
- Invoices.
- Admin/user/customer profile and account configuration areas.

## Source Of Truth Rules

- Prefer approved Newl Apps documentation over a temporary video observation.
- Preserve evidence labels on business rules and exceptions.
- Do not automate write/print actions from this overview alone.
- Do not repeat private customer contacts, emails, addresses, shipment identifiers, or account numbers in reusable docs unless explicitly approved and sanitized.

## Suggested Next Step

Review the reconciliation, terminology questions, contradictions, and proposed changes under [review/](review/). Keep all operational documents Draft until Alex and the appropriate CSR, warehouse, finance, or admin owners answer the confirmation checklist.
