# Teamship Inventory For Nemo

Status: Draft. Suitable for the first Nemo knowledge release. It does not authorize inventory changes.

## Confirmed Newl Meanings

Evidence: `confirmed by Alex` in writing on 2026-07-20.

- On Hand is the total inventory for a SKU in the Inventory All view.
- Reserved is inventory assigned to shipping orders.
- Available equals On Hand minus Reserved.
- The Inventory All view is SKU-based. Quarantine and serial attributes do not change that view's calculation.
- An LPN is a handling-unit identifier. It represents a pallet about 95% of the time, but not always.

The numeric Available value does not prove that a specific serialized or quarantined handling unit can be shipped. Use LPN or location evidence when those attributes matter and say when the evidence is incomplete.

## Safe Search Guidance

Evidence: `confirmed by Alex` for saved views and the Inventory Orders search behavior; search controls and views are `observed in Teamship`.

- Saved views are user-specific and users have none by default. Report active filters rather than automatically clearing an intentional view.
- Inventory Orders list search did not find a SKU during the walkthrough. Do not promise that this list can locate inbound stock by SKU.
- Alternative serials may be suggested to Newl staff without separate approval. This does not approve customer-facing substitutions.

For a current-record question, Nemo must request an exact SKU, LPN, or serial number and a configured customer name. The employee does not need to know customer or warehouse IDs. Newl Apps resolves the name against the tenant's approved scope reference. A unique customer name may omit a trailing corporate suffix such as `Inc`, `Ltd`, or `LLC`; if the shortened name belongs to more than one configured customer, resolution fails closed and Nemo asks for the exact configured name. Newl Apps defaults the warehouse only when the customer has one configured warehouse. Exception confirmed by Alex on 2026-07-21: Garland defaults to Annagem when omitted; an explicitly supplied warehouse always wins. If the customer has several warehouses, return Newl Apps' warehouse-name choices. The current `searchTeamshipInventory` API path searches products eligible to be selected for shipping; it is not confirmed as a complete Inventory All ledger search. A zero result means no shipping-eligible API match and must not be described as no inventory or zero On Hand. LPN search is also not a documented contract for this endpoint.

The focused `searchTeamshipInventoryAll` and `searchTeamshipLpn` readers are implemented but disabled by default. When the supervised browser worker is configured, route quantity totals to Inventory All and route SKU requests for LPN/location/serial/quarantine detail, exact LPN requests, and exact serial requests to Ship by LPN. Ship by LPN results must preserve LPN group-caption evidence, expand the filtered grid to 100 items, and include any remaining pager pages. Until a supervised browser runtime is configured, use the API tool only for explicitly shipping-eligible SKU lookup. Questions about total On Hand, reserved-only stock, quarantined stock, full LPN/location coverage, or why a SKU is missing must return the browser capability as unavailable rather than infer an answer.
