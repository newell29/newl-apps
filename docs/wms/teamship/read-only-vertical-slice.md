# Teamship Knowledge And Read-Only Search Vertical Slice

Status: Draft. The knowledge subset is suitable for the first Nemo release. Live Teamship search remains disabled until the supervised enablement steps below are approved and completed.

## Curated Nemo Knowledge

The assistant registry indexes only this allowlist when the tenant has both Assistant and Shipment Documents access:

| Document | Evidence included | Normal retrieval status |
| --- | --- | --- |
| `docs/wms/teamship/nemo/navigation.md` | Observed screen names plus routing guidance. | Included as Draft. |
| `docs/wms/teamship/nemo/inventory.md` | Alex-confirmed quantity/LPN meanings and conservative search guidance. | Included as Draft. |
| `docs/wms/teamship/nemo/orders.md` | Alex-confirmed inbound/outbound meanings with the Complete/Closed label caveat preserved. | Included as Draft. |
| `docs/wms/teamship/nemo/safety.md` | Alex-confirmed access boundaries plus Newl Apps read-only controls. | Included as Draft. |

Raw transcripts, evidence ledgers, reconciliation tables, contradiction reports, review notes, sampled-frame analysis, open questions, and inferred statements are not in the allowlist. Teamship procedural answers must identify the exact retrieved Draft document. Curated documents never establish a current record state.

## Existing API Capability Matrix

Classification describes the evidence available after this vertical slice. `Already implemented` means tested in repository code with mocked and sanitized responses, not approved for unsupervised production use.

The published Teamship API documentation and OpenAPI-rendered reference were inspected on 2026-07-20. A supervised, redacted production API read and focused read-only Playwright discovery were also completed with Alex's explicit approval. No Teamship record, setting, receipt, shipment, product, billing item, print job, or administrative value was changed.

| Capability | Classification | Evidence classification and rationale |
| --- | --- | --- |
| Inventory search by SKU | already implemented with a critical scope limitation | Existing repository code calls `POST /v1/ship-inventories/search-products`. Teamship documents this as products available in inventory for shipping, and a supervised test returned zero for a SKU present on a requested shipping order. A zero result means no shipping-eligible match for that customer/location/query; it does not prove that the SKU is absent or that on-hand quantity is zero. |
| Inventory search by LPN | implemented as a disabled-by-default browser reader | The published product search describes `search` as product-name or SKU search. `searchTeamshipLpn` now has typed, minimized, exact-scope browser output for LPN, location, quantity, quarantine, serial, and status. The runtime returns `CAPABILITY_UNAVAILABLE` unless a supervised browser adapter is supplied. |
| Customer filtering | supported by API and already implemented | The published product-search request requires `user_id`, documented as the customer/user ID. Newl Apps still requires an exact configured customer scope before the call. |
| Warehouse filtering | supported by API and already implemented | The published product-search request requires `location_id`, documented as the warehouse location ID. The Teamship ID-to-Newl warehouse-label mapping remains configuration data. |
| Location filtering | already implemented | The known product-search request includes the required warehouse `location_id`; exact results are post-filtered when response location evidence is present. |
| Customer directory for accessible warehouses | supported by API but not implemented | `GET /v1/inventory-orders/customers` returns customers relevant to the authenticated user. The supervised response contained customer ID, name, company, and customer-type fields. |
| Exact customer-to-warehouse directory | extracted and approved as a configuration candidate; not applied | The customer API has no warehouse field. A read-only profile extraction reviewed 280 profiles: 61 active, 219 deactivated, 90 observed active assignment rows, and no read errors. Alex approved the mappings and directed Newl Apps to exclude `New Toronto Street`, `49th`, and `New Huntington Road` because those warehouses are not in use. The resulting candidate contains 87 scope entries across nine warehouses and remains outside Git. |
| Available quantity | implemented as a disabled-by-default Inventory All browser reader | `searchTeamshipInventoryAll` preserves visible Available as an Inventory All value and does not equate it with the shipping-eligible API or LPN-row quantity. |
| Reserved quantity | implemented as a disabled-by-default Inventory All browser reader | The reader returns visible Reserved only after exact SKU, customer, and warehouse verification. |
| On-hand quantity | implemented as a disabled-by-default Inventory All browser reader | The reader returns visible On Hand only after exact SKU, customer, and warehouse verification. |
| Quarantine state | requires confirmation | Product list responses include a product-level `is_quarantine` field. Existing repository code can normalize stock-level candidate fields `is_quarantine` and `is_quarantine_stock`, but the supervised product search did not return a stock row and therefore did not confirm SKU-versus-LPN semantics. |
| Shipping-order search and details | already implemented and live-read confirmed | Existing repository code lists `/v1/ship-inventories` and loads `/v1/ship-inventories/{id}`. Supervised responses included explicit customer, warehouse, status, process, item/SKU, picking/packing-related, and e-commerce status field families. The API-only reader minimizes these records. |
| Receiving/inventory-order search and details | implemented as a disabled-by-default browser reader | `getTeamshipReceivingOrder` reads the exact detail route and minimizes status, scope, receipt metadata, incoming/received quantities, SKUs, LPNs, locations, weight, and pallet count. It remains unavailable without a supervised browser adapter. |
| Picking and packing status | requires confirmation | UI controls and stages are observed, but stable API fields and exact status values are not proven. Candidate fields remain nullable. |
| Product history | implemented as a disabled-by-default browser reader | `getTeamshipProductHistory` reads `/view-product/{productId}`, verifies the exact customer, filters history rows to the configured warehouse, and returns only dated event, adjustment, resulting Available, warehouse, batch, serial, and status fields. |

## Read-Only Tool Contracts

`searchTeamshipInventory` accepts an exact SKU or LPN query plus exact customer and warehouse IDs. Its current API source is limited to shipping-eligible product search. It returns minimized matching records and `ZERO`, `ONE`, or `MULTIPLE` cardinality, but `ZERO` must not be translated as no inventory. General LPN search and complete On Hand/Reserved/quarantine coverage remain unconfirmed.

`getTeamshipShippingOrder` accepts an exact shipping-order, customer, and warehouse ID. It uses API list/detail reads only. A record is withheld with `SCOPE_UNVERIFIED` unless returned customer and warehouse evidence exactly matches the trusted configured scope.

`getTeamshipReceivingOrder` accepts the same exact scope and identifier contract and returns `CAPABILITY_UNAVAILABLE` when no supervised browser adapter is configured. This is intentional fail-closed behavior because no supported read API endpoint has been confirmed.

`searchTeamshipInventoryAll`, `searchTeamshipLpn`, `getTeamshipReceivingOrder`, and `getTeamshipProductHistory` now support a guarded `TeamshipBrowserReadAdapter`. Their Playwright implementation restricts navigation to allowlisted HTTPS Teamship hosts, asserts the expected route and heading, permits only Inventory `All`, `Ship by LPN`, and `Search` controls, minimizes visible tables, and rejects unverified scope evidence. No browser adapter is wired into the assistant runtime, so these operations remain unavailable by default.

The Mac-hosted browser worker may set `VERCEL_AUTOMATION_BYPASS_SECRET` when its
Newl Apps base URL is a protected Vercel Preview. The worker sends that value only
as `x-vercel-protection-bypass`; it is optional and is never logged. Operators
must leave it unset for an unprotected or production base URL.

All three operations write a tenant- and user-scoped `AuditLog`. Successful data is withheld if the audit write fails. Outputs never include credentials, unrestricted raw API data, customer email, addresses, shipping instructions, billing, administrative fields, or write controls.

Normalized error codes are `INVALID_INPUT`, `ACCESS_DENIED`, `TOOL_DISABLED`, `SCOPE_NOT_CONFIGURED`, `SCOPE_UNVERIFIED`, `CAPABILITY_UNAVAILABLE`, `CREDENTIALS_NOT_CONFIGURED`, `TEAMSHIP_UNAVAILABLE`, and `AUDIT_FAILED`.

## Deterministic Routing

| Question type | Route |
| --- | --- |
| Meaning, navigation, or procedure | Curated Teamship knowledge retrieval with Draft document attribution. |
| Current shipping-eligible SKU match | `searchTeamshipInventory`, with zero described only as no shipping-eligible API match. |
| Current total inventory, Reserved/On Hand, LPN, or location detail | Future guarded Playwright inventory reader; current live tool remains unavailable. |
| Current shipping-order state or detail | `getTeamshipShippingOrder`. |
| Current receiving/inventory-order state | `getTeamshipReceivingOrder`. |
| Generic order or missing scope | Ask for order type and the missing exact order, SKU, LPN, customer, or warehouse identifier. |

The routing contract is integrated into the Nemo runtime, but generic SKU/LPN routing must be narrowed before live enablement so complete-inventory questions cannot invoke the shipping-eligible API. Procedural questions continue to curated retrieval, clarification routes make no Teamship call, and approved current-record routes invoke the appropriate read tool. Live calls still fail closed unless the tenant enable flag, exact scope, role/user access, entitlement, and tenant credentials are all configured.

## Authorization Enforcement

Application code performs these checks before a Teamship call:

1. The caller supplies a server-resolved `AuthenticatedContext`; the model cannot create it.
2. `requireModule` enforces Newl role access and the tenant's Shipment Documents entitlement.
3. The tenant integration must have `readOnlySearchEnabled: true`. It defaults to false.
4. The caller must be Alex Newell, Faisal Haroon, Suzy Boreham, or Lily Morales, matched by exact canonical name or a known exact email address. These four internal employees may read information for every customer and warehouse. No Newl role, including Admin or Manager, bypasses this named-user policy.
5. The requested customer and warehouse IDs must exactly match one `readOnlyScopes` entry in the tenant's Teamship integration settings. For the four approved employees, these entries are technical Teamship customer/warehouse mappings rather than permission limits.
6. Tenant-stored encrypted Teamship credentials are required. The tools do not fall back to global environment credentials.
7. The API request uses the scope's configured Teamship inventory user and location IDs. Returned records are post-checked when scope evidence exists.
8. Billing, charges, administrative data, and unrestricted raw payloads are excluded from the output.
9. The audit record captures tenant, employee, operation, requested customer/warehouse, result count or normalized error, and accessed Teamship record IDs.

The temporary user permission decision is complete. The focused discovery confirmed warehouse IDs: Kestrel `1`, Monte Vista `6`, Watline `13`, New Toronto 4 `14`, New Toronto 3 `15`, New Toronto 2 `17`, Sandy Porter `18`, JP `19`, and Annagem `102`. Alex approved the active customer-profile mapping on 2026-07-20 and confirmed that `New Toronto Street`, `49th`, and `New Huntington Road` are not in use and must be ignored. The approved configuration candidate contains 87 entries covering all 61 active customer profiles. An admin-only settings control now accepts the reviewed JSON, validates every scope, and exposes a separate tenant enable switch. No production configuration was changed during implementation.

## Playwright Boundary

The API should be used for shipping-eligible SKU search, exact customer and warehouse-location scoping, accessible-customer discovery, product list/detail, and shipping-order list/detail. Playwright is not needed for those reads. The shipping-eligible search must not be described as a complete inventory ledger search.

The published and supervised API evidence does not expose warehouse-directory mapping, receiving/inventory-order list or detail reads, product history, a documented LPN-search contract, or complete inventory including stock that is reserved, quarantined, or otherwise unavailable for a new shipping order. Focused read-only browser automation is justified for those gaps unless Teamship provides undocumented supported read endpoints. Browser automation is also appropriate for active-filter/view verification and visible picking/packing sub-status when the API response does not expose it. Printing, Billing, Admin mutations, and all write workflows remain excluded even if browser automation is technically possible.

## Smallest Supervised Test Plan

1. Keep `readOnlySearchEnabled` false. Validate the approved 87-entry candidate against `TeamshipReadScope[]` parsing and apply it to a supervised non-production or disabled tenant setting before any live call.
2. Test one shipping-eligible SKU that returns one API row and one that returns multiple rows. Reconcile each with Inventory All and Ship by LPN. Treat API zero as `no shipping-eligible API match`, not `no inventory`.
4. Test one known shipping order in scope and one order outside scope. The in-scope record must be minimized and audited; the out-of-scope record must return no data.
5. Inspect the generated audit rows and confirm they contain record IDs and scope evidence but no credentials or raw payloads.
6. Implement receiving-order lookup only as a guarded read-only Playwright tool unless Teamship supplies a supported API read endpoint. Add tests that block every observed mutation control.
7. Enable automatic Nemo tool invocation only after the above checks pass. Start with the single approved employee and scope; broaden access through explicit scope entries, never a Manager-wide default.
