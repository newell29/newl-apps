# Supply Chain Design Studio Product Inventory

> Evidence status: code-backed cleanup inventory as of branch `f4`.

This inventory is organized model-first: model/tool -> data it uses -> calculation it performs -> result it produces.

## Model 01 - Current Network Baseline

- Proposed tab: Current Network Baseline.
- Business question: What does the current network look like, and what baseline cost can be observed from uploaded files?
- Buttons/modes: Run Current Network Baseline.
- Button classification: one current-state baseline run mode.
- Normal inputs: `current-facilities-and-costs-template.csv` and `historical-shipments-template.csv`.
- The canonical Historical Shipments sample represents one annual demand period; its Shipments values are represented annual shipment volume and are not annualized again by code.
- Candidate input for later models: `candidate-warehouses-and-costs-template.csv`.
- Legacy inputs still supported for existing projects and Model 02 dependency: `FACILITIES`, `SHIPMENTS`, optional `INVENTORY`, `FACILITY_COSTS`, `CUSTOMERS`.
- Fields read from the combined file: shipment/order reference, current facility ID/name/type, facility ZIP/postal code, pallet-position capacity, destination customer/group or ZIP/region, country, pallets/units/weight, transportation mode/cost, transit days, service level, optional SKU/item, inventory quantity/pallets/value, snapshot date, facility annual cost/category and currency.
- Fields retained for future analysis but not yet used directly in formulas: shipment date, facility ZIP/postal code, capacity unit, country, transportation mode, service level and SKU.
- Unnecessary prior requirement fixed: customers no longer need to split source data into separate facility, shipment, inventory and facility-cost files for normal Model 01 review.
- Calculation/result: facility and shipment counts, pallet/unit/weight totals when supplied, transportation cost totals, inventory quantity/value, facility and warehouse cost, observed cost, cost analysis, exceptions and combined facility summary.
- Primary user result: current network totals and facility summary.
- Collapsed support detail: row groupings, formulas, exceptions, benchmark-style audit details.
- Status: functional proof, not full Model 01.

### Model 01 Field Dictionary

| Template header | Mapping label | Definition | Unit | Example | Analysis level | Metric using it |
| --- | --- | --- | --- | --- | --- | --- |
| Record Type | Record Type | Individual Shipment or Aggregated Activity. Blank values are inferred where possible. | text | Aggregated Activity | Basic activity | Row meaning and calculation details |
| Shipment / Order Reference | Shipment / Order Reference | Customer shipment, order, invoice, or activity reference. Optional for aggregated rows. | text | ORD-1001 | Basic activity | Shipment/activity traceability |
| Shipment Date | Shipment Date | Date associated with the shipment/activity row. | date | 2026-01-15 | Future date analysis | Retained, not yet calculated |
| Current Facility ID | Origin Facility ID | Current origin facility, warehouse, or 3PL identifier. | text | TOR-01 | Basic activity | Facility count, shipment count by origin |
| Current Facility Name | Facility Name | Readable current facility or provider location name. | text | Toronto DC | Basic activity | Facility summary |
| Facility Type | Facility Type | Owned, Leased, Existing 3PL, or Other. | text | Existing 3PL | Basic activity context | Facility operating model display/context |
| Facility ZIP / Postal Code | ZIP / Postal Code | Current facility postal location. | text | 75201 | Future geography/capacity context | Retained, not yet calculated |
| Facility Capacity - Pallet Positions | Facility Capacity - Pallet Positions | Capacity stated in pallet positions. | pallet positions | 12000 | Capacity/utilization | Available only with compatible inventory/occupancy data |
| Destination Customer / Group | Destination Customer / Group | B2B customer/site, consumer ZIP group, or broader region label. | text | Customer A | Geographic and lane | Destination count, lane count |
| Destination ZIP / Postal Code | Destination ZIP / Postal Code | Destination ZIP/postal/region code used when no named destination key exists. | text | 10001 | Geographic and lane | Generated hidden destination group |
| Destination City / Region | Destination City / Region | Display label for the destination. | text | New York ZIP group | Geographic and lane | Customer/destination display |
| Country | Country | Country for destination/source context. | text | US | Future normalization | Retained, not yet normalized |
| Shipments | Shipments | Number of shipments represented by the row. Blank means one shipment. | shipments | 25 | Basic activity | Total shipments and shipment-weighted groupings |
| Pallets | Pallets | Total pallets represented by the row. | pallets | 25 | Volume | Total pallets and pallets per shipment |
| Units | Units | Total units represented by the row. | units | 450 | Volume | Total units and units per shipment |
| Weight | Weight | Total weight represented by the row. | weight | 12500 | Volume and LTL preparation | Total weight and weight per shipment |
| Weight Unit | Weight Unit | Unit for the Weight value. Required for LTL preparation when Weight is supplied. | lb or kg | lb | LTL preparation | Candidate LTL rate preparation |
| Length | Length | Representative per-shipment length. | length | 48 | LTL preparation | Candidate LTL rate preparation |
| Width | Width | Representative per-shipment width. | length | 40 | LTL preparation | Candidate LTL rate preparation |
| Height | Height | Representative per-shipment height. | length | 60 | LTL preparation | Candidate LTL rate preparation |
| Dimension Unit | Dimension Unit | Unit for Length, Width and Height. Required for LTL preparation when dimensions are supplied. | in or cm | in | LTL preparation | Candidate LTL rate preparation |
| Hazardous Materials | Hazardous Materials | Yes or No flag for hazardous material handling. Yes rows are held for additional hazmat details before rating. | text | No | LTL preparation | Candidate LTL rate preparation |
| Transportation Mode | Transportation Mode | Shipment mode. | text | LTL | Future mode analysis | Retained, not yet calculated |
| Transportation Cost | Transportation Cost | Observed shipment/activity transportation cost. | currency | 525 | Transportation-cost | Total transportation cost and cost by facility/lane |
| Transit Days | Service Days | Transit or service days. | days | 2 | Service | Service/transit detail |
| Service Level | Service Level | Service promise or class. | text | Standard | Future service analysis | Retained, not yet calculated |
| SKU / Item | Item ID | Optional item/SKU reference. | text | SKU-100 | Inventory context | Optional inventory grouping input |
| Inventory Quantity | Quantity | Inventory or occupancy quantity. | units | 120 | Capacity/utilization | Inventory quantity |
| Inventory Pallets | Quantity | Pallet occupancy quantity when unit inventory is unavailable. | pallets | 3 | Capacity/utilization | Inventory quantity proxy |
| Inventory Value | Inventory Value | Total inventory value for the row. | currency | 2400 | Inventory value | Converted to unit value for existing formula |
| Snapshot Date | Snapshot Date | Inventory snapshot date. | date | 2026-01-31 | Future inventory timing | Retained, not yet calculated |
| Current Facility ID | Current Facility ID | Facility identifier in the optional facility and warehouse cost file. | text | TOR-01 | Facility and warehouse cost | Facility and warehouse cost |
| Cost Category | Cost Category | Cost category in the optional facility and warehouse cost file. | text | Labour | Facility and warehouse cost | Cost by category |
| Cost Amount | Annual Cost | Actual paid facility, warehouse, or existing 3PL cost amount for the stated period. | currency | 450000 | Facility-cost | Facility and warehouse cost |
| Currency | Currency | Currency code. | text | USD | Future normalization | Retained, not yet converted |

### Current Network Baseline Mode Matrix

| Run mode | Tables read | Fields required to start | Conditional/optional fields read | Primary result |
| --- | --- | --- | --- | --- |
| Run Current Network Baseline | `CURRENT_NETWORK_ACTIVITY`, optional `FACILITY_COSTS`; legacy normalized files still supported | Current Facility ID, Current Facility Name | Record type, shipment/order reference, shipment quantity, destination customer/group or ZIP/region, pallets/units/weight, transportation cost, transit days, inventory quantity/value/pallets/snapshot; optional facility and warehouse cost supplement | Current network totals, observed costs and facility summary |

## Model 02 - Network Design

- Proposed tab: Network Design.
- Business question: What would happen if selected existing facilities are kept or closed and selected candidate facilities are opened?
- Buttons/modes: Create manual scenario; Run exact small-network optimizer.
- Button classification: the manual scenario and optimizer belong together as modes of the same network-design model because they use the same baseline, current facilities, customers, candidate facilities, lane costs, facility costs and capacity rules. The manual mode evaluates one chosen network; the optimizer enumerates candidate networks under the same proof contract.
- Required inputs: successful Model 01 baseline, `FACILITIES`, `SHIPMENTS`, `CUSTOMERS`, `CANDIDATE_FACILITIES`.
- Optional inputs: `SCENARIO_LANE_COSTS`, `FACILITY_COSTS`.
- Fields read: facility IDs/names/capacity; customer IDs/names/destination attributes; candidate IDs/names/fixed cost/capacity; shipment destination/origin and quantities; lane cost per shipment; facility annual operating cost.
- Fields displayed but not central to proof calculation: city/country labels and service fields support readable output but are not full validation constraints.
- Unnecessary default requirements: customer city/country remain required for the Model 02 mapping even though allocation primarily uses IDs and lane costs.
- Calculation/result: customer assignment to selected or optimized open facilities, proposed transportation cost, retained/opened facility cost, proposed observed cost, annual difference from Model 01, capacity evidence and diagnostics.
- Primary user result: selected/open network, assigned/unallocated customers and annual cost difference.
- Collapsed support detail: allocation rows, solver diagnostics, consistency checks and candidate alternatives.
- Status: functional proof for small networks; production optimizer deferred.

### Network Design Mode Matrix

| Run mode | Tables read | Fields required to start | Conditional/optional fields read | Primary result |
| --- | --- | --- | --- | --- |
| Manual scenario | successful Model 01 run, `FACILITIES`, `SHIPMENTS`, `CUSTOMERS`, `CANDIDATE_FACILITIES`, optional `SCENARIO_LANE_COSTS`, `FACILITY_COSTS` | Facility ID/name, Shipment ID/origin/demand ID, Customer ID/name, Candidate Facility ID/name/annual fixed cost | Capacity when enforcement is enabled; uploaded lane cost when available; facility operating cost | Evaluated open/closed network with assignments and annual cost difference |
| Exact small-network optimizer | same problem contract as manual scenario | same core fields plus optimizer controls from UI | Capacity when enforcement is enabled; mandatory/prohibited/open-count controls | Recommended proof network and ranked alternatives |

## Warehouse Location Strategy

- Internal current model/tool: 3PL Location Screening, study path `FIND_BEST_WAREHOUSE_REGION`.
- Proposed tab: Warehouse Location Strategy.
- Business question: Which broad warehouse region or pair of regions best screens against delivery demand by distance?
- Buttons/modes: Run 3PL study, locked to location strategy in this tab.
- Button classification: separate business tool from warehouse cost comparison. It screens regions by demand distance, not provider cost.
- Required inputs: `DEMAND_POINTS`.
- Optional/internal inputs: project-uploaded `LOGISTICS_MARKETS` and `CANADA_PROVINCE_MARKET_MAP` for benchmark/internal mode only. Normal projects use the internal Newl logistics-market catalogue.
- Fields read: demand ID, ZIP/postal or province code, country, annual shipments, optional state/province, optional uploaded coordinates as advanced override; internal market IDs/names/coordinates/eligibility.
- Fields displayed but not used as normal customer inputs: latitude/longitude are internal or advanced override only.
- Unnecessary default requirements fixed earlier: U.S. demand no longer requires city/state/coordinates.
- Calculation/result: ZIP/ZCTA or province coordinate resolution, weighted screening distance, one-region ranking, two-region ranking, allocations and exceptions.
- Primary user result: recommended one-region and two-region markets with weighted screening distance.
- Collapsed support detail: allocation rows, scoring lists, ZIP evidence, benchmark controls and exceptions.
- Status: functional proof using internal catalogue; commercial review still required.

### Warehouse Location Strategy Mode Matrix

| Run mode | Tables read | Fields required to start | Conditional/optional fields read | Primary result |
| --- | --- | --- | --- | --- |
| U.S. one-region/two-region | `DEMAND_POINTS`, internal Newl catalogue | Demand ID, Destination ZIP / Postal Code, Country, Annual Shipments | City/state labels when present; uploaded coordinates only remain engine-internal and are hidden from normal mapping | Recommended one-region and two-region markets by weighted screening distance |
| Canada | `DEMAND_POINTS`, internal or benchmark province mapping where enabled | Demand ID, Country, Annual Shipments, province/state when province-level resolution is needed | Approved province-market map in internal benchmark mode | Approved Canadian market allocation and distance summary |
| Mixed U.S./Canada | `DEMAND_POINTS`, internal catalogue, conditional Canada map | Row-level U.S. ZIP fields and Canadian province fields | Country-specific resolution evidence | Combined screening results with unresolved rows reported |

## Warehouse Cost Comparison

- Internal current model/tool: 3PL provider comparison, study path `COMPARE_KNOWN_WAREHOUSE_OPTIONS`.
- Proposed tab: Warehouse Cost Comparison.
- Business question: Which known uploaded warehouse/provider option has the lowest benchmark annual cost?
- Buttons/modes: Run 3PL study, locked to warehouse cost comparison in this tab.
- Button classification: separate business tool from location strategy. It compares provider cost inputs and cached rates, not market geography.
- Required inputs: `DEMAND_POINTS`, `PROVIDER_OPTIONS`, `SHIPMENT_PROFILES`, `OUTBOUND_RATE_CACHE`.
- Optional/internal inputs: `EXPECTED_PROVIDER_RESULTS` for benchmark controls only.
- Fields read: demand ID, annual shipments, annual pallets, shipment type; provider ID/name, warehouse location, monthly storage rate plus average stored pallets or direct annual storage cost, handling rates, monthly minimum, gateway/ocean/inland costs; shipment type/profile ID; exact cached cost per shipment and transit days.
- Fields displayed but not used: provider latitude/longitude are present in the benchmark file but not used by the cost calculation.
- Unnecessary default requirements fixed earlier: `warehouse_name` is optional and falls back to provider name; demand must include shipment type for this tool only.
- Calculation/result: warehouse cost, outbound transportation cost, inbound gateway/ocean/inland cost, total annual cost, rank and benchmark-control comparison.
- Primary user result: recommended provider and ranked annual cost table.
- Collapsed support detail: rate-match evidence, expected-result controls, formulas and exceptions.
- Status: beta proof; totals not yet commercially validated.

### Warehouse Cost Comparison Mode Matrix

| Run mode | Tables read | Fields required to start | Conditional/optional fields read | Primary result |
| --- | --- | --- | --- | --- |
| Controlled provider comparison | `DEMAND_POINTS`, `PROVIDER_OPTIONS`, `SHIPMENT_PROFILES`, `OUTBOUND_RATE_CACHE` | Demand ID, Annual Shipments, Annual Pallets, Shipment Type, Provider ID/name, Warehouse ZIP/City/State/Country, Shipment Type/mode, Provider ID + Demand ID + Shipment Type + Cost per Shipment | Storage Rate per Pallet per Month plus Average Stored Pallets, or Annual Storage Cost; handling rates, monthly minimum, gateway/ocean/inland cost, transit days, currency | Ranked provider options and lowest total annual cost |

## Shared Project Data

- Proposed tab: Project Data.
- Business question: Which files are uploaded, how are they mapped and which workflows use them?
- Current result: shared upload list now shows filename, mapped logical table, readiness status, model usage, upload date and cleanup guidance.
- Cleanup status: destructive delete and same-name replacement are not implemented in this pass because dependency-safe invalidation/versioning needs product confirmation.

## Run History

- Proposed tab: Run History.
- Business question: What has been run before, and where should I review or compare it?
- Current result: recent Model 01 runs, Model 02 scenarios, Model 02 comparison, and 3PL runs are grouped separately.
- Scenario names: Model 02 manual and optimizer scenario names are saved in the existing scenario `name` field and shown in scenario history. 3PL run names are saved inside result JSON as `studyName`; a separate database name column is deferred.

## Table-Type Inventory

| Table type | Normal visibility | Used by | Status |
| --- | --- | --- | --- |
| `FACILITIES` | Visible as Current Facilities | Model 01, Model 02 | Functional proof |
| `SHIPMENTS` | Visible as Historical Shipments | Model 01, Model 02 | Functional proof |
| `INVENTORY` | Visible as Inventory Snapshot | Model 01 | Optional proof input |
| `FACILITY_COSTS` | Visible as Facility and Warehouse Costs | Model 01, Model 02 | Optional proof input |
| `CUSTOMERS` | Visible as Customers | Model 02 | Functional proof input |
| `CANDIDATE_FACILITIES` | Visible as Candidate Facilities | Model 02 | Functional proof input |
| `SCENARIO_LANE_COSTS` | Visible as Scenario Lane Costs | Model 02 | Optional proof input |
| `DEMAND_POINTS` | Visible as Delivery Demand | Warehouse Location Strategy, Warehouse Cost Comparison | Functional proof input |
| `PROVIDER_OPTIONS` | Visible as Candidate Warehouse Options | Warehouse Cost Comparison | Beta proof input |
| `SHIPMENT_PROFILES` | Visible as Shipment Types | Warehouse Cost Comparison | Beta proof input |
| `OUTBOUND_RATE_CACHE` | Visible as Transportation Rates | Warehouse Cost Comparison | Beta proof input |
| `LOGISTICS_MARKETS` | Hidden from normal mapping | Internal benchmark/custom market testing | Internal-only |
| `CANADA_PROVINCE_MARKET_MAP` | Hidden from normal mapping | Internal Canadian benchmark mode | Internal-only |
| `STUDY_CONTROL` | Hidden from normal mapping | Benchmark/control files | Internal-only |
| `EXPECTED_PROVIDER_RESULTS` | Hidden from normal mapping | Benchmark expected-output controls | Internal-only |

## Important Field Mismatches

- `shipment_profile_id` is now labelled Shipment Type for normal users; it remains the canonical ID used to join demand to shipment profiles and cached rates.
- `monthly_storage_cost` is a rate, so the normal label is Storage Rate per Pallet per Month.
- `average_stored_pallets` is a visible beta input labelled Average Stored Pallets. It is required when rate-based storage is used; no default pallet quantity is assumed.
- `annual_storage_cost` is the direct annual storage alternative. When supplied, direct annual storage is used and the monthly rate calculation is not also applied.
- `receiving_cost_per_unit` and `outbound_handling_cost_per_unit` are handling rates, not total costs.
- `inbound_gateway_cost` currently maps to annual ocean-cost input in the benchmark; `other_annual_cost` maps to gateway-to-warehouse inland cost.
- Latitude/longitude remain engine-supported but are advanced-only in the mapping UI.
- U.S. ZIP resolution should be the normal remedy for missing coordinates; users should not be asked to create coordinates.

## Customer-Facing Template Structure

CSV remains the supported customer upload structure for this pass:

- Delivery Demand: Demand ID, Destination ZIP / Postal Code, Country, Annual Shipments, Annual Pallets when using warehouse cost comparison, Shipment Type when using warehouse cost comparison.
- Current Facilities and Warehouse Costs: Facility ID, Facility Name, Facility Type, Facility ZIP / Postal Code, optional annual facility or warehouse cost, pallet capacity, current inventory pallets/units/value, currency and notes.
- Historical Shipments: Record Type, Shipment / Order Reference, Shipment Date, Origin Facility ID, destination fields, shipment counts, volume measures, transportation cost, service fields, SKU / item and currency.
- Candidate Warehouses and Proposed Costs: Candidate Facility ID, Candidate Facility Name, Candidate Type, Candidate ZIP / Postal Code, Candidate Country, optional annual facility or warehouse cost, future per-pallet inbound/outbound/storage cost evidence, pallet capacity, currency and notes.
- Scenario Lane Costs: Origin Facility ID, Demand ID, Cost per Shipment, optional service/mode/currency.
- Candidate Warehouse Options: Provider, Facility Name, Warehouse ZIP / Postal Code, Storage Rate per Pallet per Month, Average Stored Pallets, Annual Storage Cost, Inbound Handling Rate per Pallet, Outbound Handling Rate per Pallet, Monthly Minimum, Inbound Gateway, Ocean Freight Input, Gateway-to-Warehouse Inland Cost, Currency. Complete either rate plus average inventory, or direct annual storage cost.
- Shipment Types: Shipment Type, Mode, Pallets, Weight, Freight Class, Description.
- Transportation Rates: Provider Option ID, Demand ID, Shipment Type, Cost per Shipment, Transit Business Days, Rate Source.

Expected results, benchmark controls, internal markets and defect manifests are not customer templates.

## XLSX Feasibility

XLSX upload is deferred. No Excel parser was found in `package.json`, `package-lock.json` or the SCDS upload code. Supporting one workbook with many worksheets would require dependency selection, worksheet-to-logical-file representation, duplicate worksheet/header handling, ZIP text preservation warnings, `.xlsm` rejection and persistence decisions. CSV upload remains unchanged.

## Deferred Cleanup

- Dependency-safe delete for files, mappings and runs.
- Same-name replacement/versioning with affected mapping review and old-run invalidation.
- Customer template file generation.
- Product confirmation for whether internal benchmark mode should be gated by role, feature flag or environment.
- Whether Model 01 full facility/city fields should be relaxed to match only the current proof calculation.
- Whether 3PL `studyName` needs a first-class database column.
