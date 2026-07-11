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

- Manual Teamship daily pull is available from the page and calls `/api/shipment-documents/teamship-review/daily-orders` for the selected date.
- The manual daily pull returns the Garland Teamship order list/count for review visibility; it does not mutate Teamship or save a local cache yet.
- The PDF review run uses the uploaded Garland PDF as the source of expected SRs, then calls Teamship read-only list/detail APIs to fetch matching shipping orders by SR/shipment ID.
- The cron-ready GET route exists for the future 15-minute sync, requires `TEAMSHIP_DAILY_SYNC_SECRET`, and is intentionally not scheduled in the repo yet.

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
| Freight terms | `edi_field_3` |
| Shipping instructions | `edi_field_4` |
| SKU / serial | `pallets[].commodity`, visible as strings like `SKU: E1SGHMV6XHU3US, SN: 2604816191908` |

Do not rely only on visible page text. Some values are form input values or hidden JSON values and may not appear in `innerText`.

## Stage 2 Pallet Entry Findings

The Teamship shipping-order detail route is `https://members.fulfillit.io/ship-inventories/{orderId}`. The grid's order link may open the picking workflow instead, so use the direct detail route for reviewing or automating pallet fields.

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

Observed commodity formats from live Garland Teamship orders:

- Serialized single unit: `SKU: E1SGHMV6XHU3US, SN: 2604816191908`
- Non-serialized quantity: `SKU: 8030445, QTY: 4`
- Multiple serials in one row: `SKU: GTBG36-NR36-5001, SN: 2605891101919, 2606891101462`

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
- For non-serialized items, use `QTY: <quantity>` in the commodity string instead of `SN:`.
- If multiple pallet rows are required, create or update the indexed field set consistently: `pallet_2`, `pallet_2_length`, `pallet_2_width`, `pallet_2_height`, `pallet_2_weight`, `pallet_2_weight_unit`, and `pallet_2_commodity`.

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
- Production also showed `TEAMSHIP_PASSWORD` missing, so server-side live pulls need that Vercel environment variable before the page can run without one-time manual credentials.
- The one-time credential fallback is only for manual testing and is not saved.
- The cron-ready route exists, but the 15-minute schedule is intentionally not enabled yet.

## Safe Testing Rules

- Browser checks should be read-only: open list/detail pages and inspect fields only.
- Do not click Teamship `Save`, `Delete Order`, `Start Picking`, print buttons, upload fields, or status controls during Stage 1 testing.
- If scraping the browser for fields, do not persist CSRF tokens, session values, hidden auth values, or broad user/warehouse JSON. Only record the business fields listed in this document.
