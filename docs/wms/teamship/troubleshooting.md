# Teamship Troubleshooting

Status: Draft. Not approved or complete.

This file remains Draft. The confirmed items below come from Alex's written 2026-07-20 follow-up and the reconciled walkthrough evidence.

## Confirmed Search And Interpretation Issues

Evidence: `confirmed by Alex` unless otherwise labeled.

- Saved views are user-specific and users have none by default. Inspect and report active filters; do not automatically clear a user's intentional view.
- Inventory Orders list search did not find a SKU in the walkthrough. To find inbound stock for a SKU, inspect each inbound order for the relevant customer.
- Alternative serials may be suggested to Newl staff without separate approval. This does not approve customer-facing substitutions.
- Inventory All is SKU-based; quarantine and serial attributes do not change its quantity calculation. Check handling-unit evidence before describing stock as shippable.
- A filled inventory Search field does not prove that Teamship applied the query. The guarded reader must activate the visible Search control and only interpret the resulting table after it settles.
- Picking List and Packing List download PDFs. BOL and outbound-label Print actions can send real jobs through the selected Teamship printer.
- A number entered in Billing search may match a transaction number as well as Order No; verify the result against the Order No column. Evidence: narration/visual observation; billing meaning remains Draft.

## Other Likely Employee Mistake Areas

Evidence: `inferred by Codex`; confirmation still required where not covered above.

- Opening the wrong order when search results contain many similar orders.
- Confusing Inventory Orders, Receiving Orders, and Shipping Orders.
- Treating an inventory quantity/status as available without checking LPN/location/order allocation context.
- Editing pallet dimensions/weight/commodity rows directly instead of following an approved review/update workflow.
- Triggering print or BOL controls before verifying the order/document state.
- Changing account, template, notification, or user settings while intending only to inspect a customer profile.

## Safe Troubleshooting Pattern

1. Identify the exact Teamship screen and URL path.
2. Capture the visible status/tab/filter/search context.
3. Record the order/product/SKU/LPN/location identifier using a sanitized placeholder in documentation.
4. Check whether the issue is shipping, receiving, inventory, product, billing, or admin/user related.
5. If the next step could write, print, receive, ship, move, allocate, edit, deactivate, or invite, stop and ask for the proper role confirmation.

## Remaining Evidence Gaps

Focused evidence is still needed for quarantined rows, Complete versus Closed terminology, carrier-status interpretation, exact printer queues, and the role-by-screen access matrix.
