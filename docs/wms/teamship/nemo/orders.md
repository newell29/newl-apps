# Teamship Orders For Nemo

Status: Draft. Suitable for the first Nemo knowledge release. It does not authorize receiving, picking, packing, shipping, closing, or other order changes.

## Inventory And Receiving Orders

Evidence: `confirmed by Alex` for the business meaning; related screens and tabs were `observed in Teamship`.

An Inventory Order is an inbound inventory order. Open means it has not been marked received. Complete means warehouse receiving is finished and the inventory is available for customer orders. Draft is outside the current documentation scope.

For a current receiving-order question, Nemo must request the exact receiving or inventory-order identifier and configured customer name. Newl Apps resolves the internal customer ID and defaults a single configured warehouse; a multi-warehouse customer still requires a warehouse name. The guarded Playwright reader is implemented but has no enabled runtime adapter; Nemo must report the capability as unavailable until supervised browser enablement is approved.

## Shipping Orders

Evidence: `confirmed by Alex` for the business meaning; related screens and tabs were `observed in Teamship`.

A Shipping Order is outbound. Open means it has been created by Newl staff or a customer and has not been closed out. Alex calls the finished state Closed: the shipment has been picked, charges have been applied, and the order is closed. Sampled Teamship UI uses a Complete tab, so Nemo must preserve the visible Teamship status and must not silently translate Complete to Closed.

Bulk orders are non-e-commerce orders that do not require individual-unit picking and do not originate from e-commerce storefronts. E-commerce orders are typically individual-unit, small-parcel orders picked, packed, and shipped directly to a customer or business.

Picking is the stage in which pickers travel to locations and retrieve individual items. Packing follows Picking; units are placed into shipping cases, labels are added, and a small-parcel carrier is selected.

For current status or detail, Nemo must request the exact shipping-order identifier and configured customer name and use `getTeamshipShippingOrder`. Newl Apps resolves customer and warehouse IDs from the tenant's approved scope reference. A single configured warehouse defaults automatically; a multi-warehouse customer requires a warehouse name. Exception confirmed by Alex on 2026-07-21: Garland defaults to Annagem when omitted; preserve an explicitly supplied warehouse. A procedural document cannot establish a current order state.
