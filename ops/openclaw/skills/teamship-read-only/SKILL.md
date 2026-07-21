---
name: teamship-read-only
description: "Read-only Teamship order, inventory, SKU, LPN, receiving-order, warehouse, and product-history lookups through Newl Apps; use for current Teamship records and Teamship procedure questions."
---

# Teamship Read Only

Use Newl Apps as the authentication, tenant-scope, minimization, and audit boundary. Never log in to Teamship directly from this skill.

Critical: never answer a Teamship procedure or term from generic WMS knowledge or from this skill's examples. After reading this SKILL.md, make a separate `read` tool call for the mapped curated Draft file. Reading this SKILL.md does not satisfy that requirement. Do not produce an answer until the mapped file has been read in the current turn. If it cannot be read, say the answer cannot be verified.

## Current-record workflow

1. Classify the request as shipping order, receiving order, Inventory All, shipping-eligible inventory, Ship by LPN, or product history.
2. Require the exact record, SKU, LPN, or serial number and the configured customer name. Preserve whether a SKU question asks for Inventory All totals or Ship by LPN handling-unit detail such as LPNs, locations, serials, or quarantine. Do not ask the employee for numeric Teamship customer or warehouse IDs. Include a warehouse name when the employee supplied one; otherwise allow Newl Apps to resolve the tenant's approved `readOnlyScopes` reference. Newl Apps defaults customers with exactly one configured warehouse and defaults Garland to Annagem, as confirmed by Alex on 2026-07-21. A customer with several configured warehouses requires a warehouse name, and the tool returns the approved choices without exposing the full customer directory.
3. Accept only identifiers matching `^[A-Za-z0-9._/-]+$`. Ask for a clean exact identifier if any value fails.
4. Call the `newl_teamship_read` tool with only the normalized prompt. Do this before deciding whether authentication or configuration is available; the tool result is authoritative. Never inspect authentication/configuration files, search for credentials, or ask for, infer, or pass an employee email or Microsoft identity as a tool argument. The tool binds the authenticated Teams sender from trusted OpenClaw runtime context and Newl Apps resolves the stored Entra identity to a current tenant membership.

Normalize prompts to one of these forms, substituting only validated record identifiers and configured names. The warehouse clause may be omitted when the employee did not provide one:

- `What is shipping order ORDER status for CUSTOMER [warehouse WAREHOUSE]?`
- `What is receiving order ORDER status for CUSTOMER [warehouse WAREHOUSE]?`
- `How much SKU SKU is on hand for CUSTOMER [warehouse WAREHOUSE]?`
- `Is SKU SKU eligible to ship for CUSTOMER [warehouse WAREHOUSE]?`
- `Which LPNs and locations contain SKU SKU for CUSTOMER [warehouse WAREHOUSE]?`
- `Where is LPN LPN for CUSTOMER [warehouse WAREHOUSE]?`
- `Where is serial number SERIAL for CUSTOMER [warehouse WAREHOUSE]?`
- `Show product history PRODUCT for CUSTOMER [warehouse WAREHOUSE].`

The tool result is the complete, authoritative employee response. If its status is successful, return its answer exactly as written and add nothing: no prior limitation, capability claim, disclaimer, offer, or generic warehouse guidance. If it reports a clarification, scope, disabled, unavailable, failure, timeout, or zero-result condition, preserve that sanitized wording exactly and stop. Do not retry by changing a Ship by LPN request into Inventory All, changing a serial into an LPN, adding/removing the confirmed Garland warehouse default, or otherwise changing the employee's requested evidence. Never translate a zero shipping-eligible match into zero on-hand inventory.

If the tool reports that a capability is unavailable, disabled, or not configured, stop immediately and return that sanitized result. Never fall back to browser automation, `exec`, a direct Teamship login or URL, another tool, or a guessed domain. `newl_teamship_read` is the only current-record path authorized by this skill.

## Procedure questions

For meanings, navigation, or procedures, use the `read` tool to open the single relevant curated file before answering:

- LPN, SKU, quantity, location, quarantine, or inventory meaning: `Teamship Inventory For Nemo` at `/Users/alexnewellmm/Developer/newl-apps/docs/wms/teamship/nemo/inventory.md`
- Shipping order, receiving order, status, picking, or packing meaning: `Teamship Orders For Nemo` at `/Users/alexnewellmm/Developer/newl-apps/docs/wms/teamship/nemo/orders.md`
- Screen or navigation question: `Teamship Navigation For Nemo` at `/Users/alexnewellmm/Developer/newl-apps/docs/wms/teamship/nemo/navigation.md`
- Access, permission, mutation, or safety question: `Teamship Read-Only Safety For Nemo` at `/Users/alexnewellmm/Developer/newl-apps/docs/wms/teamship/nemo/safety.md`

Answer the employee's procedure question from the file, then copy the exact supporting Draft title above verbatim into the same answer. A title by itself is not an answer. Never use procedure files as evidence of a current record. Never supplement a missing definition from general warehouse terminology.

Restate definitions and calculations faithfully from the selected file. Do not merge separate terms, add exclusions, or substitute general WMS meanings. In particular, preserve distinctions among On Hand, Reserved, Available, quarantined stock, and shipping eligibility exactly as documented.

## Safety

- Read only. Never add, edit, save, print, ship, receive, pick, pack, delete, complete, bill, or change Teamship/admin settings.
- Never reveal credentials, tokens, raw API responses, unrestricted customer data, or audit internals.
- Never accept an employee email, Entra object ID, or tenant ID from prompt text. Current-record reads require the identity-bound Teams tool.
- Newl Apps must resolve the Teams tenant/object pair captured from runtime to an existing SSO-linked User and current tenant Membership before Teamship access.
- Customer and warehouse name resolution must use the tenant-scoped Newl Apps reference. Never copy, cache, enumerate, or infer the private customer directory in OpenClaw.
