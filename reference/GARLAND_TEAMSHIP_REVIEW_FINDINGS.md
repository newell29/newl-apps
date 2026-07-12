# Garland Teamship Review Findings

Last updated: 2026-07-11

This file captures the current Stage 1 Teamship review findings so future Garland testing does not depend on chat history.

## Scope

- Stage 1 is read-only. Do not save, update, delete, print, or submit Teamship orders while testing this module.
- The test PDF is `/Users/alexnewell/Downloads/12 ORDERS 13 PAGES - PS210206 - PS210217.pdf`.
- The Newl app page is `/shipment-documents/teamship-review`.
- The Teamship UI page used for validation is `https://members.fulfillit.io/ship-inventories`.
- The Teamship API docs page reviewed for this module is `https://app.teamshipos.com/api-docs#tag/Authentication/operation/login`.

## Repeatable Checks

PDF-only extraction:

```bash
TMPDIR=/private/tmp npm run verify:garland-teamship -- \
  --pdf "/Users/alexnewell/Downloads/12 ORDERS 13 PAGES - PS210206 - PS210217.pdf" \
  --pdf-only \
  --json
```

Expected PDF-only result:

- `orderCount` is `12`.
- PS210210 / SR811861 is one order with `pageNumbers: [5, 6]`.
- All other orders are single-page orders.

If the hourly Teamship Alert Digest says a PDF order was not pushed into Teamship, paste the digest into the Teamship Review page before running the review. The app parses order lines such as `Order SR811861` and marks those missing Teamship orders amber as pending Teamship creation, not red as unexplained missing orders.

Focused tests:

```bash
TMPDIR=/private/tmp npm test -- garland-teamship-review.test.ts
npm run lint
npm run build
```

## Stage 1 Verification Evidence

Latest verification on 2026-07-11:

- `TMPDIR=/private/tmp npm test -- garland-teamship-review.test.ts` passed with 13 tests.
- `TMPDIR=/private/tmp npm run verify:garland-teamship -- --pdf "/Users/alexnewell/Downloads/12 ORDERS 13 PAGES - PS210206 - PS210217.pdf" --pdf-only --json` returned `orderCount: 12` and grouped PS210210 / SR811861 on pages `[5, 6]`.
- `npm run lint` passed.
- `npm run build` passed and included `/shipment-documents/teamship-review`, `/api/shipment-documents/teamship-review/run`, and `/api/shipment-documents/teamship-review/daily-orders`.
- Production `https://newl-apps.vercel.app/shipment-documents/teamship-review` rendered the Teamship Review page, Garland navigation, Teamship API status, one-time login fallback, alert digest section, `Run Teamship review`, and `Fetch Teamship daily orders`.

## Runtime Data Flow

- The intended production flow is manual-first for now: pull Teamship orders for the shipment date range, upload Garland's PDF batch, run the review, then save the review run to history.
- Manual Teamship pull is available from the page and calls `/api/shipment-documents/teamship-review/daily-orders` with `shipmentDateFrom` and `shipmentDateTo`.
- Manual pull saves new Teamship orders into Newl Apps' tenant-scoped `TeamshipSyncedOrder` cache and skips orders that already exist. It does not mutate Teamship.
- The PDF review run uses the uploaded Garland PDF as the source of PDF-inspected SRs and compares against the saved Teamship cache for the selected shipment date when available.
- If no saved Teamship orders exist for the selected date, the review route can still fall back to the read-only Teamship fetch by uploaded SR/shipment ID.
- The 15-minute Vercel cron schedule is intentionally disabled for now because Hobby plans only allow daily cron. The protected GET route still exists for a future Vercel Pro upgrade or external scheduler.

## Current CSR Workflow

1. Open `/shipment-documents/teamship-review`.
2. Set the Teamship manual sync `from` and `to` dates, then click `Pull missing Teamship orders`.
3. Upload Garland's PDF batch for the shipment date.
4. Optional: paste the hourly Teamship Alert Digest if any Garland orders are known to be out of stock or otherwise not pushed into Teamship yet.
5. Click `Run Teamship review`.
6. Review the `Shipment review workspace` table. Each shipment is one expandable row; the row itself is color-coded and the field-by-field comparison opens inside that row instead of rendering as a separate results block down the page.
   - Green: PDF and Teamship reviewed fields match.
   - Red: PDF order is missing from Teamship without an alert, or matched Teamship data has field discrepancies.
   - Amber `Pending Teamship`: the PDF order is missing from Teamship but appears in the alert digest.
   - Amber `No PDF`: Teamship has an order for the selected date but the uploaded PDF batch did not include that SR.
   - Gray `Already reviewed`: the uploaded PDF contains an SR that already has a saved review run for that shipment date, so it was skipped instead of re-verified.
7. Use the row-level `Open shipping order` link to jump to the matching Teamship order when the Teamship order ID is known.
8. Download the run summary PDF when a quick manager/CSR review packet is needed. The PDF summarizes each shipment, its status color, PDF pages, Teamship order ID, and any non-matching fields.
9. Save the review run to history after CSR review.

Reupload behavior:

- If the same PDF batch is uploaded again for the same shipment date, SRs already saved in Teamship review history are skipped.
- Only not-yet-reviewed uploaded SRs are reverified.
- Teamship orders from the saved manual pull that are not present in the uploaded PDF and are not skipped reviewed SRs are called out as `No PDF`.
- Admins can delete test/error runs from history; deletion is soft-delete and tenant-scoped.

## PDF Extraction Baseline

The sample PDF parsed successfully with these orders:

| PS | SR | PDF pages | Ship via | Ship to | City/state | PO |
| --- | --- | --- | --- | --- | --- | --- |
| PS210206 | SR808478 | 1 | MIDLAND | J.R. MAHONEY LTD. | SYDNEY, NS | 0000037656 |
| PS210207 | SR795656 | 2 | SPEEDY | CHIPOTLE #5520 | MILTON, ON | 6038 |
| PS210208 | SR808173 | 3 | UPS CD STD | N WASSERSTROM | COLUMBUS, OH | OP00033958 |
| PS210209 | SR809846 | 4 | SPEEDY | CENTRE DE DISTRIBUTION #2 DOYON | LONGUEUIL, QC | 148856 |
| PS210210 | SR811861 | 5, 6 | UPS CD STD | NELLA TORONTO | TORONTO, ON | 2028CTCCONVO |
| PS210211 | SR810387 | 7 | P/U | BARRIE EQUIPMENT SALES | BARRIE, ON | 2026BES8129 |
| PS210212 | SR811920 | 8 | UPS CD STD | STOP REST EQUIP & SUPPL | KITCHENER, ON | 15378 |
| PS210213 | SR810386 | 9 | SPEEDY | LES ENTREPR TZANET INC | MONTREAL, QC | 84269 |
| PS210214 | SR812055 | 10 | UPS CD STD | LES ENTREPR TZANET INC | MONTREAL, QC | 84542 |
| PS210215 | SR811494 | 11 | P/U | NELLA CUTLERY | TORONTO, ON | 31697 |
| PS210216 | SR810154 | 12 | SURETRACK STANDARD | VANCOUVER AIRPORT HILTON | RICHMOND, BC | PO374982 |
| PS210217 | SR809212 | 13 | SURETRACK STANDARD | GEANEL RESTAURANT SUPPLIES L | SASKATOON, SK | 200242 |

## Additional PDF Test: PS209287-PS209295

The file `/Users/alexnewell/Downloads/9 ORDERS 11 PAGES - PS209287 - PS209295.pdf` was tested on 2026-07-11 with:

```bash
TMPDIR=/private/tmp npm run verify:garland-teamship -- \
  --pdf "/Users/alexnewell/Downloads/9 ORDERS 11 PAGES - PS209287 - PS209295.pdf" \
  --pdf-only \
  --json
```

Extraction result:

- `orderCount` was `9`.
- PS209287 / SR803322 was grouped as one order across pages `[1, 2]`.
- PS209288 / SR807926 was grouped as one order across pages `[3, 4]`.
- The remaining seven orders were single-page orders.

Parsed orders:

| PS | SR | PDF pages | Ship via | Ship to | City/state | PO |
| --- | --- | --- | --- | --- | --- | --- |
| PS209287 | SR803322 | 1, 2 | SURETRACK STANDARD | NELLA VANCOUVER | VANCOUVER, BC | P67051 |
| PS209288 | SR807926 | 3, 4 | SURETRACK STANDARD | RUSSELL HENDRIX EDMONTON | EDMONTON, AB | 00523506 |
| PS209289 | SR809243 | 5 | UPS CD STD | DAIRY QUEEN #72196 JD TREATS LTD | ASSINIBOIA, SK | JAY PATEL |
| PS209290 | SR807832 | 6 | UPS | N WASSERSTROM | COLUMBUS, OH | OP00033817 |
| PS209291 | SR807932 | 7 | SURETRACK STANDARD | JIM MAN LEE STORE LTD. | LITTLE FORT, BC | P68477 |
| PS209292 | SR807978 | 8 | SPEEDY | CENTRE DE DISTRIBUTION #2 DOYON DESP | LONGUEUIL, QC | 148027 |
| PS209293 | SR808217 | 9 | SPEEDY | CENTRE DE DISTRIBUTION #2 DOYON DESP | LONGUEUIL, QC | 148019 |
| PS209294 | SR809250 | 10 | MIDLAND | THE LITTLE PIZZA HOUSE | GRAND-SAULT, NB | 0000037690 |
| PS209295 | SR807975 | 11 | SPEEDY | TZANET QUEBEC | QUEBEC, QC | 83652 |

Live Teamship check:

- The Teamship search bar located all nine SRs after resetting the grid state first.
- Required search prep: open `Shipping Orders`, click `All`, click `Clear All Filters`, leave the saved view as `Charlotte bulk view (Default)`, then search the full SR value such as `SR803322`.
- Searching can fail or return stale/no rows if the grid is still on `Complete`, has a column filter active, or the previous search has not been cleared.
- Once the row appears, the Teamship order number is the `#` value in the first column. Use the direct detail route `https://members.fulfillit.io/ship-inventories/{orderId}` for read-only detail checks.

Teamship SR search results for this file:

| PS | SR | Teamship order | Search result notes |
| --- | --- | --- | --- |
| PS209287 | SR803322 | 27808 | SURETRACK STANDARD, PO P67051, 5 items. |
| PS209288 | SR807926 | 27809 | SURETRACK STANDARD, PO 00523506, 3 items. |
| PS209289 | SR809243 | 27810 | UPS CD STD, PO JAY PATEL, 4 items. A second row, `28235`, also exists for the same SR with 1 item and a later pickup/ship date; do not choose the first search result blindly. |
| PS209290 | SR807832 | 27811 | UPS, PO OP00033817, 1 item. |
| PS209291 | SR807932 | 27812 | SURETRACK STANDARD, PO P68477, 3 items. |
| PS209292 | SR807978 | 27814 | SPEEDY, PO 148027, 1 item. |
| PS209293 | SR808217 | 27815 | SPEEDY, PO 148019, 1 item. |
| PS209294 | SR809250 | 27816 | MIDLAND, PO 0000037690, 1 item. |
| PS209295 | SR807975 | 27817 | SPEEDY, PO 83652, 1 item. |

If a search returns multiple rows for the same SR, select the matching Teamship row by carrier, PO, item count, customer, and pickup/ship date before comparing detail fields.

## Teamship UI Field Mapping

Teamship detail pages expose the reviewed shipping-order data in two places:

- A hidden `shipInventoryData` JSON payload on the detail page.
- Visible/editable form controls such as `ship_first_name`, `ship_address_1`, `amazon_shipment_id1`, `carrier_value`, `poNumber`, `edi_field_1`, `edi_field_2`, `edi_field_3`, and `edi_field_4`.

Important mapping:

| Garland PDF field | Teamship field(s) |
| --- | --- |
| SR / shipment ID | `shipment_id`, `amazon_shipment_id1`, `edi_field_1` |
| PS number | `edi_field_2`, usually `PS######-SR######` |
| Ship-to name | `ship_first_name` plus optional `ship_last_name` |
| Ship-to address | `ship_address_1` |
| Ship-to city | `ship_city` |
| Ship-to province/state | `ship_state` |
| Ship-to postal/ZIP | `ship_zip` |
| Ship-to country | `ship_country` |
| Carrier / ship via | `carrier`, `carrier_value` |
| Ship-to PO | `po_number`, `poNumber` |
| Freight terms | `edi_field_3`, custom labels such as `Freight Terms Code`, or UI-style keys such as `freight_terms_code` |
| Shipping instructions | `edi_field_4`, `shipping_instructions`, custom labels such as `Special Instructions`, or UI-style keys such as `special_instructions` |
| SKU / serial | `pallets[].commodity`, nested item/product serial fields, or visible strings like `SKU: E1SGHMV6XHU3US, SN: 2604816191908` |

Do not rely only on visible page text. Some values are form input values or hidden JSON values and may not appear in `innerText`.

Mapping note from SR808478 testing:

- Teamship can display values in UI/custom-label fields even when the older API aliases are blank. The reviewer should check custom field labels and UI-style keys before marking a PDF value missing.
- `Freight Terms Code` maps to the Garland PDF freight terms value, for example `PPADD-CD`.
- `Special Instructions` maps to the Garland PDF shipping instructions.
- Item serials may appear under nested item/product fields or commodity text, not only under the typed `items` array.
- Daily synced Teamship orders are useful for the work queue and `No PDF` detection, but a review run should fetch fresh Teamship detail for uploaded SRs before comparing serials. Otherwise an older cached raw payload can make visible Teamship serials look missing in Newl Apps.

## Stage 2 Pallet Entry Findings

The Teamship shipping-order detail route is `https://members.fulfillit.io/ship-inventories/{orderId}`. The grid's order link may open the picking workflow instead, so use the direct detail route for reviewing or automating pallet fields.

Garland provided a freight-dimension workbook named `FREIGHT DIMS - NEWLS (version 1) (version 1).xlsb`. The app normalizes the `DIMS` and `BEV-AIR` sheets into a checked-in reference directory with these fields: SKU/model, product type, length inches, width inches, height inches, and weight pounds. The Teamship Review page combines this Garland reference data with observed Teamship pallet rows and shows SKU dimension recommendations inside each expanded shipment row. The current review run can also export a SKU dimension directory CSV.

UPS exception: for Garland UPS orders, always enter `1 x 1 x 1` and `1 lbs` for dimensions/weight regardless of SKU, Garland reference-sheet data, or observed SKU history. The Teamship Review dimension recommendation should show this as a high-confidence `UPS rule` source and suppress SKU-specific alternatives for that UPS order.

Learning rule: each manual or due Teamship sync records valid non-UPS pallet dimension rows into Newl Apps' tenant-scoped `GarlandProductDimensionObservation` directory. The app ignores placeholders such as `1 x 1 x 1`, zero height/weight, missing dimensions, and all UPS rows. Teamship Review then shows these historical observations as `Teamship learned` recommendations before falling back to the static Garland reference sheet. For now, the learning path is manual-sync friendly; if Newl upgrades Vercel cron later, the same sync path can run daily without changing the directory model.

Pallet data is stored in hidden `shipInventoryData.pallets[]` and rendered as indexed visible fields:

| Teamship data field | Visible input naming pattern | Notes |
| --- | --- | --- |
| `pallets_count` | `pallets_count` | Hidden count of pallet rows. |
| `pallets[index].quantity` | `pallet_1`, `pallet_2`, etc. | Visible label is No. of Pallets. |
| `pallets[index].length` | `pallet_1_length` | Dimension is inches. |
| `pallets[index].width` | `pallet_1_width` | Dimension is inches. |
| `pallets[index].height` | `pallet_1_height` | Dimension is inches. |
| `pallets[index].weight` | `pallet_1_weight` | Weight value. |
| `pallets[index].weight_unit` | `pallet_1_weight_unit` | Existing Garland examples use `lbs`. |
| `pallets[index].commodity` | `pallet_1_commodity` | Free-text commodity field used for SKU/serial details. |

Observed commodity formats from existing live Garland Teamship orders:

- Serialized single unit: `SKU: E1SGHMV6XHU3US, SN: 2604816191908`
- Non-serialized quantity: `SKU: 8030445 QTY: 4`
- Multiple serials should be written as separate commodity/comment lines, for example `SKU: GTBG36-NR36-5001 SN: 2605891101919` and `SKU: GTBG36-NR36-5001 SN: 2606891101462`.

Observed pallet examples:

| Teamship order | SR | Pallet rows | Notes |
| --- | --- | --- | --- |
| 30202 | SR808478 | `1 x 1 x 1`, `1 lbs`, `SKU: E1SGHMV6XHU3US, SN: 2604816191908` | Placeholder dimensions/weight were used. |
| 30206 | SR810387 | `54 x 30 x 40`, `441 lbs`, `SKU: GTGG48-GT48M-5016, SN: 2606891100446` | Real dimensions/weight were used. |
| 30208 | SR810386 | quantity `2`, `48 x 40 x 0`, `0 lbs`, `SKU: GTBG36-NR36-5001, SN: 2605891101919, 2606891101462` | Existing data groups two serials into one pallet row. |
| 30209 | SR810154 | Three pallet rows | Two non-serialized QTY rows use `1 x 1 x 1`, `1 lbs`; the serialized unit uses `41 x 49 x 79`, `880 lbs`. |
| 30210 | SR809212 | `35 x 25 x 33`, `180 lbs`, `SKU: X16SBMV6DFL1CLUS, SN: 2604816192633` | Real dimensions/weight were used. |

Stage 2 implication:

- The planned automation should be explicit about whether serialized units are always split into separate pallet rows. Existing Teamship data sometimes groups multiple serials for the same SKU into one pallet row with `quantity: 2`.
- Do not infer valid dimensions or weights from placeholders such as `1 x 1 x 1`, `1 lbs`, `0 height`, or `0 weight`. Those should be treated as missing/incomplete pallet data unless the provided Stage 2 dimension list says otherwise.
- For non-serialized items, use `SKU: <sku> QTY: <quantity>` in the commodity string instead of `SN:`.
- If multiple pallet rows are required, create or update the indexed field set consistently: `pallet_2`, `pallet_2_length`, `pallet_2_width`, `pallet_2_height`, `pallet_2_weight`, `pallet_2_weight_unit`, and `pallet_2_commodity`.

## Stage 2 Dry-Run Contract

Newl Apps remains the control tower. The VM worker should not decide what to update independently; it should execute structured, approved Newl Apps instructions. The first safe contract is the Phase 2 dry-run planner:

```bash
TEAMSHIP_EMAIL="..." TEAMSHIP_PASSWORD="..." npm run verify:garland-teamship-phase2 -- --pdf "/path/to/garland-orders.pdf" --shipment-date YYYY-MM-DD --json
```

The command reads the Garland PDF, fetches matching Teamship shipping orders read-only, builds the structured update payload, validates it, and prints JSON evidence. It must not call Teamship update endpoints or click/save in the Teamship UI. The payload always includes `mode: "DRY_RUN"`, `dryRun: true`, and `wouldUpdateTeamship: false`.

Dry-run payload rules:

- Matched PDF + Teamship orders can become `READY` only when every PDF item has a valid dimension/weight source and valid commodity text.
- Missing Teamship, pending Teamship, no-PDF, and already-reviewed rows are `SKIPPED`.
- Missing SKU dimensions block the dimension/weight update with a validation issue instead of guessing, but they do not block the commodity/comment plan.
- Planned field updates are limited to mapped review fields for now: `po_number -> poNumber`, `freight_terms -> edi_field_3`, `carrier -> carrier_value`, and `shipping_instructions -> edi_field_4`.
- Planned pallet rows use the documented Teamship field names, including `pallets_count`, `pallet_1_length`, `pallet_1_weight`, and `pallet_1_commodity`.
- Serialized items use one commodity/comment line per serial: `SKU: <sku> SN: <serial>`.
- Non-serialized items use commodity text `SKU: <sku> QTY: <quantity>`.
- UPS orders use the UPS rule dimensions: `1 x 1 x 1`, `1 lbs`.

The VM worker should first pass this CLI validation on the server before any browser automation or API update path is enabled. Later, the same payload shape should be stored in `TeamshipUpdateJob` / `TeamshipUpdateOrder` / `TeamshipUpdateField` records with admin approval and evidence capture.

## Stage 2 Production UI And Agent Contract

Newl Apps now has the production control-tower layer for Phase 2:

- Teamship credentials continue to be stored in tenant Settings under Teamship WMS. The encrypted password is used by Newl Apps for read-only verification/rescans; the VM agent should authenticate to Newl Apps with the ingestion/agent token and execute only approved update jobs.
- Users can select reviewed shipments in the Teamship Review workspace and create a Phase 2 update draft.
- Update jobs persist as `TeamshipUpdateJob` / `TeamshipUpdateOrder` records with statuses such as `DRAFT`, `NEEDS_REVIEW`, `APPROVED`, `RUNNING`, `SUCCESS`, `FAILED`, and `CANCELLED`.
- Drafts with blocked dimension/weight recommendations cannot be approved for the agent. Commodity/comment rows are still planned, but placeholder dimensions are not allowed.
- The VM agent claims approved jobs through `POST /api/shipment-documents/teamship-review/update-jobs/agent/next` using the ingestion bearer token or `x-newl-ingestion-key`. The claim response includes the tenant Teamship credentials from Settings so the worker does not need a separate hardcoded Teamship username/password.
- The VM agent reports completion through `PATCH /api/shipment-documents/teamship-review/update-jobs/agent/:jobId` with `SUCCESS`, `FAILED`, or `NEEDS_REVIEW` plus evidence payload.
- When the agent reports `SUCCESS` or `NEEDS_REVIEW`, Newl Apps automatically performs a Teamship rescan using the stored PDF order snapshot and tenant Teamship credentials, then stores the verification response on the job. `NEEDS_REVIEW` is included because partial live updates may successfully change some orders while another order fails.
- Users can also manually rescan a Phase 2 job from the UI, and can force a page-level Teamship rescan from the main review controls so already-reviewed SRs are checked again.

The VM worker implementation supports both dry-run evidence and guarded live API execution:

```bash
NEWL_APPS_BASE_URL="https://newl-apps.vercel.app" \
NEWL_AGENT_TOKEN="..." \
NEWL_AGENT_ID="teamship-vm-agent" \
TEAMSHIP_AGENT_MODE="dry-run" \
TEAMSHIP_AGENT_LOOP="true" \
TEAMSHIP_AGENT_INTERVAL_MS="30000" \
npm run worker:teamship-phase2
```

The worker claims approved jobs, confirms Teamship credentials were supplied from Settings, converts the approved `executionPayload` into execution evidence, reports `SUCCESS`, `NEEDS_REVIEW`, or `FAILED`, and lets Newl Apps automatically rescan Teamship after `SUCCESS` or `NEEDS_REVIEW` completion. In `dry-run` mode it does not call Teamship update endpoints, click save, or write to Teamship.

For live execution, two approvals are required:

- The user must create the update draft in `Live Teamship update` mode and approve it in Newl Apps.
- The VM worker must be started with `TEAMSHIP_AGENT_MODE=live-api` and `TEAMSHIP_ALLOW_LIVE_UPDATES=true`.

```bash
NEWL_APPS_BASE_URL="https://newl-apps.vercel.app" \
NEWL_AGENT_TOKEN="..." \
NEWL_AGENT_ID="teamship-vm-agent" \
TEAMSHIP_AGENT_MODE="live-api" \
TEAMSHIP_ALLOW_LIVE_UPDATES="true" \
TEAMSHIP_LIVE_ALLOWLIST_SR_NUMBERS="SR808478" \
TEAMSHIP_AGENT_LOOP="true" \
npm run worker:teamship-phase2
```

Live mode logs into Teamship using the tenant Settings credentials, submits the approved order-level fields and pallet rows to `/v1/ship-inventories/:id`, reports evidence back to Newl Apps, and triggers the automatic Teamship rescan. The worker blocks live updates before Teamship login unless every READY SR in the job is explicitly listed in `TEAMSHIP_LIVE_ALLOWLIST_SR_NUMBERS` or passed with `--allow-sr`. Keep `MAX_CONCURRENCY=1` operationally on the VM, and initially release one field group at a time with allowlisted orders: commodity/comment first, then pallet dimensions/weight, then mapped order-level fields.

If any individual Teamship order update fails, the worker must preserve the per-order evidence and report the job as `NEEDS_REVIEW` instead of discarding the partial result. Successful rows stay traceable as updated evidence, failed rows show the Teamship/API error, and Newl Apps immediately rescans Teamship so the Phase 2 panel has post-agent verification evidence. The CSR/admin can also rescan or correct manually from the Phase 2 update jobs panel.

`NEEDS_REVIEW` jobs must not be re-approved for the agent because the stored execution plan may include rows that already succeeded. After review, rescan Teamship details or create a new update draft for the exact follow-up SRs.

Agent endpoint examples:

```bash
curl -X POST "$NEWL_APPS_BASE_URL/api/shipment-documents/teamship-review/update-jobs/agent/next" \
  -H "Authorization: Bearer $NEWL_AGENT_TOKEN" \
  -H "x-newl-agent-id: teamship-vm-agent"

curl -X PATCH "$NEWL_APPS_BASE_URL/api/shipment-documents/teamship-review/update-jobs/agent/$JOB_ID" \
  -H "Authorization: Bearer $NEWL_AGENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"status":"SUCCESS","result":{"dryRun":true,"screenshots":[],"notes":"No live save performed."}}'
```

Server dry-run evidence captured July 12, 2026 on the Tailscale VM (`openclaw@100.120.250.105`) after PR #162 was merged to `main`:

- Branch tested: `main` at `204a8a3`.
- Input PDF: `/home/openclaw/newl-apps/phase2-dry-run-inputs/9 ORDERS 11 PAGES - PS209287 - PS209295.pdf`.
- Clean JSON artifact: `/home/openclaw/newl-apps/phase2-dry-run-output/live-dry-run-2026-07-12-main.json`.
- Result: 9 PDF orders extracted, 9 Teamship orders fetched read-only, `dryRun: true`, `wouldUpdateTeamship: false`.
- Summary: 2 ready orders, 7 blocked orders, 0 skipped orders, 19 planned pallet rows, 0 planned mapped field updates.
- The 2 ready orders were UPS shipments using the UPS `1 x 1 x 1`, `1 lbs` rule.
- The 7 blocked orders were non-UPS shipments missing usable SKU dimension/weight recommendations, which should remain `Needs Review` for dimension/weight until the SKU directory has trusted dimensions.
- Even blocked orders still produced commodity/comment fields, for example `SKU: MCO-ED-10M-5004 SN: 2605891102181` and `SKU: MCO-ED-10M-5004 SN: 2605891102182` on separate lines, without writing placeholder dimensions.

## Teamship Detail Evidence

The authenticated Teamship UI confirmed these current detail-page order IDs for the sample:

| Teamship order | SR | PS | Key matched fields |
| --- | --- | --- | --- |
| 30202 | SR808478 | PS210206 | MIDLAND, PO 0000037656, J.R. MAHONEY LTD., SYDNEY NS, commodity SKU/SN |
| 30203 | SR795656 | PS210207 | SPEEDY, PO 6038, CHIPOTLE #5520, MILTON ON, commodity SKU/SN |
| 30204 | SR808173 | PS210208 | UPS CD STD, PO OP00033958, N WASSERSTROM, COLUMBUS OH, commodity SKU/SN |
| 30205 | SR809846 | PS210209 | SPEEDY, PO 148856, DOYON, LONGUEUIL QC, commodity SKU/SN |
| 30206 | SR810387 | PS210211 | P/U BARRIE EQUIP, PO 2026BES8129, BARRIE EQUIPMENT SALES, BARRIE ON, commodity SKU/SN |
| 30207 | SR811920 | PS210212 | UPS CD STD, PO 15378, STOP REST EQUIP & SUPPL, KITCHENER ON, commodity SKU/QTY |
| 30208 | SR810386 | PS210213 | SPEEDY, PO 84269, LES ENTREPR TZANET INC, MONTREAL QC, commodity SKU/SNs |
| 30209 | SR810154 | PS210216 | SURETRACK STANDARD, PO PO374982, VANCOUVER AIRPORT HILTON, RICHMOND BC, commodities |
| 30210 | SR809212 | PS210217 | SURETRACK STANDARD, PO 200242, GEANEL RESTAURANT SUPPLIES L, SASKATOON SK, commodity SKU/SN |

Current alert-backed sample orders:

- SR811861 / PS210210
- SR812055 / PS210214
- SR811494 / PS210215

Those three were present in the PDF sample but were not confirmed in the current Teamship UI detail evidence because they were listed in the hourly Teamship Alert Digest as not pushed into Teamship yet. Treat them as amber pending Teamship creation when the digest is pasted into Newl Apps. Once stock/issues are fixed and Teamship creates the orders, they should move from amber to the normal green/red comparison path.

## Alert Digest Handling

Teamship can send hourly alert emails for Garland shipping orders that were not created in Teamship yet. Example subject/body pattern:

```text
Teamship Alert Digest

Shipping Orders — Out of Stock (4)

Order SR811861

Item Number    Description    Requested Qty    Serial Number
C-CLEAN-FORTE  C-CLEAN STRONG CLEANING STRENGTH (2) 10 LT CONT  1  N/A
TUBE KIT - MIXED  (1) Red Tube Kit, (1) Green Tube Kit  1  N/A
C-CARE-P  CONVOCARE (2) 10 LITER JUGS PRE MIXED - CCC202  1  N/A
```

Newl Apps should handle these cases this way:

- If the PDF contains the SR and Teamship contains the SR, compare fields normally.
- If the PDF contains the SR, Teamship does not contain the SR, and the alert digest contains the SR, mark the order amber `Pending Teamship`.
- If the PDF contains the SR, Teamship does not contain the SR, and no alert digest contains the SR, mark the order red `Missing Teamship`.
- The amber state is not a data discrepancy. It means the CSR should wait for Teamship to create the order after the stock/order issue is fixed.
- When a later Teamship pull finds the order, the same PDF/SR should leave the amber path and be compared normally.

## Teamship Grid Notes

- Use the `All` tab in Shipping Orders before searching.
- The grid may show a saved view such as `Charlotte bulk view (Default)`. That view can still search Garland SRs, but click `Clear All Filters` first if search results look wrong.
- Search by the full SR value, including the `SR` prefix. Example: `SR809212` returns Teamship order `#30210` once the grid is reset.
- Do not rely on searching just the Teamship order number, PS number, PO, or customer name as the primary lookup. Those can match unrelated rows or fail depending on the current view/filter state.
- If a known SR does not return a row, reset this exact sequence before concluding it is missing: `Shipping Orders` -> `All` -> `Clear All Filters` -> clear the search box -> search full `SR######`.
- The Teamship grid can be slow and sometimes returns stale or unexpected visible text after search changes. Detail pages are more reliable once the order ID is known.
- The live All tab showed approximately `1 of 670 pages (10,043 items)` during testing. The Newl API fetcher therefore uses a deeper default scan than the original 12 pages.

## Newl App Runtime Notes

- Production showed the Teamship Review page and Garland navigation correctly.
- Production Teamship access should use tenant Settings under Teamship WMS. Do not rely on `TEAMSHIP_EMAIL` / `TEAMSHIP_PASSWORD` Vercel variables for normal app behavior.
- The one-time credential fallback is only for manual testing and is not saved.
- The cron-ready route exists, but the 15-minute schedule is intentionally not enabled yet. Manual pull is the operating path until Vercel Pro or an external scheduler is chosen.

## Safe Testing Rules

- Browser checks should be read-only: open list/detail pages and inspect fields only.
- Do not click Teamship `Save`, `Delete Order`, `Start Picking`, print buttons, upload fields, or status controls during Stage 1 testing.
- If scraping the browser for fields, do not persist CSRF tokens, session values, hidden auth values, or broad user/warehouse JSON. Only record the business fields listed in this document.
