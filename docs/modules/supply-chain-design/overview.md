# Supply Chain Design Studio

> Evidence status: Initial implementation scope.

Supply Chain Design Studio is an isolated module for the Model 01 proof workflow. The current implementation is limited to a protected module shell, tenant-scoped project records, first-pass CSV file intake, saved draft column mappings, and a synchronous thin Model 01 proof run inside a saved project.

Current scope:

- Project list, create, and project detail shell.
- CSV upload inside a project.
- Stored original CSV bytes, detected headers, row count, and first 10 preview rows.
- Saved draft CSV column mapping for the controlled Model 01 proof table types: `FACILITIES`, `SHIPMENTS`, `INVENTORY`, and `FACILITY_COSTS`.
- Synchronous Model 01 proof run using explicitly selected mapped `FACILITIES` and `SHIPMENTS` files, plus optional explicitly selected `INVENTORY` and `FACILITY_COSTS` files.
- Proof results for facility count, shipment count, optional transportation cost totals, shipment count by origin, transportation cost by origin, optional inventory quantity/value, optional facility operating cost totals, facility operating cost by facility and category, unmatched shipment origin IDs, unmatched inventory facility IDs, unmatched facility-cost facility IDs, observed operating cost, and a combined facility summary.
- Tenant isolation, module entitlement, role authorization, mutation authorization, and audit logs for project creation and file upload.
- Model 02 proof scenarios using selected existing and candidate facilities, optional capacity enforcement, saved scenario history, comparison, and an exact small-network optimizer for controlled proof data.
- Model 02 optimizer solver foundation with an internal solver contract, exact-enumeration reference solver, independent verification checks, and a disabled mathematical-programming adapter boundary.
- First 3PL Location Screening vertical slice for the study path `Find the best warehouse region`, using mapped `DEMAND_POINTS`, the Newl reference logistics-market catalogue by default, optional project-uploaded `LOGISTICS_MARKETS` for benchmark/custom studies, and optional `CANADA_PROVINCE_MARKET_MAP` for uploaded-market Canadian studies.
- 3PL screening results are saved separately from Model 01 runs and Model 02 scenarios, with selected input references, market source mode, one-region rankings, two-region rankings, demand allocation, coverage summary, ZIP/ZCTA resolution evidence, exceptions, benchmark controls, and deterministic result version.
- Controlled `Compare known warehouse options` 3PL provider-cost proof using mapped `DEMAND_POINTS`, `PROVIDER_OPTIONS`, `SHIPMENT_PROFILES`, `OUTBOUND_RATE_CACHE`, and optional `EXPECTED_PROVIDER_RESULTS` files. The proof uses cached benchmark rates and uploaded provider cost values only; it saves selected input references, ranked provider costs, rate-match evidence, exceptions, and expected-result controls.
- U.S. demand rows may use uploaded latitude/longitude or five-digit ZIP / ZIP+4 values resolved through the generated `CENSUS_ZCTA_2025` reference from the official U.S. Census 2025 Gazetteer ZIP Code Tabulation Area national archive. The generated reference is loaded locally; normal screening runs do not download Census data or call external geocoding services.
- Census ZCTAs are geographic approximations of USPS ZIP delivery areas and do not cover every USPS ZIP code. Unresolved or malformed ZIPs are excluded, reported, and counted with excluded demand; coordinates are never invented.
- ZIP/ZCTA reference data locates customer demand. The logistics-market catalogue contains practical candidate warehouse regions. These are separate datasets, and the engine scores candidate markets against all resolved demand; it does not recommend an arbitrary weighted-centre coordinate.
- The current logistics-market catalogue version is `NEWL_LOGISTICS_MARKETS_V2`; the earlier proof catalogue is retained for audit/benchmark context. See `docs/modules/supply-chain-design/3pl-logistics-market-catalogue-audit.md` for reviewed markets, combinations, exclusions, tier definitions, and coordinate standard. The catalogue still requires later Newl commercial review before total-cost/provider comparison.
- Product cleanup inventory, customer-facing table labels, template decisions and XLSX feasibility are tracked in `docs/modules/supply-chain-design/product-inventory.md`.

Deferred scope:

- Full validation framework.
- Row-level CSV value validation beyond required proof fields.
- Date, location, unit, and currency normalization.
- Duplicate business-key detection.
- Canonical model expansion beyond the controlled proof fields.
- Snapshots.
- Full Model 01 formulas, warehouse costs, inventory costs, service calculations, and formula registry.
- Facility-cost currency conversion, inflation adjustment, cost-period normalization, duplicate rules, and allocation.
- Full-scale optimization, simulation, AI, workers, and Models 03-12.
- Model 02 production solver scale-up beyond the exact small-network optimizer proof.
- Live provider search, live 7L or UPS rating, road routing, map services, paid APIs, provider contracts, cost normalization beyond the uploaded benchmark values, and final commercial approval of provider recommendations.

Future Model 02 scalable solver formulation:

- Decision variables: facility-open decision for each permitted facility, and shipment allocation quantity from each open facility to each customer.
- Objective: minimize transportation cost plus retained existing operating cost plus opened candidate fixed cost, with unallocated shipment volume minimized first.
- Constraints: mandatory facilities remain open, prohibited candidates remain closed, minimum and maximum open-facility counts, allocation only through open facilities with valid lane costs, assigned plus unallocated shipment volume reconciles to historical volume, capacity is respected when enabled, no negative allocation, and deterministic result normalization.
