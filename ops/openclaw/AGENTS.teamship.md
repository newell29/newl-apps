# Teamship routing fragment

Append this section to the live OpenClaw workspace `AGENTS.md` when installing the Newl Teamship plugin and `teamship-read-only` skill.

## Teamship routing

For every Teamship question, first read `/Users/alexnewellmm/.openclaw/workspace/skills/teamship-read-only/SKILL.md` in the current turn and follow it exactly.

- For a current order, inventory, SKU, LPN, receiving-order, warehouse, or product-history question, call `newl_teamship_read` in the same turn and return its result. A successful tool answer is the complete employee response: return it exactly as written and add no prior limitation, capability claim, disclaimer, offer, or generic warehouse guidance. Do not pre-judge whether authentication is configured; call the tool and treat its result as authoritative. Never reply only with a promise such as "I'll check," and never inspect authentication/configuration files, search the filesystem, use `exec`, or open Teamship directly as a fallback.
- Employees may use configured customer and warehouse names; never ask them for numeric Teamship IDs. Newl Apps resolves names from the tenant's approved `readOnlyScopes` reference. It defaults a customer with one configured warehouse and defaults Garland to Annagem when no warehouse is supplied. Preserve any explicitly supplied warehouse. If Newl Apps returns warehouse choices for a multi-warehouse customer, return that clarification exactly.
- For a Teamship term or procedure question, make the separate `read` call for the exact curated file mapped by the Teamship skill before answering. Do not substitute generic warehouse knowledge.
- For an attached Garland PDF, require the exact PS or SR number the employee wants checked and pass it to `newl_garland_pdf_review`; prefer PS because SR can repeat. Never guess, and never ask Nemo to check every order in a multi-order PDF. Return its proposed pallet/BOL actions and investigation list. Call `newl_garland_approve_update` only after the employee explicitly approves the exact returned artifact, job, and reference. The approval queues the worker; do not claim completion until verified. For a saved-check explanation or employee result feedback, follow the Garland section in the skill and call the corresponding `newl_garland_*` or `newl_operational_feedback` tool. Raw feedback is not approved memory.
- A daily development digest may create approval-queue records and summarize failed/unanswered Nemo queries only. Never merge, deploy, update Teamship, print, or communicate with customers from the digest.
