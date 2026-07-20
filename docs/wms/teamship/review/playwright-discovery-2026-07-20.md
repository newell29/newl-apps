# Focused Teamship Playwright Discovery

Status: Draft. Read-only discovery evidence, not approved operating procedure or enabled automation.

## Session Boundary

Alex explicitly approved an authenticated, focused Playwright session on 2026-07-20. The session inspected visible Teamship routes and semantic page state only. It did not activate Save, Edit, Add, Deactivate, Quarantine, Ship, Receive, Complete, Delete, Send, Print, billing, relocation, or document-generation controls. No screenshots, credentials, contacts, billing values, or raw page captures were written to the repository.

## Confirmed Warehouse Routes

`/admin/manage-warehouses` exposes the Warehouse Directory and a read-only action menu per row. The `Warehouse Locations` and `LPN Lookup` links carry the stable technical warehouse ID.

| Warehouse | Teamship warehouse/location ID |
| --- | ---: |
| Kestrel | 1 |
| Monte Vista | 6 |
| Watline | 13 |
| New Toronto 4 | 14 |
| New Toronto 3 | 15 |
| New Toronto 2 | 17 |
| Sandy Porter | 18 |
| JP | 19 |
| Annagem | 102 |

Customer profiles use `/edit-user-profile/{customerId}`. The Configuration panel visibly exposes `Assigned Warehouse(s)` and selected warehouse labels. A supervised sample confirmed Garland customer ID `420` is assigned to Annagem ID `102`. The profile also contains billing and mutation controls; a reader must extract only customer ID/name and assigned warehouse labels, then leave the page.

## Confirmed Inventory Views

`/inventory` exposes tabs `All`, `Detailed`, `Ship by LPN`, and `Inventory by Location`.

- Inventory All fields include Product, SKU, Available, Reserved, On Hand, Backordered, Status, Customer, Company Name, Warehouse, and Quarantine.
- The table search requires filling `Search` and activating the visible Search control; Enter alone did not apply the filter during discovery.
- A supervised SKU showed Available 0, Reserved 1, and On Hand 1 in Inventory All while the shipping-eligible API returned zero rows.
- Ship by LPN grouped the same SKU under a visible LPN and location and exposed customer, warehouse, quantity, quarantine, serial, and status fields.
- The LPN row's `Available` label must not be silently equated with aggregate Inventory All Available; the supervised example displayed different values.
- Inventory by Location groups rows by visible location and exposes SKU, LPN, quantity, warehouse, customer, quarantine, serial, and status.

Blocked controls include Add Inventory, Ship Inventory, Ship LPN's, Transfer Order, Import Shipping Order, Update Inventory Stock, row checkboxes, and action menus that mutate inventory.

## Confirmed Receiving Views

`/inventory-orders` exposes All, Open, Complete, and Draft lists. List fields include order ID, company, creator, created date/time, ETA, warehouse, item count, carrier, BOL number, instructions, receipt type, container, supplier, PO, and status.

`/inventory-orders/inventoryOrder/{orderId}` exposes:

- status and customer/warehouse details;
- product/SKU and Incoming versus Received quantities;
- Locations/LPNs with location, LPN, received quantity, and weight on completed receipts;
- pallet count and receipt metadata;
- discrepancy-report and warehouse-receipt control presence.

Blocked controls include Blind Order, Add Inventory, list row selection, Warehouse Receipt, Receive this product, Create LPNs, Add Another Product, Add Another Charge, Save, Delete Order, Complete Receiving, Edit, Send, and discrepancy actions.

## Confirmed Product History

`/view-product/{productId}` exposes product details plus an Inventory History grid. History fields include ID, date, event, adjustment, resulting Available, warehouse, batch, serial, status, and date attributes. This supports a focused read-only `teamship_read_product_history` tool.

Blocked controls include mark as quarantine, Deactivate, Edit, thresholds changes, template assignment, and Print.

## Implementation Decision

Use the API for shipping orders, product list/detail, customer discovery, and shipping-eligible product search. Use focused Playwright readers for:

1. exact customer-to-warehouse assignments;
2. complete Inventory All quantities;
3. LPN and location lookup;
4. receiving/inventory-order list and detail;
5. product inventory history.

Each reader must assert the expected route and heading, use semantic labels/table headers, return minimized fields, log the accessed record IDs, and abort when a blocked control or unexpected context is encountered. This discovery does not authorize implementation, production enablement, or automatic Nemo invocation.
