# Teamship Contradictions And Evidence Conflicts

Status: Draft. Not approved or complete.

This list records actual contradictions, live corrections, stale statements, and evidence conflicts. Differences that are merely screen-specific are listed separately so they are not mistaken for contradictions.

## Contradictions And Corrections

| ID | Sources | Conflict | Current Draft resolution | Owner / next evidence |
| --- | --- | --- | --- | --- |
| C01 | Narration 00:03:46-00:04:14 versus 00:14:31-00:14:56 | Alex first says every table can search any specific information, then tests Inventory Orders SKU search and says it does not function. | Resolved by Alex: search scope differs by screen; inspect each inbound order for the relevant customer to find a SKU. Saved views are user-specific and none exist by default. | Focused capture is optional for selector/tool design, not business meaning. |
| C02 | Narration 00:23:22-00:23:43 versus 00:23:43-00:24:04 | Alex initially says a document click prints to the selected printer, then observes that the demonstrated Pick Ticket action downloaded a PDF instead. | Resolved by Alex per control: Picking List and Packing List download PDFs; BOL Print opens a popup whose Print action sends to the selected printer; outbound labels print directly. | Controlled-printer evidence remains required before automation. |
| C03 | Narration 00:24:34-00:24:59 versus visual frames 0026/0029/0033-0036 | Whisper captured a Bixolon `SRP 770II`; historical UI frames showed a suffixed `BIXOLON SRP-770III` queue. | Resolved 2026-07-22: Alex confirmed the exact outbound-label printer is `BIXOLON SRP-770III` with no suffix. Preserve older frames only as historical evidence. | Confirmed by Alex. |
| C04 | Narration variants versus visual frames 0016/0036/0040 | Whisper produced `Anagem`, `Anagen`, `Anajam`, and `EnerGem`; the UI shows `Annagem`. | Resolved by Alex: official warehouse name is `Annagem`; a table may display the composite `Mississauga - Annagem`. | No further business-term confirmation required. |
| C05 | Transcript heading/wording versus visual frames 0004/0006 | Transcript often says `shipped by LPN`; Teamship tab reads `Ship by LPN`. | Resolved: use exact UI label `Ship by LPN`; Alex confirms LPN is a handling-unit identifier that is a pallet about 95% of the time, but not always. | Unclear `total PN` transcript phrase remains separate. |
| C06 | Narration 00:18:03-00:18:17 versus visual frame 0019 | Alex calls the example an inbound order, then immediately corrects himself to shipping order; UI route/page is a shipping-order/ship-inventory page. | Treat `inbound` as a spoken slip. | Resolved by immediate narration correction and visual. |
| C07 | Narration 00:27:41-00:28:09 versus visual frame 0029 | Alex describes an external carrier page with `Label Created`; sampled Teamship frame near 28:00 shows `Status: Accepted`. | Keep carrier and Teamship statuses separate. Do not infer physical location from the Teamship status alone. | CSR confirms status mapping with a focused tracking session. |
| C08 | Existing Draft status text versus available artifacts | Several Draft files said narration was pending transcription; the small.en transcript now exists and has been reconciled. | Only stale evidence-status sentences are updated in this change while every Teamship document remains Draft. | Resolved as evidence-state maintenance. |
| C09 | Current `glossary.md` versus narration 00:04:46-00:05:13 | Glossary labels LPN meaning as Codex inference; Alex explicitly defines license plate number and calls it a pallet identifier. | Resolved by Alex's follow-up: an LPN is a handling-unit identifier, commonly a pallet (about 95%) but not always. Glossary updated in Draft. | No remaining meaning conflict. |
| C10 | Current `screen-map.md` wording versus narration/visual 00:29:43-00:30:03, frames 0031-0032 | Draft says product history appears separately under Inventory History; narration says Product Details `also gives you a history`. Visual suggests a Product History entry point opens a separate Inventory History screen. | Clarify entry point versus destination; do not choose one phrasing as exclusively correct. | Focused product-history capture. |
| C11 | Narration outbound-label direct-print claim versus `docs/teamship-bol-editor-print-automation-investigation.md` | Narration says the outbound-label Print action automatically sends to the selected printer. Repository investigation found the modal but intentionally did not click Print, so code/docs do not prove the effect. | Alex confirms direct print and pallet-matched label count as Newl operational meaning. Repository evidence remains `not execution-tested`, so automation still requires a controlled printer. | Business meaning resolved; automation evidence open. |
| C12 | Initial written follow-up versus Alex's correction and visual frames 0028/0029/0033/0034 | The initial follow-up said `Zeal Concepts`; Alex corrected it to singular `Zeal Concept`, which matches sampled UI rows. | Resolved: use `Zeal Concept`. The earlier plural answer is superseded and retained only as correction history. | No remaining conflict. |
| C13 | Alex written follow-up versus sampled Shipping Orders UI | Alex defines a shipping order as `Closed` after picking and charges; sampled Shipping Orders tabs use `Complete`. | Draft describes the operational meaning as closed out but does not silently rename the UI tab. | Focused status capture should confirm whether another screen/control says Closed or whether `Complete (closed)` is the correct documentation form. |

## Important Scope Differences, Not Contradictions

- Teamship Inventory Orders list search failing for SKU does not conflict with Newl Apps calling Teamship's `/v1/ship-inventories/search-products`; these are different screens and interfaces.
- Teamship roles shown in User Directory are not the Newl Apps `Admin`, `Manager`, `Sales`, `Operations`, `Finance`, and `Read Only` roles. They are separate authorization systems.
- Repository Garland statuses such as `PENDING_TEAMSHIP`, `NO_PDF`, and `READY` describe Newl Apps review/update state, not Teamship's Open/On Hold/Draft/Complete states.
- Repository Phase 2 API updates to `pallets[]` do not prove that the manual Teamship UI workflow is approved for employees or general automation. They are a separate approved-job path with allowlists and readback requirements.
- A Complete shipping order does not necessarily mean carrier pickup or delivery; the narration itself later checks carrier tracking separately.
- The visual presence of customer emails, phone numbers, addresses, and users does not authorize the assistant to disclose them.

## No Supporting Contradiction Found

No repository evidence contradicted the visible existence of Inventory, Inventory Orders, Shipping Orders, Products, Manage Warehouses, Billing, Admin, Reports, product details, receiving order detail, shipping-order detail, pallet fields, invoice views, User Directory, or customer profile screens.
