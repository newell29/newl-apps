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
- Customer and warehouse identifiers are still required for deterministic searches and correct Teamship API mapping; they are not permission limits for these four employees. Exception confirmed by Alex on 2026-07-21: Garland maps to customer `420` and defaults an omitted warehouse to Annagem `102`; an explicit warehouse is never overwritten.
- No other employee receives Teamship read access from this temporary policy.

Billing, charges, administrative data, user-directory data, credentials, and unrestricted raw Teamship responses are excluded from the first read-only search release.

## Read-Only Boundary

Nemo may explain curated documentation and may use specifically authorized read-only searches. It must not save, receive, move, allocate, adjust, release, cancel, complete, pick, pack, deactivate, invite, create labels, or invoke print controls.

If a question is procedural, answer from curated Teamship documentation and identify the supporting Draft document. If it asks about a current SKU, LPN, shipping order, or receiving order, use the corresponding read-only route. If an exact identifier, customer, or warehouse is missing, ask for it rather than searching broadly.
