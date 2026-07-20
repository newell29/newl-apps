# Teamship Safety Rules

Status: Draft. Not approved or complete.

This file is conservative. It is based on visual evidence, Alex's 2026-07-20 written confirmations, and existing Newl automation safety policy. It remains Draft and does not authorize live Teamship actions.

## Prohibited During Overview Or Documentation Capture

Do not click or automate:

- Save buttons.
- Deactivate controls.
- Edit product/account controls.
- Create invoice controls.
- Create/edit template controls.
- Start Picking controls.
- Picking List, Packing List, BOL, print, label, or shipment-label controls.
- Add inventory/order/product controls.
- Add users or send invitation controls.
- Pallet row updates, dimensions, weights, quantities, units, commodity text, LPNs, SKUs, serials, or location edits.
- Receiving, inventory movement, allocation, shipment release, cancellation, or completion actions.

## Observed Risk Areas

Evidence: `observed in Teamship`.

- Admin/customer profile screens expose Save and Deactivate controls.
- Product Detail screens expose deactivate/edit/add-to-assortment style controls.
- Shipping order pages expose picking, packing, BOL, and print-related controls.
- Pallet/shipping-date screens expose editable shipping dimensions, weights, quantity, unit, commodity, and additional charges.
- Invoices screen exposes a create invoice button.
- User Directory and profile pages expose add-user/invitation and notification controls.

## Automation Boundary

Read-only documentation tools may navigate, search, identify fields, and extract state.

Any write-capable or print-capable tool must be separate, reviewed, tested, scoped to explicit records, confirmed by a human, and followed by readback verification and audit logging in Newl Apps where available.

## Confirmed Access Boundary

Evidence: `confirmed by Alex`.

- Teamship access follows the individual user's Teamship role and warehouse scope.
- A user with access only to Annagem should see only Annagem data.
- A customer should see only that customer's own inventory and charges.
- Alex may approve the documentation rules, but execution still requires the user's actual Teamship permission and the separate automation safeguards above.

## Confirmed Print Side Effects

- Picking List and Packing List download local PDFs rather than auto-printing.
- The BOL print popup can send a real job to the selected Teamship printer.
- Outbound shipping labels print directly to the selected Teamship printer.
- Never test BOL or outbound-label Print against a live printer during documentation capture.
