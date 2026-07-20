# Teamship Open Questions

Status: Draft. Not approved or complete. Alex answered the grouped business-rule questions on 2026-07-20; these remaining questions require focused UI evidence or an explicit promotion decision.

## Critical Remaining Questions

- Does Teamship's visible Complete state correspond exactly to Alex's operational term Closed, or is a separate Closed control/status present?
- How should Nemo explain Teamship `Accepted` versus carrier `Label Created` without inferring physical location incorrectly?
- What are the exact printer queue names, media sizes, and physical destinations for BOL and outbound-label printing?
- Which Teamship roles may execute Release Hold, Close/Complete, print, invoice, or admin changes?

## Navigation And Permissions

- What is the exact role-by-screen visibility matrix for Dashboard, Inventory, Inventory Orders, Shipping Orders, Products, Manage Warehouses, Billing, Admin, and Reports?
- Which restricted fields under Billing, User Directory, customer profiles, attachments, pricing, and EDI may Nemo answer for each role?
- How should Newl Apps verify that Teamship warehouse scope is enforced before returning an answer?

## Inventory

- What is the exact meaning of Backordered in Inventory All?
- What quarantine icon/column should Nemo read on Ship by LPN, and how should it qualify SKU-level Available?
- Does partially received inventory remain absent from all customer-facing inventory views until the Inventory Order is Complete?

## Shipping Orders

- Hold and Draft are intentionally outside the current documentation scope; when should they be added?
- What visible evidence proves an order is ready for Picking, Packing, BOL, or closure?
- Which shipping-order fields are role-safe for Nemo to read?

## Products

- Which product details are authoritative for SKU, barcode, dimensions, weight, labels, and stock allocation?
- When can product dimensions/weights be learned from Teamship, and when must they be confirmed separately?

## Billing/Admin

- Which invoice screens are readable by operations roles versus finance-controlled?
- Which account/profile/template/user-directory fields are admin-only under actual Teamship permissions?

## Promotion Decision

- Which Draft files should be promoted first: core Inventory/Shipping only, or the entire Teamship overview set?
- Has Alex reviewed the proposed wording closely enough to request promotion, or should it remain Draft until the focused sessions are complete?
