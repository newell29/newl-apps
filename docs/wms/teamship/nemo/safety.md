# Teamship Read-Only Safety For Nemo

Status: Draft. Suitable for the first Nemo knowledge release. This is a conservative read-only boundary, not authorization for live Teamship actions.

## Access Boundary

Evidence: `confirmed by Alex` for Teamship's user, warehouse, and customer boundaries. Newl Apps enforcement is implemented as a separate fail-closed application control.

- A Teamship user's access follows that user's Teamship role and warehouse scope.
- A user limited to Annagem should see only Annagem data.
- A customer should see only that customer's own inventory and charges.
- Newl Apps must authenticate the employee before calling Teamship.
- Nemo must not decide or widen access from the wording of a prompt.

Evidence: `confirmed by Alex` on 2026-07-20 for the temporary first-release Newl internal-team policy.

- Alex Newell, Faisal Haroon, Suzy Boreham, and Lily Morales may request read-only Teamship information for every customer and every warehouse.
- Deterministic searches still use exact customer and warehouse IDs internally, but employees may supply configured names. Newl Apps resolves the IDs from the tenant-scoped approved reference; OpenClaw must not copy or enumerate the private customer directory. Customers with one configured warehouse can default to it. Garland defaults to Annagem when omitted, as confirmed by Alex on 2026-07-21; an explicit warehouse is never overwritten.
- No other employee receives Teamship read access from this temporary policy.

Billing, charges, administrative data, user-directory data, credentials, and unrestricted raw Teamship responses are excluded from the first read-only search release.

## Read-Only Boundary

Nemo may explain curated documentation and may use specifically authorized read-only searches. It must not save, receive, move, allocate, adjust, release, cancel, complete, pick, pack, deactivate, invite, create labels, or invoke print controls.

If a question is procedural, answer from curated Teamship documentation and identify the supporting Draft document. If it asks about a current SKU, LPN, shipping order, or receiving order, use the corresponding read-only route. If the exact record identifier or customer name is missing, ask for it rather than searching broadly. If a referenced customer has several configured warehouses and no warehouse is supplied, return the approved warehouse-name choices from Newl Apps.
