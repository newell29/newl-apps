# Teamship Draft Promotion Confirmation Checklist

Status: Draft. Alex provided written answers on 2026-07-20. Business-rule ownership is resolved; the remaining items are focused UI evidence and an explicit promotion decision.

## Answered By Alex

1. **Names and terminology:** Warehouse name is `Annagem`; a table may prepend `Mississauga -`. Use `Nemo`. Customer name is `Zeal Concept` (Alex's latest correction supersedes the earlier plural answer). QAD is Garland's internal source system for EDI orders. An LPN is a pallet about 95% of the time but may be another handling unit.

2. **Inventory rules:** For Inventory All, On Hand is total, Reserved is assigned to shipping orders, and Available equals On Hand minus Reserved. The All view is SKU-based; quarantine and serial attributes do not affect its calculation.

3. **Statuses:** Inventory Open means not marked received; Complete means warehouse receiving is finished and inventory is available for customer orders; ignore Draft. Shipping Open means created but not closed; Closed means picked, charged, and closed; ignore Hold/Draft. Bulk is non-e-commerce/non-individual-unit-pick work. E-commerce usually involves individual-unit small-parcel Picking and Packing.

4. **Search and answers:** Saved views are user-specific and absent by default. Find a SKU on inbound orders by inspecting each inbound order for the relevant customer. Alternative serials may be suggested to Newl staff without separate approval.

5. **Printing:** BOL Print opens another popup; Print there sends to the selected Teamship printer. Picking List and Packing List download PDFs. Outbound shipping labels print directly to the selected printer, with label count matching pallet count.

6. **Access and confidentiality:** Access follows the individual Teamship role and warehouse scope. Annagem-only users should see only Annagem. Customers should see only their own inventory and charges.

7. **Business ownership:** Alex Newell may approve all captured documentation rules without additional CSR, warehouse, finance, or admin co-sign-off.

## Remaining Focused Evidence

1. Confirm exact Bixolon and Konica Minolta Teamship queue names, media sizes, and physical destinations.
2. Confirm the Teamship `Complete` UI label versus Alex's operational word `Closed`.
3. Confirm Teamship `Accepted` versus carrier `Label Created` and the safe physical-location interpretation.
4. Capture one quarantined LPN/SKU so Nemo can distinguish the SKU-only All view from handling-unit quarantine.
5. Capture the role-by-screen visibility needed for Billing, User Directory, profiles, attachments, pricing, and EDI fields.
6. Confirm which Teamship roles may execute Release Hold, Close/Complete, printing, invoicing, and admin changes. This is execution authorization, not documentation ownership.

## Promotion Gate

The Draft can be considered for promotion only after:

- The seven grouped questions above have written answers. **Complete.**
- Alex is the approving owner for the captured business meanings. **Complete.**
- Terminology variants are resolved or explicitly retained as known UI/source differences. **Partially complete.**
- Contradictions C01-C13 have an accepted resolution or an explicit `known limitation` label. **Partially complete.**
- Any screenshots selected for Git are reviewed, cropped/redacted, and sanitized.
- Focused Record & Replay/Playwright evidence covers the remaining quarantine, status, carrier, printer, and access-control gaps.
- Alex explicitly requests promotion of the reviewed files. **Not yet requested.**
