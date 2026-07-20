# Read-Only Playwright Candidates

Status: Draft. A focused read-only discovery was run on 2026-07-20; no reusable browser automation was built or enabled. Confirmed selectors and boundaries are recorded in `playwright-discovery-2026-07-20.md`.

Prefer Teamship APIs or Newl Apps service methods when they expose stable structured data. Use Playwright for UI-only navigation, visible verification, or gaps in API coverage. Every candidate below is read-only and must block Save, Edit, Add, Deactivate, Quarantine, Start Picking, Release Hold, Complete, Fetch Rates, Generate Label, Create Invoice, Print, and document-generation actions.

## Shared Guardrails

- Allow only approved Teamship hosts and tenant-scoped credentials.
- Confirm signed-in user, warehouse context, route, and page heading before extraction.
- Inspect and report active filters and selected views. Clear temporary filters only when explicitly requested; never delete, overwrite, or assume a saved view exists.
- Use semantic roles, labels, stable URLs, and table headers; do not rely on coordinates.
- Sanitize customer contacts, addresses, order IDs, SKU/LPN/serial examples, and attachments from reusable logs.
- Capture a screenshot or structured readback after navigation, but store raw evidence outside Git until reviewed.
- Abort if a click opens edit mode, a print modal, a save indicator, a mutation confirmation, or an unexpected role/customer context.

## Candidate Tools

| Tool | Inputs | Read-only output / verification | API preference | Safety notes |
| --- | --- | --- | --- | --- |
| `teamship_read_navigation` | Expected role/user context | Visible nav labels, expanded submenu labels, current warehouse/printer context, screenshot. | Browser-only for actual UI visibility. | Do not open Admin/Billing unless caller is authorized. |
| `teamship_read_filter_context` | Screen route and optional expected view | Active filters, selected view, warehouse context, and whether results are scoped; no state change by default. | Browser-only. | Users have no saved views by default, but views are user-specific. Clear temporary filters only on explicit request; never save/edit/delete a view. |
| `teamship_search_inventory_all` | Customer and/or SKU; warehouse context | Exact applied query, visible Available/Reserved/On Hand/status/customer/warehouse/quarantine fields, matching rows or empty state. | Browser required for complete inventory; API returns shipping-eligible matches only. | Never answer `available to ship` without quarantine/allocation qualifiers. Activate the visible Search control after filling the searchbox. |
| `teamship_search_inventory_by_lpn` | LPN, SKU, customer, or warehouse | Grouped LPN rows with sanitized SKU, LPN, quantity, location, warehouse, customer, quarantine, serial, and status evidence. | Browser required unless Teamship supplies an undocumented read endpoint. | Do not click Ship LPN's, Transfer Order, Add Inventory, or Import Shipping Order. Keep LPN-row `Available` distinct from Inventory All aggregate Available. |
| `teamship_search_inventory_by_location` | SKU or location; warehouse/customer context | Location groups and matching inventory rows. | Browser required unless Teamship supplies an undocumented read endpoint. | Preserve exact location field labels; no move/adjust actions. |
| `teamship_read_quarantine_state` | SKU and optional LPN | Lock/icon presence plus quarantine columns/flags and source context. | API preferred because repository types expose quarantine flags. | No unquarantine/quarantine actions. |
| `teamship_list_inventory_orders` | Customer, status, date range | Filtered Open/Complete/Draft list and visible counts/fields. | Browser required; no published list/detail read API exists. | Do not use list Search as a proven SKU search. Never select row checkboxes or Add/Blind Order. |
| `teamship_find_sku_in_open_receipts` | Customer, SKU, date range limit | Candidate open orders inspected one by one; matching expected SKU evidence. | API strongly preferred to avoid broad UI crawling. | Cap order count and report incomplete search rather than implying no inbound stock. |
| `teamship_read_receiving_order` | Receiving/inventory-order ID | Status, incoming/received quantities, SKU, LPN, location, warehouse, pallet count, discrepancy/receipt control presence. | Browser required; no published list/detail read API exists. | Never click Warehouse Receipt, Receive this product, Save, Delete Order, Complete Receiving, Send, Edit, Create LPNs, or discrepancy actions. |
| `teamship_list_shipping_orders` | Type (bulk/e-commerce/all), status, warehouse/customer, search value | Filter context, matching orders, route IDs, visible statuses. | Existing repository list/detail API is preferred. | Verify filters are cleared or intentionally applied. |
| `teamship_read_shipping_order` | Teamship order ID | Sanitized order detail, inventory rows, ship-to summary, EDI field presence, pallet rows, attachments metadata, document controls. | Existing `fetchTeamshipShippingOrdersForReview()` and detail parser are preferred. | Do not open menus that contain mutation/print actions. |
| `teamship_read_bol_field_map` | Existing BOL order ID | Existing editor presence and visible field labels/values without focus/edit events. | Browser-only for editable BOL UI. | High risk: editor autosaves. Never click editable fields; never generate a missing BOL. |
| `teamship_inspect_document_controls` | Shipping-order ID | Presence, href, role/name, disabled state, and menu items for Picking List, Packing List, BOL, outbound labels. | Browser-only; repository already knows several routes/selectors. | Do not click Print, Generate BOL, Void BOL, or label modal Print. |
| `teamship_read_pick_status` | Shipping-order ID | Hold banner, required/picked/scanned counts, SKU/LPN/location, Start Picking/control presence. | Browser-only unless API state is found. | Never Release Hold, Add Pick, Start Picking, Save, or Complete. |
| `teamship_read_ecommerce_fulfillment` | E-commerce order ID | Current stage, package dimensions/weight already stored, label/tracking state, visible carrier/service. | Investigate API first. | Never Fetch Rates, select service, generate/reprint/void label, or change packaging. |
| `teamship_read_tracking_status` | Shipping-order ID | Teamship status plus external carrier status in separately labeled fields and retrieval timestamp. | Carrier API preferred after authorization. | Do not infer warehouse possession solely from `Label Created`. |
| `teamship_read_product` | SKU/customer context | Product title, SKU, barcode, stock-attribute names, active/quarantine/threshold presence, template assignments, dimensions/weight. | Investigate product API first. | Do not Edit, Deactivate, toggle attributes/quarantine, print labels, or change templates. |
| `teamship_read_product_history` | SKU/product ID, date range | Product ID/details plus dated event, adjustment, resulting Available, warehouse, batch, serial, and status history rows. | Browser required; product API does not publish history. | Treat adjustments as history only; never Edit, Deactivate, quarantine, print, or change thresholds/templates. |
| `teamship_read_lpn_history` | LPN, warehouse | Sanitized LPN history and locations. | Investigate API first. | Needs focused recording before implementation. |
| `teamship_read_billing_transaction` | Order number or transaction ID | Matching rows, exact match reason, transaction detail, invoice number presence. | Investigate billing API first. | Finance role required; verify Order No separately from transaction-number substring matches. |
| `teamship_read_invoice` | Invoice ID | Invoice header and sanitized charge breakdown; PDF link metadata. | Investigate API/download endpoint first. | No Create Invoice, payment, email, or print actions. |
| `teamship_read_access_context` | User or customer account ID | Teamship role, visible warehouse names, account-option labels/states; contacts redacted. | Investigate Admin API only with explicit scope. | Admin/security restricted; directory data does not grant disclosure permission. |

## Existing Repository Alignment

- `src/server/integrations/teamship.ts` already performs read-only shipping-order list/detail requests, product search for shipping, UI detail parsing, serial extraction, quarantine-flag handling, and pallet-row parsing.
- `reference/GARLAND_TEAMSHIP_REVIEW_FINDINGS.md` defines Stage 1 as read-only and stores tenant-scoped Teamship order cache data without mutating Teamship.
- `docs/teamship-bol-editor-print-automation-investigation.md` identifies document controls and outbound-label modal selectors, while deliberately avoiding real print actions.
- Phase 2 update code is not a template for these read-only tools. Its live update endpoints, allowlists, BOL autosave edits, and approved jobs remain a separate write-capable system.

## Implementation Priority

1. API-backed `teamship_list_shipping_orders`, `teamship_read_shipping_order`, and inventory/quarantine lookup using existing repository primitives.
2. Browser-only Inventory All, LPN/location, warehouse-assignment, and Inventory Orders/Receiving Order readers using the confirmed focused-discovery routes.
3. Browser-only product-history reader; investigate e-commerce status fields in the existing shipping API before adding a browser fallback.
4. Billing and Admin readers only after finance/admin authorization requirements are documented.
5. BOL/document-control inspection last, because incidental focus or clicks can autosave or print.
