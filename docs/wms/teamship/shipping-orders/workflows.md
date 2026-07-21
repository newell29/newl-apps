# Shipping Order Workflows

Status: Draft. Not approved or complete. These are candidate read-only workflows unless separately reviewed and approved.

## Navigate To Shipping Orders

Classification: `documentation only` or `read-only browser helper`.

Inputs:

- Desired warehouse/customer context.
- Optional status tab/filter.

End condition:

- Shipping Orders list is visible.

Verification:

- Header says Shipping Orders.
- Correct tab/status/filter context is visible.

## Search Shipping Orders

Classification: `candidate deterministic Playwright tool`, read-only only.

Inputs:

- Approved search term such as order number, customer, shipment identifier, or tracking/status field.

End condition:

- Filtered order list is visible.

Safety:

- Do not open action menus that can edit, print, cancel, ship, or release unless the workflow is separately approved.

## Read Shipping Order Detail

Classification: `candidate deterministic Playwright tool`; `candidate API tool` if Teamship or Newl Apps exposes structured order detail.

Inputs:

- Shipping order identifier.

Output:

- Sanitized order status, shipment service, customer context, ship-to summary, product/LPN rows, document controls present, and readback evidence.

Safety:

- Read only.
- Do not click Start Picking, BOL, Picking List, Packing List, labels, print, save, or action-menu write controls.

## Explain Shipping Order Screen

Classification: `documentation only`.

Inputs:

- Screenshot, transcript segment, or screen recording timestamp.

Output:

- Field-by-field explanation with evidence labels.
- Confirmation requests for operational meanings.

## Review Pallet/Shipping Information

Classification: `candidate deterministic Playwright tool`, read-only first; write-capable only in a separate approved workflow.

Observed fields:

- Shipping date.
- Pallet dimensions.
- Quantity.
- Weight.
- Unit.
- Commodity.
- Additional charges.

Safety:

- Do not modify any pallet/shipping information during overview or read-only review.

## Print Document Flow Investigation

Classification: `print-capable`, requires separate investigation.

Candidate controls:

- Picking List.
- Packing List.
- BOL.
- Labels / shipment label.

Open questions:

- Which controls print immediately?
- Which controls open editable/preview pages?
- Can Teamship expose non-print readback endpoints for validation?
