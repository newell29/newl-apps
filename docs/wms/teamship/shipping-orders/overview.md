# Shipping Orders Overview

Status: Draft. Not approved or complete. UI content is visually observed; selected operational meanings were confirmed by Alex in writing on 2026-07-20.

## Purpose

Teamship Shipping Orders appears to manage outbound orders, including order search, order details, picking, packing, BOL, pallet/shipping information, labels, and shipment-related fields.

Evidence: `observed in Teamship`; operational meaning requires Alex/CSR/warehouse-management confirmation.

## Where It Lives

Left navigation: Shipping Orders.

Observed related pages:

- Shipping Orders list.
- Shipping order detail.
- Ship inventory detail.
- Picking list / packing list / BOL controls.
- Shipping date and pallet information step.
- Print/label-related pages.

## Observed Fields And Controls

Observed table/list fields resemble:

- Order number.
- Processing/status.
- Company/customer.
- Ship-to or shipment-related fields.
- Total item count.
- Warehouse.
- Item count.
- Created/date fields.
- Tracking/status-like fields.

Observed detail fields/controls include:

- Shipment service.
- Order details.
- Product information.
- Customs information.
- Ship-to details.
- Added LPNs.
- Picking List.
- Packing List.
- BOL.
- Action menus.
- Start Picking-style control.
- Shipping date.
- Pallet rows with dimensions, quantity, weight, unit, and commodity.
- Additional charges.

## Newl Operational Meaning

Evidence: `confirmed by Alex`.

- Open means an order has been created by Newl staff or a customer and has not been closed out.
- Alex calls the finished state Closed: the shipment has been picked, charges have been applied, and the order is closed. Sampled Teamship UI uses a Complete tab; exact UI-to-operational wording remains open.
- Hold and Draft are outside the current documentation scope.
- Bulk orders are non-e-commerce orders that do not require individual-unit picking and do not originate from e-commerce storefronts.
- E-commerce orders are typically individual-unit, small-parcel orders picked, packed, and shipped directly to a customer or business.
- Picking is the stage in which pickers go to locations and retrieve individual items.
- Packing follows Picking; units are placed into shipping cases, labels are added, and a small-parcel carrier is selected.

## Document And Label Behaviour

Evidence: `confirmed by Alex`; no print action was executed during this reconciliation.

- Picking List downloads a local PDF and does not auto-print.
- Packing List downloads a local PDF and does not auto-print.
- BOL Print opens another popup; selecting Print in that popup sends the job to the selected Teamship printer.
- Outbound shipping labels print directly to the selected Teamship printer.
- Outbound shipping-label count should match pallet count.

## Safety Rules

- Do not start picking, print, create labels, generate/open BOL for automation purposes, ship/release, save edits, or change pallet rows from overview work.
- Treat BOL, Picking List, Packing List, labels, and print controls as dangerous until tested against controlled printer/preview flows.
- Treat dimensions, weights, quantities, unit, and commodity fields as write-capable order fields requiring separate approval.

## Open Questions

- Does Teamship label the finished bulk state Complete while Newl calls it Closed, or is a separate Closed control/status present?
- Which fields map to Newl PS/SR/order identifiers?
- What are the exact approved printer queue names, media sizes, and physical destinations?
- How should Nemo distinguish Teamship `Accepted` from carrier `Label Created`?
- Which order fields can be read by Nemo for employee support?
