# Teamship Screen Map

Status: Draft. Not approved or complete. Screen presence and UI labels are visual observations. Selected operational meanings were confirmed by Alex on 2026-07-20; remaining gaps are named per section.

This screen map remains the original visual draft. Proposed narration-backed updates are listed in `review/proposed-doc-changes.md` and should not be applied broadly until reviewed.

## Inventory Orders

Evidence: `observed in Teamship`.

Observed layout:

- Header: Inventory Orders.
- Tabs resembling open/complete/draft states.
- Search/filter controls.
- Table of orders with columns for order identifiers, company/customer, created or date fields, SKU/item values, warehouse/status-like fields, item counts, and label/status-like values.
- Buttons for adding or creating inventory orders.

Operational meaning: Open and Complete meanings are `confirmed by Alex`; Draft remains outside the current documentation scope.

## Warehouse Directory

Evidence: `observed in Teamship`.

Observed layout:

- Header: Warehouse Directory.
- Table of warehouses with address/city/state/country/postal-code-like columns.
- Action links/buttons on each warehouse row.

Operational meaning: Warehouse names/access remain Draft; detailed warehouse-administration behavior requires focused evidence.

## Inventory

Evidence: `observed in Teamship`.

Observed layout:

- Header: Inventory.
- Tabs/views including Details, Ship by LPN, and Inventory by Location.
- Search field, column controls, warehouse/customer filters, and action menu.
- Rows showing product/SKU-like values, bin/location-like values, available/reserved/on-hand/backordered-style quantity columns, and status-like labels.
- Ship-by-LPN view groups inventory by LPN/pallet-like identifiers and exposes customer, location, and quantity-related columns.
- Inventory-by-location view groups product/SKU rows by warehouse locations.

Operational meaning: Inventory All quantity formula, SKU-only scope, and LPN meaning are `confirmed by Alex`; Backordered/quarantine presentation remains open.

## Product Details

Evidence: `observed in Teamship`.

Observed layout:

- Header: Product Details.
- Tabs such as Product and Transactions.
- Controls including add to assortment, deactivate, and edit.
- Product information fields, barcode area, inventory/stock allocation fields, product label/add actions, and product dimension/weight-style inputs.
- Product history appears separately under Inventory History.

Operational meaning: selected product/stock meanings are reconciled, but edit, threshold, template, and product-history details remain Draft.

## Receiving Orders

Evidence: `observed in Teamship`.

Observed layout:

- Receiving order detail page with order number and status.
- Tabs for Products and locations/LPNs.
- Warehouse receipt/status controls.
- Order detail panel and product rows.

Operational meaning: Inventory Order Open/Complete meanings and Complete availability are `confirmed by Alex`; receipt execution details remain Draft.

## Shipping Orders

Evidence: `observed in Teamship`.

Observed layout:

- Header: Shipping Orders.
- Tabs resembling open/on-hold/draft/complete states.
- Table of shipping orders with order number, processing status, company/customer, shipment/to-customer fields, total item count, warehouse, item count, created date, and tracking/status-like values.
- Shipping order detail pages include shipment service, order details, product information, customs information, ship-to details, added LPNs, picking list, packing list, BOL, and action menus.

Operational meaning: Open/closed-out, Bulk/E-commerce, Picking/Packing, and print-control meanings are `confirmed by Alex`; Complete/Closed, carrier status, Hold/Draft, and execution permissions remain open.

## Picking, Packing, BOL, And Pallet Pages

Evidence: `observed in Teamship`.

Observed layout:

- Ship inventory/order detail pages expose Picking List, Packing List, and BOL controls.
- A “Start Picking” style control appears on at least one order detail screen.
- A shipping-date and pallet-information step includes dimensions, quantity, weight, unit, commodity, and additional charges rows.
- Print-related pages show order labels, product labels, and print quantities.

Operational meaning: selected Picking/Packing and document behavior is `confirmed by Alex`; write/print execution remains prohibited without separate approval and role authorization.

## Invoices

Evidence: `observed in Teamship`.

Observed layout:

- Header: Invoices.
- Tabs such as generated invoices, outstanding transactions, and all transactions.
- Create invoice button.
- Table with transaction/order/customer/date/total/status-like columns.
- Invoice document preview page.

Operational meaning: `requires finance confirmation`.

## Admin, User Directory, And Customer Profile

Evidence: `observed in Teamship`.

Observed layout:

- User Directory with add-user control and a searchable user table.
- Customer/account profile page with general/configuration tabs.
- Customer information, address, notification settings, users, templates, label templates, inbound/outbound templates, account options, and reset-password areas.
- Controls include Deactivate, Save, add/send invitation, enabled/disabled notification selectors, create/edit template links, and account option toggles.

Operational meaning: role/warehouse/customer scoping is `confirmed by Alex`; the exact role-by-screen and admin-control matrix remains open.
