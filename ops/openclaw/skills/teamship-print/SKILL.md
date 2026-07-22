---
name: teamship-print
description: "Approval-gated printing of the picking list, BOL, and outbound pallet labels for one exact numeric Teamship shipping-order number through Newl Apps. Use when an authenticated Microsoft Teams employee asks Nemo to plan, approve, or check the status of shipping-document printing for a single order."
---

# Teamship Print

Use only the `newl_print_*` tools. Never log in to Teamship, inspect credentials, run local print commands, invoke browser automation, or call the read-only Teamship tool as a substitute.

## Plan one order

1. Require one exact numeric Teamship shipping-order number. Do not accept an SR or PS number.
2. Call `newl_print_plan` with that number.
3. Return its result exactly. A plan prints nothing.
4. Do not call the approval tool in the same turn, even when the first message says “print.” Wait for a separate explicit approval reply containing the returned request ID.

Phase 1 always plans one picking list, one BOL, and outbound labels equal to the current Teamship pallet count. It supports Garland at Annagem only.

## Approve

Call `newl_print_approve` only when the same employee who created the plan explicitly approves the exact request ID. Set `confirmed` to true only then. Never infer approval from silence, the original request, a reaction, a schedule, a prior order, or another employee.

Return the complete tool result. If it remains queued, say only that the saved job is awaiting the worker; never claim that paper or labels printed.

## Status and failures

Call `newl_print_status` when the employee asks about a saved print request. A failed, expired, or uncertain job is never retried automatically. Tell the employee to inspect physical output before creating another request.

The required outbound-label printer is exactly `BIXOLON SRP-770III`. Never substitute `BIXOLON SRP-770III - BPL-Z`, a prior selection, a similar name, or a remembered printer ID. The worker resolves and verifies the current order page's exact printer every time.

## Unsupported requests

Do not process batches, “all checked orders,” scheduled printing, automatic printing, document-only subsets, reprints, Teamship updates, order releases, or customer communications. Explain that Phase 1 supports one explicit order and approval only.
