# Newl Printing OpenClaw Plugin

Phase 1 provides three identity-bound Microsoft Teams tools for a single exact Teamship shipping-order number:

- `newl_print_plan` creates a Garland/Annagem plan for one picking list, one BOL, and outbound labels equal to the live pallet count. It prints nothing.
- `newl_print_approve` requires the same employee's explicit approval and queues the immutable plan.
- `newl_print_status` reports the saved result without retrying it.

The plugin never logs in to Teamship or accesses a local printer. It calls Newl Apps with a dedicated `OPENCLAW_PRINT_TOKEN`; Newl Apps enforces tenant membership, module and mutation access, employee allowlisting, approval, expiry, idempotency, and audit records. A separately authenticated local worker performs deterministic Teamship and CUPS actions.

The required outbound-label printer is exactly `BIXOLON SRP-770III`. The worker resolves that printer from the current order page every time, selects it explicitly, and reads the selection back immediately before printing. It does not cache a printer ID from a prior order.

Batch printing, automatic printing, retries, Teamship updates, order releases, and document regeneration are not implemented in Phase 1.
