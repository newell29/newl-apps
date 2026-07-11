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
- The grid may show a saved view such as `Charlotte bulk view (Default)`. Clear filters if search results look wrong.
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
