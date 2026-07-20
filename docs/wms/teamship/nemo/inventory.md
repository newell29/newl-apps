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

For a current-record question, Nemo must request the exact customer and warehouse. The current `searchTeamshipInventory` API path searches products eligible to be selected for shipping; it is not confirmed as a complete Inventory All ledger search. A zero result means no shipping-eligible API match and must not be described as no inventory or zero On Hand. LPN search is also not a documented contract for this endpoint.

The focused `searchTeamshipInventoryAll` and `searchTeamshipLpn` readers are implemented but disabled by default. Until a supervised browser runtime is configured, use the API tool only for explicitly shipping-eligible SKU lookup. Questions about total On Hand, reserved-only stock, quarantined stock, full LPN/location coverage, or why a SKU is missing must return the browser capability as unavailable rather than infer an answer.
