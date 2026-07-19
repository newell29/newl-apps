# WMS: Overview

> Evidence status: Confirmed from code unless otherwise marked.


Repository evidence for WMS/Teamship is concentrated in `src/server/integrations/teamship.ts`, `src/server/integrations/teamship-settings.ts`, `src/modules/shipment-documents/teamship-*.ts`, Garland PDF/intake files, Teamship API routes, Teamship scripts, and tests named `teamship-*` or `garland-*`.

## Practical definitions

- WMS: warehouse management system; in this repository Teamship is the concrete WMS integration.
- Shipping order: Teamship/Garland order identified in code by SR numbers, Teamship order IDs, PS numbers, and shipment date fields.
- LPN/pallet/serial number/allocation/pick ticket/BOL/location: generic warehouse terms unless a field or parser explicitly references them; operational meanings require employee confirmation.
- Dimensions and weight: Garland pallet fields processed for Teamship review and update jobs; UPS orders have a documented special rule in `reference/GARLAND_TEAMSHIP_REVIEW_FINDINGS.md`.

## Automation boundary

Teamship reading is implemented through API login/list/detail calls and selective UI-page enrichment. Teamship updates are isolated in Phase 2 job/execution files and scripts with dry-run/live controls. Printing and broad WMS receiving/inventory/picking screens were not located as standalone Newl Apps modules; document requests for those areas require operational confirmation.
