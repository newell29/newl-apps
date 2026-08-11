# Historical Shipments Location Strategy Sample Guide

This file is for Warehouse Location Strategy validation only. Do not use it for live 7L rating or Network Design rate testing.

Warehouse Location Strategy uses saved shipment geography and local reference coordinates. It does not call 7L, live carrier APIs, external geocoding, or road-routing services.

## File

`historical-shipments-location-strategy-fixture.csv`

Local path:

`docs/modules/supply-chain-design/fixtures/warehouse-location-strategy/historical-shipments-location-strategy-fixture.csv`

## Columns To Map

- `record_type` -> `Record Type`
- `shipment_id` -> `Shipment / Order Reference`
- `shipment_date` -> `Shipment Date`
- `origin_facility_id` -> `Origin Facility ID`
- `destination_id` -> `Destination Customer / Group`
- `postal_or_region_code` -> `Destination ZIP / Postal Code`
- `destination_label` -> `Destination City / Region`
- `country` -> `Destination Country`
- `state_province` -> `State/Province`
- `shipment_quantity` -> `Shipments`
- `pallets` -> `Pallets`
- `units` -> `Units`
- `weight` -> `Weight`
- `weight_unit` -> `Weight Unit`
- `length` -> `Length`
- `width` -> `Width`
- `height` -> `Height`
- `dimension_unit` -> `Dimension Unit`
- `hazardous_materials` -> `Hazardous Materials`
- `mode` -> `Transportation Mode`
- `transportation_cost` -> `Transportation Cost`
- `service_days` -> `Transit Days`
- `service_level` -> `Service Level`
- `item_id` -> `SKU / Item`
- `currency` -> `Currency`

The checked-in headers follow the customer-facing Historical Shipments upload contract and should auto-map as Historical Shipments.

## Manual Upload

Upload `historical-shipments-location-strategy-fixture.csv` under Project Data as Historical Shipments. It should auto-map from the checked-in headers; no live rating or Network Design action should be started for this validation file.

Confirm combined U.S. and Canada spend weighting is blocked because the sample intentionally includes both USD and CAD.

## Sample Coverage

The sample contains 105 shipment/activity rows, 61 unique destination postal or region codes, repeated destinations, Individual Shipment rows, Aggregated Activity rows, LTL, Parcel, Other, USD rows, CAD rows, high-volume aggregated lanes, and small remote outliers.

Covered geographic areas:

- Southern California
- Pacific Northwest
- Texas
- Midwest / Chicago
- Southeast / Atlanta
- Northeast / New York-New Jersey
- Greater Toronto Area
- Montreal / Quebec
- Calgary / Edmonton
- Vancouver
- Atlantic Canada
- remote low-volume outliers

## Designed Scenario Evidence

- `Shipments represented` emphasizes shipment-frequency clusters. In the current sample, Southeast / Atlanta, Texas, Northeast, Midwest / Chicago, and Southern California have the largest U.S. shipment counts.
- `Pallets represented` emphasizes pallet-heavy rows. Southern California has the highest pallet total.
- `Weight represented` emphasizes heavy-freight clusters. Southern California has the highest normalized weight total.
- `Units represented` emphasizes rows with larger unit counts. Southeast / Atlanta has the highest units total.
- `Historical transportation spend` emphasizes uploaded spend within a compatible single-currency scope. Southern California has the highest U.S. USD spend, and Greater Toronto Area has the highest Canadian CAD spend.

Useful reconciliation rows include `LS-SE-*` for Southeast density, `LS-TX-*` for Texas demand, `LS-WC-*` and `LS-W-*` for Southern California and West Coast demand, `LS-CA-*` for Canadian province-level handling, and `LS-LOW-*` for low-volume satellite destinations.

## Manual Validation Matrix

| Scenario | Selected file | Weighting method | Country scope | Maximum regions | Expected dominant geographic influence | Expected qualitative center movement | Expected region-share behavior | Spend weighting | Map checks | Assignment CSV checks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `historical-shipments-location-strategy-fixture.csv` | Shipments represented | United States only | 3 | Southeast / Atlanta, Texas, Northeast, Midwest / Chicago, Southern California | Centers should move toward frequent U.S. destination clusters | Multiple regions should carry meaningful demand share | Should run | Destination size reflects shipments; radius labels use straight-line miles | Shipments represented column reconciles to U.S. rows |
| 2 | `historical-shipments-location-strategy-fixture.csv` | Pallets represented | United States only | 3 | Southern California pallet volume | Western center should be more influenced by Southern California than shipment-only weighting | Region shares should differ from shipment weighting | Should run | Southern California destinations should appear visually larger | Pallets represented column reconciles to U.S. pallet totals |
| 3 | `historical-shipments-location-strategy-fixture.csv` | Weight represented | United States only | 3 | Southern California normalized weight | Western center should remain strongly influenced by heavy West Coast freight | Region shares should differ from shipment and pallet weighting | Should run | Weight-sized destinations should emphasize heavy-freight clusters | Weight represented column uses normalized pounds |
| 4 | `historical-shipments-location-strategy-fixture.csv` | Units represented | United States only | 3 | Southeast / Atlanta unit volume | Eastern/Southeastern center should move toward high-unit demand | Region shares should differ from pallet and weight weighting | Should run | Destination size reflects units represented | Units represented column reconciles to U.S. unit totals |
| 5 | `historical-shipments-location-strategy-fixture.csv` | Historical transportation spend | United States only | 3 | Southern California USD spend | Western cost-weighted influence should increase | Regions should reflect USD spend only | Should run | Map should show only U.S. eligible rows | Assignment CSV spend values reconcile to USD-only rows |
| 6 | `historical-shipments-location-strategy-fixture.csv` | Shipments represented | Canada only | 3 | Greater Toronto Area, Vancouver, Montreal / Quebec | Canadian centers use approved broad province and market coordinates | Weak small regions may be available but not recommended | Should run | Canadian destinations may be broad market points | Assignment CSV should show Canadian broad-market coordinate precision |
| 7 | `historical-shipments-location-strategy-fixture.csv` | Historical transportation spend | Canada only | 3 | Greater Toronto Area CAD spend | Canadian spend centers should be influenced by Ontario and western Canada | Region shares should be CAD-only | Should run | Map should show only Canada eligible rows | Assignment CSV spend values reconcile to CAD-only rows |
| 8 | `historical-shipments-location-strategy-fixture.csv` | Shipments represented | Combined U.S. and Canada network | 3 | Larger U.S. clusters plus Ontario/Quebec/West Canada | Centers should balance all resolved U.S. and Canadian demand | Region shares should sum to 100% of combined selected weight | Should run | Mixed-country shipment weighting should display normally | Assignment CSV should include both US and CA rows |
| 9 | `historical-shipments-location-strategy-fixture.csv` | Historical transportation spend | Combined U.S. and Canada network | 3 | Not applicable | Not applicable | Not applicable | Expected blocked because USD and CAD are mixed | No successful report should be created | Error should mention compatible currency |
| 10 | `historical-shipments-location-strategy-fixture.csv` | Shipments represented | Separate U.S. and Canada strategies | 3 | Separate U.S. and Canadian clusters | U.S. and Canadian strategies should be calculated independently | Each country strategy has its own region-share basis | Should run | Report should include U.S. and Canadian solution groups | Assignment CSV should preserve country-specific region counts |
| 11 | `historical-shipments-location-strategy-fixture.csv` | Shipments represented | Combined U.S. and Canada network | 1 | Overall combined network center | Single center should sit between the major combined demand clusters | One region should hold 100% of selected demand | Should run | One dashed radius around the calculated center | All eligible rows assigned to Region 1 |
| 12 | `historical-shipments-location-strategy-fixture.csv` | Shipments represented | Combined U.S. and Canada network | 2 | Eastern/central demand and western demand | Two centers should split broad eastern and western geography | Both regions should have meaningful demand share | Should run | Two region-colored destination groups and radii | Assignment CSV should contain two assigned region values |
| 13 | `historical-shipments-location-strategy-fixture.csv` | Shipments represented | Combined U.S. and Canada network | 3 | Eastern, western, and central/southern demand | Three centers should separate major demand concentrations more clearly | All recommended regions should meet the configured share threshold | Should run | Three region colors may appear when applicable | Assignment CSV should contain three assigned region values |

Do not promise exact final cities unless the result is verified against the checked-in logistics-market catalogue in the current branch. The recommended practical market is the nearest supported warehouse market to the calculated center, not an invented city.

## Interpretation

Location Strategy assigns each historical destination to a proposed geographic service region. It does not allocate SKUs, calculate inventory quantities, call 7L, or estimate live freight rates.

The model calculates geographic centers that minimize weighted straight-line distance from historical delivery destinations. The named warehouse market is the nearest supported practical logistics market to each calculated center.

Distances are straight-line Haversine distances, not road miles or drive time.
