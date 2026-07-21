# Read-Only Browser Reader Implementation

Status: Draft implementation and supervised validation evidence. The browser adapter has been validated read-only against four approved live Teamship examples; it is not enabled in the assistant runtime.

## Implemented Readers

| Reader | Source view | Minimized output |
| --- | --- | --- |
| `searchTeamshipInventoryAll` | Inventory -> All | Exact SKU, product/stock IDs, Available, Reserved, On Hand, Backordered, status, quarantine, customer, and warehouse. |
| `searchTeamshipLpn` | Inventory -> Ship by LPN | Exact SKU or LPN, quantity, location, status, serial, quarantine, customer, and warehouse. |
| `getTeamshipReceivingOrder` | Exact inventory-order detail route | Status, customer, warehouse, receipt metadata, pallet count, SKU, Incoming, Received, LPN, location, and weight. |
| `getTeamshipProductHistory` | Exact product detail route | Product/SKU/customer plus warehouse-filtered history date, event, adjustment, resulting Available, batch, serial, and status. |

## Safety Design

- Application authorization and exact configured customer/warehouse scope are checked before credentials or browser execution.
- Credentials stay server-side and are never included in tool output, model context, or audit metadata.
- The browser accepts only allowlisted HTTPS Teamship application hosts.
- The only operational controls allowlisted for browser interaction are `All`, `Ship by LPN`, and `Search`.
- Known Save, Edit, Add, Receive, Complete, Deactivate, Quarantine, Ship, Transfer, Send, Print, and related mutation controls are rejected by the interaction allowlist.
- Every returned row is minimized and post-checked against exact customer and warehouse evidence.
- Successful data is withheld when audit logging fails.
- No browser adapter is wired into the assistant runtime. Missing runtime configuration returns normalized `CAPABILITY_UNAVAILABLE`.

## Deterministic Routing

- `Where is SKU ...?` and `Where is LPN ...?` route to `searchTeamshipLpn` because location evidence is required.
- Available, Reserved, On Hand, Backordered, and Inventory All questions route to `searchTeamshipInventoryAll`.
- Explicit shipping-eligible or available-to-ship questions retain the existing API-backed `searchTeamshipInventory` route.
- Receiving-order questions route to `getTeamshipReceivingOrder`.
- Product-history questions require exact product, customer, and warehouse IDs and route to `getTeamshipProductHistory`.

## Verification

Sanitized tests cover grid/table minimization, blocked-control rejection, zero/one/multiple cardinality, exact query matching, scope rejection, receiving-order minimization, warehouse-filtered product history, assistant routing, and source attribution.

On 2026-07-20, a supervised headed-browser session validated one approved Garland Canada Distribution / Annagem example per reader:

| Reader | Approved example | Result |
| --- | --- | --- |
| Inventory All | SKU `4531010` | One exact scoped row; Available `0`, Reserved `0`, On Hand `0`, quarantine `No`. |
| Ship by LPN | LPN `63991` | One exact scoped row; SKU `SR114E00082`, location `0802A`, quantity `1`. |
| Receiving Order | Teamship order `4392` | One exact scoped order; status `Complete`, one pallet, one received item. |
| Product History | Teamship product `45312` | One exact scoped product with 12 Annagem history rows. |

The session used only navigation, the `All` and `Ship by LPN` tabs, and Search. It performed no Teamship writes. The full minimized validation report is stored outside Git in the Teamship recording artifacts folder.

The application-level gate was separately exercised with `readOnlySearchEnabled: false` and empty scopes. All four tools returned `TOOL_DISABLED`, did not invoke a browser reader, and generated sanitized audit payloads containing tenant, actor, operation, customer ID, warehouse ID, policy version, error code, and empty record IDs. Credentials were absent from every inspected audit payload.

The live adapter is now wired behind two independent fail-closed controls: the server must have `TEAMSHIP_BROWSER_READ_RUNTIME_ENABLED=true` with an explicit Chrome path, and the tenant must have `readOnlySearchEnabled=true` with an exact configured scope. Both controls default off. Browser reads are serialized to one active session per server process. An authenticated OpenClaw endpoint resolves a current Newl membership before using the same assistant routing and audit path. No production configuration was changed during implementation.
