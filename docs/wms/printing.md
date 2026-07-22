# WMS: Printing

> Evidence status: Confirmed from code unless otherwise marked.


Repository evidence for WMS/Teamship is concentrated in `src/server/integrations/teamship.ts`, `src/server/integrations/teamship-settings.ts`, `src/modules/shipment-documents/teamship-*.ts`, Garland PDF/intake files, Teamship API routes, Teamship scripts, and tests named `teamship-*` or `garland-*`.

## Practical definitions

- WMS: warehouse management system; in this repository Teamship is the concrete WMS integration.
- Shipping order: Teamship/Garland order identified in code by SR numbers, Teamship order IDs, PS numbers, and shipment date fields.
- LPN/pallet/serial number/allocation/pick ticket/BOL/location: generic warehouse terms unless a field or parser explicitly references them; operational meanings require employee confirmation.
- Dimensions and weight: Garland pallet fields processed for Teamship review and update jobs; UPS orders have a documented special rule in `reference/GARLAND_TEAMSHIP_REVIEW_FINDINGS.md`.

## Automation boundary

Teamship reading is implemented through API login/list/detail calls and selective UI-page enrichment. Teamship updates are isolated in Phase 2 job/execution files and scripts with dry-run/live controls.

Phase 1 single-order printing is implemented in `src/modules/teamship/print-jobs.ts`, `src/modules/teamship/print-execution.ts`, `scripts/teamship-print-worker.ts`, and the `newl-print` OpenClaw plugin. A Teams request creates an immutable tenant-scoped plan for one exact numeric Teamship shipping-order number. A separate explicit approval by the same employee is required before the local worker can claim it.

The worker performs a complete preflight before printing: it verifies the Garland/Annagem order, recalculates the pallet count, confirms the local CUPS queue, and verifies the exact Teamship BOL and outbound-label printer options. It then prints one picking list locally, submits one BOL through Teamship, and submits outbound labels equal to the approved pallet count. It reselects and reads back `BIXOLON SRP-770III` on every order immediately before the label action. A failed, expired, crashed, or partially completed job is never retried automatically.

Browser execution uses the documented Teamship shipping-order detail host, `https://members.fulfillit.io`. The `app.teamshipos.com` application shell is not a valid pallet-count preflight source because it may omit the indexed pallet inputs even when the API plan contains pallet rows.

Batch printing and automatic printing are not implemented.
