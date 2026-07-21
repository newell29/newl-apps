# Inventory Overview

Status: Draft. Not approved or complete. UI content is visually observed; selected operational meanings were confirmed by Alex in writing on 2026-07-20.

## Purpose

Teamship Inventory appears to show product/SKU quantity state across warehouse, location, and LPN contexts.

Evidence: `observed in Teamship`; selected quantity, view, and LPN meanings are `confirmed by Alex` below.

## Where It Lives

Left navigation: Inventory.

Observed related views:

- Details
- Ship by LPN
- Inventory by Location

## Observed Inputs And Controls

- Search field.
- Warehouse/customer selector.
- Action menu.
- Column controls.
- Add inventory/order-style controls.
- Import shipping data-style control in some views.

## Observed Result Fields

The visual pass showed columns resembling:

- Product/SKU
- Bin/location
- Product name or description
- Available quantity
- UOM
- Reserved/on-hand/backordered-style quantities
- Status
- Customer
- Location
- LPN

Field names need confirmation from the Draft reconciliation and a focused screen capture before promotion.

## Newl Operational Meaning

Evidence: `confirmed by Alex` for the following Inventory All definitions:

- On Hand is total inventory for the SKU.
- Reserved is inventory assigned to shipping orders.
- Available equals On Hand minus Reserved.
- The All view is SKU-based. Quarantine and serial attributes do not change its calculation.
- An LPN is a handling-unit identifier. It represents a pallet about 95% of the time, but not always.

The All view's numeric Available result does not by itself prove that a particular serialized or quarantined handling unit may be shipped. Use Ship by LPN or Inventory by Location when those attributes matter.

## Safety Rules

- Do not create, receive, move, allocate, or adjust inventory from overview work.
- Do not edit SKU/LPN/location/quantity fields.
- Treat Inventory by Location and Ship by LPN as read-only until a focused workflow is approved.

## Open Questions

- What is the exact meaning of Backordered in the All view?
- How should Nemo present SKU-level Available when one or more matching LPNs are quarantined?
- Which active filters must be reported with a result? Saved views are user-specific and users have none by default, so Nemo should inspect rather than always clear filters.
