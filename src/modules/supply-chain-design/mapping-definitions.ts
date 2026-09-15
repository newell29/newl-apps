export const SUPPLY_CHAIN_DESIGN_TABLE_TYPES = [
  "CURRENT_NETWORK_ACTIVITY",
  "FACILITIES",
  "SHIPMENTS",
  "INVENTORY",
  "FACILITY_COSTS",
  "CUSTOMERS",
  "CANDIDATE_FACILITIES",
  "SCENARIO_LANE_COSTS",
  "DEMAND_POINTS",
  "LOGISTICS_MARKETS",
  "CANADA_PROVINCE_MARKET_MAP",
  "STUDY_CONTROL",
  "PROVIDER_OPTIONS",
  "SHIPMENT_PROFILES",
  "OUTBOUND_RATE_CACHE",
  "EXPECTED_PROVIDER_RESULTS"
] as const;

export type SupplyChainDesignTableTypeValue = (typeof SUPPLY_CHAIN_DESIGN_TABLE_TYPES)[number];

export const SUPPLY_CHAIN_DESIGN_INTERNAL_TABLE_TYPES = [
  "LOGISTICS_MARKETS",
  "CANADA_PROVINCE_MARKET_MAP",
  "STUDY_CONTROL",
  "EXPECTED_PROVIDER_RESULTS"
] as const satisfies readonly SupplyChainDesignTableTypeValue[];

export const SUPPLY_CHAIN_DESIGN_NORMAL_TABLE_TYPES = SUPPLY_CHAIN_DESIGN_TABLE_TYPES.filter(
  (tableType) => !SUPPLY_CHAIN_DESIGN_INTERNAL_TABLE_TYPES.includes(tableType as (typeof SUPPLY_CHAIN_DESIGN_INTERNAL_TABLE_TYPES)[number])
);

export const SUPPLY_CHAIN_DESIGN_HIDDEN_NORMAL_MAPPING_FIELDS = ["latitude", "longitude"] as const;

export type SupplyChainDesignStandardField = {
  field: string;
  requirement: "REQUIRED" | "OPTIONAL";
};

export const SUPPLY_CHAIN_DESIGN_TABLE_LABELS: Record<SupplyChainDesignTableTypeValue, string> = {
  CURRENT_NETWORK_ACTIVITY: "Legacy Current Network Data",
  FACILITIES: "Current Facilities and Warehouse Costs",
  SHIPMENTS: "Historical Shipments",
  INVENTORY: "Inventory Snapshot",
  FACILITY_COSTS: "Facility and Warehouse Costs",
  CUSTOMERS: "Customers",
  CANDIDATE_FACILITIES: "Candidate Warehouses and Proposed Costs",
  SCENARIO_LANE_COSTS: "Scenario Lane Costs",
  DEMAND_POINTS: "Delivery Demand",
  LOGISTICS_MARKETS: "Internal Logistics Markets",
  CANADA_PROVINCE_MARKET_MAP: "Internal Canada Province Map",
  STUDY_CONTROL: "Internal Study Control",
  PROVIDER_OPTIONS: "Candidate Warehouse Options",
  SHIPMENT_PROFILES: "Shipment Types",
  OUTBOUND_RATE_CACHE: "Transportation Rates",
  EXPECTED_PROVIDER_RESULTS: "Benchmark Expected Provider Results"
};

export const SUPPLY_CHAIN_DESIGN_FIELD_LABELS: Record<string, string> = {
  facility_id: "Facility ID",
  facility_name: "Facility Name",
  facility_type: "Facility Type",
  facility_capacity_pallet_positions: "Facility Capacity - Pallet Positions",
  city: "City",
  country: "Country",
  state_province: "State / Province",
  postal_code: "ZIP / Postal Code",
  annual_fixed_cost: "Annual Fixed Cost",
  annual_facility_warehouse_cost: "Annual Facility / Warehouse Cost",
  inbound_fee_per_pallet: "Inbound Fee Per Pallet",
  outbound_fee_per_pallet: "Outbound Fee Per Pallet",
  storage_fee_per_pallet_per_month: "Storage Fee Per Pallet Per Month",
  capacity: "Capacity",
  pallet_capacity: "Pallet Capacity",
  current_inventory_pallets: "Current Inventory Pallets",
  current_inventory_units: "Current Inventory Units",
  current_inventory_value: "Current Inventory Value",
  candidate_type: "Candidate Type",
  shipment_id: "Shipment / Order Reference",
  shipment_reference: "Shipment / Order Reference",
  record_type: "Record Type",
  shipment_quantity: "Shipments",
  inventory_dwell_time_days: "Inventory Dwell Time Days",
  weight_unit: "Weight Unit",
  origin_facility_id: "Origin Facility ID",
  destination_id: "Destination Customer / Group",
  shipment_date: "Shipment Date",
  weight: "Weight",
  length: "Length",
  width: "Width",
  height: "Height",
  dimension_unit: "Dimension Unit",
  hazardous_materials: "Hazardous Materials",
  volume: "Volume",
  units: "Units",
  transportation_cost: "Transportation Cost",
  mode: "Mode",
  service_days: "Service Days",
  service_level: "Service Level",
  item_id: "Item ID",
  quantity: "Quantity",
  unit_cost: "Unit Cost",
  snapshot_date: "Snapshot Date",
  cost_category: "Cost Category",
  annual_cost: "Annual Cost",
  currency: "Currency",
  cost_year: "Cost Year",
  notes: "Notes",
  customer_id: "Customer ID",
  customer_name: "Destination Customer / Group",
  customer_segment: "Customer Segment",
  annual_demand: "Annual Demand",
  destination_label: "Destination City / Region",
  inventory_pallets: "Inventory Pallets",
  inventory_value_total: "Inventory Value",
  candidate_facility_id: "Candidate Facility ID",
  candidate_facility_name: "Candidate Facility Name",
  candidate_country: "Candidate Country",
  cost_per_shipment: "Cost per Shipment",
  postal_or_region_code: "Destination ZIP / Postal Code",
  annual_shipment_count: "Annual Shipments",
  annual_weight: "Annual Weight",
  annual_pallets: "Annual Pallets",
  shipment_profile_id: "Shipment Type",
  provider_option_id: "Provider Option ID",
  provider_name: "Provider",
  warehouse_postal_code: "Warehouse ZIP / Postal Code",
  warehouse_city: "Warehouse City",
  warehouse_state_province: "Warehouse State / Province",
  warehouse_country: "Warehouse Country",
  warehouse_name: "Facility Name",
  monthly_storage_cost: "Storage Rate per Pallet per Month",
  average_stored_pallets: "Average Stored Pallets",
  annual_storage_cost: "Annual Storage Cost",
  receiving_cost_per_unit: "Inbound Handling Rate per Pallet",
  outbound_handling_cost_per_unit: "Outbound Handling Rate per Pallet",
  monthly_minimum: "Monthly Minimum",
  annual_minimum: "Annual Minimum",
  fixed_annual_cost: "Fixed Annual Cost",
  inbound_gateway_cost: "Ocean Freight Input",
  other_annual_cost: "Gateway-to-Warehouse Inland Cost",
  inbound_gateway: "Inbound Gateway",
  shipment_profile_id_profile: "Shipment Type",
  description: "Description",
  pallets: "Pallets",
  weight_lb: "Weight lb",
  freight_class: "Freight Class",
  assumptions: "Assumptions",
  transit_business_days: "Transit Business Days",
  estimated_road_miles: "Estimated Road Miles",
  source: "Rate Source",
  latitude: "Latitude",
  longitude: "Longitude",
  market_id: "Market ID",
  market_name: "Market Name",
  active_eligible: "Eligibility / Market Type",
  major_city: "Major City",
  region_grouping: "Region Grouping",
  province: "Province",
  province_code: "Province Code",
  approved_logistics_market_id: "Approved Logistics Market ID",
  approved_major_city: "Approved Major City",
  study_name: "Study Name",
  study_type: "Study Type",
  country_scope: "Country Scope",
  compare_one_region: "Compare One Region",
  compare_two_regions: "Compare Two Regions",
  distance_method: "Distance Method",
  road_factor: "Road Factor",
  maximum_regions_to_compare: "Maximum Regions to Compare",
  weighting_measure: "Weighting Measure",
  selected_demand_file: "Selected Demand File",
  selected_market_file: "Selected Market File",
  rank: "Rank",
  outbound_cost: "Outbound Cost",
  warehouse_cost: "Warehouse Cost",
  ocean_cost: "Ocean Cost",
  inland_to_warehouse_cost: "Inland-to-Warehouse Cost",
  total_annual_cost: "Total Annual Cost",
  shipments_within_3_days: "Shipments Within 3 Days",
  three_day_coverage_percent: "3-Day Coverage %"
};

export const SUPPLY_CHAIN_DESIGN_FIELD_HELP: Record<string, { description: string; unit?: string; example?: string }> = {
  facility_id: { description: "Unique ID for an existing facility.", example: "TOR-01" },
  facility_name: { description: "Readable facility name.", example: "Toronto DC" },
  facility_type: { description: "Facility operating model such as Owned, Leased, Existing 3PL, or Other.", example: "Existing 3PL" },
  facility_capacity_pallet_positions: {
    description: "Facility capacity in pallet positions. Used only with compatible inventory or occupancy data.",
    unit: "pallet positions",
    example: "10000"
  },
  city: { description: "City label used for display.", example: "Toronto" },
  state_province: { description: "State or province code/name.", example: "ON" },
  country: { description: "Country code or name.", example: "US" },
  postal_code: { description: "ZIP or postal code.", example: "60601" },
  capacity: { description: "Optional shipment or facility capacity. Blank means unlimited where supported.", example: "10000" },
  inbound_fee_per_pallet: {
    description: "Candidate warehouse inbound handling cost per pallet. Used by Network Scenario Comparison when Annual Facility / Warehouse Cost is blank.",
    unit: "currency per pallet",
    example: "8.50"
  },
  outbound_fee_per_pallet: {
    description: "Candidate warehouse outbound handling cost per pallet. Used by Network Scenario Comparison when Annual Facility / Warehouse Cost is blank.",
    unit: "currency per pallet",
    example: "7.25"
  },
  storage_fee_per_pallet_per_month: {
    description: "Candidate warehouse storage cost per pallet per billable month. Used with Inventory Dwell Time Days when Annual Facility / Warehouse Cost is blank.",
    unit: "currency per pallet per month",
    example: "18"
  },
  shipment_id: { description: "Shipment, order, invoice, or activity reference. Blank is allowed for aggregated activity.", example: "ORD-1001" },
  shipment_reference: { description: "Customer shipment, order, invoice, or activity reference.", example: "ORD-1001" },
  record_type: { description: "Individual Shipment or Aggregated Activity.", example: "Aggregated Activity" },
  shipment_quantity: { description: "Number of shipments represented by the row. Blank means one shipment.", unit: "shipments", example: "100" },
  inventory_dwell_time_days: {
    description: "Inventory dwell time represented by the shipment row. Used for candidate variable storage billing in Network Scenario Comparison.",
    unit: "days",
    example: "14"
  },
  weight_unit: { description: "Weight unit for the Weight value. Required when Weight is supplied for LTL rate preparation.", example: "lb" },
  origin_facility_id: { description: "Facility ID where the shipment starts.", example: "TOR-01" },
  destination_id: { description: "Destination customer, site, ZIP, region, or generated internal destination group.", example: "CUST-ATL" },
  shipment_date: { description: "Shipment date.", example: "2026-01-15" },
  transportation_cost: { description: "Observed transportation cost for the shipment.", unit: "currency", example: "125.50" },
  length: { description: "Representative per-shipment length used for candidate LTL rate preparation.", example: "48" },
  width: { description: "Representative per-shipment width used for candidate LTL rate preparation.", example: "40" },
  height: { description: "Representative per-shipment height used for candidate LTL rate preparation.", example: "60" },
  dimension_unit: { description: "Dimension unit for Length, Width and Height. Required when dimensions are supplied for LTL rate preparation.", example: "in" },
  hazardous_materials: { description: "Whether the shipment contains hazardous materials. Use Yes or No.", example: "No" },
  service_days: { description: "Transit or service days for the shipment/activity row.", unit: "days", example: "2" },
  service_level: { description: "Service level label retained for current-state review.", example: "Standard" },
  item_id: { description: "Inventory item ID.", example: "ITEM-001" },
  quantity: { description: "Inventory quantity.", unit: "units", example: "500" },
  unit_cost: { description: "Inventory value per unit.", unit: "currency/unit", example: "12.25" },
  cost_category: { description: "Operating cost category.", example: "Rent" },
  annual_cost: { description: "Annual operating cost total.", unit: "currency/year", example: "250000" },
  customer_id: { description: "Unique customer ID.", example: "CUST-001" },
  customer_name: { description: "Readable destination customer, site, ZIP group, or region.", example: "Dallas retail ZIP 75201" },
  destination_label: { description: "Destination city, region, ZIP group, or neutral display label.", example: "ZIP 75201" },
  candidate_facility_id: { description: "Unique candidate facility ID.", example: "CHI-01" },
  candidate_facility_name: { description: "Readable candidate facility name.", example: "Chicago 3PL" },
  candidate_country: { description: "Candidate warehouse origin country used for dependable LTL rating requests.", example: "US" },
  annual_fixed_cost: { description: "Annual fixed cost for the candidate facility.", unit: "currency/year", example: "900000" },
  annual_facility_warehouse_cost: {
    description: "Annual lump-sum facility, warehouse, or current 3PL cost included in the baseline.",
    unit: "currency/year",
    example: "240000"
  },
  pallet_capacity: { description: "Practical pallet-position capacity.", unit: "pallet positions", example: "12000" },
  current_inventory_pallets: { description: "Current approximate inventory in pallets.", unit: "pallets", example: "3500" },
  current_inventory_units: { description: "Current approximate inventory in units.", unit: "units", example: "42000" },
  current_inventory_value: { description: "Current approximate inventory value.", unit: "currency", example: "1250000" },
  candidate_type: { description: "Proposed Owned, Proposed Leased, Proposed 3PL, or Location Candidate.", example: "Proposed 3PL" },
  cost_per_shipment: { description: "Transportation rate for one shipment.", unit: "currency/shipment", example: "103.51" },
  postal_or_region_code: { description: "Destination ZIP, postal code, or approved region code.", example: "75201" },
  annual_shipment_count: { description: "Annual shipment volume for the demand point.", unit: "shipments/year", example: "300" },
  annual_pallets: { description: "Annual pallet volume used by warehouse cost comparison.", unit: "pallets/year", example: "600" },
  shipment_profile_id: { description: "Shipment type used to match demand to rates.", example: "LTL-2P" },
  provider_option_id: { description: "Unique provider or warehouse option ID.", example: "P-DFW" },
  provider_name: { description: "Provider name.", example: "Fort Worth 3PL" },
  warehouse_name: { description: "Warehouse or facility display name.", example: "Fort Worth Facility" },
  warehouse_postal_code: { description: "Warehouse ZIP or postal code.", example: "76102" },
  warehouse_city: { description: "Warehouse city.", example: "Fort Worth" },
  warehouse_state_province: { description: "Warehouse state or province.", example: "TX" },
  warehouse_country: { description: "Warehouse country.", example: "US" },
  monthly_storage_cost: {
    description: "Storage rate per pallet per month. Required with Average Stored Pallets unless Annual Storage Cost is supplied.",
    unit: "currency/pallet/month",
    example: "12"
  },
  average_stored_pallets: {
    description: "Average pallets stored during the year. Required with Storage Rate per Pallet per Month unless Annual Storage Cost is supplied.",
    unit: "pallets",
    example: "500"
  },
  annual_storage_cost: {
    description: "Direct annual storage cost. When supplied, rate-based storage is not also applied.",
    unit: "currency/year",
    example: "72000"
  },
  receiving_cost_per_unit: { description: "Inbound handling rate multiplied by annual pallets.", unit: "currency/pallet", example: "6" },
  outbound_handling_cost_per_unit: { description: "Outbound handling rate multiplied by annual pallets.", unit: "currency/pallet", example: "8" },
  monthly_minimum: { description: "Monthly minimum charge, annualized and compared to warehouse cost before minimum.", unit: "currency/month", example: "2500" },
  fixed_annual_cost: { description: "Fixed annual warehouse cost when available.", unit: "currency/year", example: "100000" },
  inbound_gateway_cost: { description: "Annual ocean freight input in the current beta proof.", unit: "currency/year", example: "195000" },
  other_annual_cost: { description: "Gateway-to-warehouse inland cost in the current beta proof.", unit: "currency/year", example: "35000" },
  inbound_gateway: { description: "Inbound gateway used for the provider option.", example: "Houston" },
  mode: { description: "Shipment mode.", example: "LTL" },
  pallets: { description: "Pallets per representative shipment type.", unit: "pallets", example: "2" },
  weight_lb: { description: "Weight per representative shipment type.", unit: "lb", example: "1000" },
  freight_class: { description: "Freight class where relevant.", example: "Class 70" },
  transit_business_days: { description: "Transit days from cached or quoted transportation rate.", unit: "business days", example: "2" },
  source: { description: "Source of the transportation rate.", example: "Cached benchmark rate" },
  currency: { description: "Currency code.", example: "USD" }
};

export const SUPPLY_CHAIN_DESIGN_MAPPING_DEFINITIONS: Record<
  SupplyChainDesignTableTypeValue,
  SupplyChainDesignStandardField[]
> = {
  CURRENT_NETWORK_ACTIVITY: [
    { field: "record_type", requirement: "OPTIONAL" },
    { field: "shipment_reference", requirement: "OPTIONAL" },
    { field: "origin_facility_id", requirement: "REQUIRED" },
    { field: "facility_name", requirement: "REQUIRED" },
    { field: "facility_type", requirement: "OPTIONAL" },
    { field: "postal_code", requirement: "OPTIONAL" },
    { field: "country", requirement: "OPTIONAL" },
    { field: "facility_capacity_pallet_positions", requirement: "OPTIONAL" },
    { field: "shipment_date", requirement: "OPTIONAL" },
    { field: "destination_id", requirement: "OPTIONAL" },
    { field: "destination_label", requirement: "OPTIONAL" },
    { field: "postal_or_region_code", requirement: "OPTIONAL" },
    { field: "transportation_cost", requirement: "OPTIONAL" },
    { field: "mode", requirement: "OPTIONAL" },
    { field: "service_days", requirement: "OPTIONAL" },
    { field: "service_level", requirement: "OPTIONAL" },
    { field: "shipment_quantity", requirement: "OPTIONAL" },
    { field: "pallets", requirement: "OPTIONAL" },
    { field: "units", requirement: "OPTIONAL" },
    { field: "weight", requirement: "OPTIONAL" },
    { field: "weight_unit", requirement: "OPTIONAL" },
    { field: "length", requirement: "OPTIONAL" },
    { field: "width", requirement: "OPTIONAL" },
    { field: "height", requirement: "OPTIONAL" },
    { field: "dimension_unit", requirement: "OPTIONAL" },
    { field: "hazardous_materials", requirement: "OPTIONAL" },
    { field: "item_id", requirement: "OPTIONAL" },
    { field: "quantity", requirement: "OPTIONAL" },
    { field: "inventory_pallets", requirement: "OPTIONAL" },
    { field: "inventory_value_total", requirement: "OPTIONAL" },
    { field: "snapshot_date", requirement: "OPTIONAL" },
    { field: "currency", requirement: "OPTIONAL" }
  ],
  FACILITIES: [
    { field: "facility_id", requirement: "REQUIRED" },
    { field: "facility_name", requirement: "REQUIRED" },
    { field: "facility_type", requirement: "REQUIRED" },
    { field: "city", requirement: "OPTIONAL" },
    { field: "country", requirement: "OPTIONAL" },
    { field: "state_province", requirement: "OPTIONAL" },
    { field: "postal_code", requirement: "OPTIONAL" },
    { field: "latitude", requirement: "OPTIONAL" },
    { field: "longitude", requirement: "OPTIONAL" },
    { field: "annual_fixed_cost", requirement: "OPTIONAL" },
    { field: "annual_facility_warehouse_cost", requirement: "OPTIONAL" },
    { field: "capacity", requirement: "OPTIONAL" },
    { field: "pallet_capacity", requirement: "OPTIONAL" },
    { field: "current_inventory_pallets", requirement: "OPTIONAL" },
    { field: "current_inventory_units", requirement: "OPTIONAL" },
    { field: "current_inventory_value", requirement: "OPTIONAL" },
    { field: "currency", requirement: "OPTIONAL" },
    { field: "notes", requirement: "OPTIONAL" }
  ],
  SHIPMENTS: [
    { field: "shipment_id", requirement: "OPTIONAL" },
    { field: "origin_facility_id", requirement: "REQUIRED" },
    { field: "destination_id", requirement: "OPTIONAL" },
    { field: "postal_or_region_code", requirement: "OPTIONAL" },
    { field: "destination_label", requirement: "OPTIONAL" },
    { field: "country", requirement: "OPTIONAL" },
    { field: "state_province", requirement: "OPTIONAL" },
    { field: "shipment_date", requirement: "OPTIONAL" },
    { field: "shipment_reference", requirement: "OPTIONAL" },
    { field: "record_type", requirement: "OPTIONAL" },
    { field: "shipment_quantity", requirement: "OPTIONAL" },
    { field: "pallets", requirement: "OPTIONAL" },
    { field: "inventory_dwell_time_days", requirement: "OPTIONAL" },
    { field: "weight", requirement: "OPTIONAL" },
    { field: "weight_unit", requirement: "OPTIONAL" },
    { field: "length", requirement: "OPTIONAL" },
    { field: "width", requirement: "OPTIONAL" },
    { field: "height", requirement: "OPTIONAL" },
    { field: "dimension_unit", requirement: "OPTIONAL" },
    { field: "hazardous_materials", requirement: "OPTIONAL" },
    { field: "volume", requirement: "OPTIONAL" },
    { field: "units", requirement: "OPTIONAL" },
    { field: "transportation_cost", requirement: "OPTIONAL" },
    { field: "mode", requirement: "OPTIONAL" },
    { field: "service_days", requirement: "OPTIONAL" },
    { field: "service_level", requirement: "OPTIONAL" },
    { field: "item_id", requirement: "OPTIONAL" },
    { field: "currency", requirement: "OPTIONAL" }
  ],
  INVENTORY: [
    { field: "facility_id", requirement: "REQUIRED" },
    { field: "item_id", requirement: "REQUIRED" },
    { field: "quantity", requirement: "REQUIRED" },
    { field: "unit_cost", requirement: "OPTIONAL" },
    { field: "snapshot_date", requirement: "OPTIONAL" }
  ],
  FACILITY_COSTS: [
    { field: "facility_id", requirement: "REQUIRED" },
    { field: "facility_name", requirement: "OPTIONAL" },
    { field: "cost_category", requirement: "REQUIRED" },
    { field: "annual_cost", requirement: "REQUIRED" },
    { field: "currency", requirement: "OPTIONAL" },
    { field: "cost_year", requirement: "OPTIONAL" },
    { field: "notes", requirement: "OPTIONAL" }
  ],
  CUSTOMERS: [
    { field: "customer_id", requirement: "REQUIRED" },
    { field: "customer_name", requirement: "REQUIRED" },
    { field: "city", requirement: "OPTIONAL" },
    { field: "country", requirement: "OPTIONAL" },
    { field: "state_province", requirement: "OPTIONAL" },
    { field: "postal_code", requirement: "OPTIONAL" },
    { field: "latitude", requirement: "OPTIONAL" },
    { field: "longitude", requirement: "OPTIONAL" },
    { field: "customer_segment", requirement: "OPTIONAL" },
    { field: "annual_demand", requirement: "OPTIONAL" }
  ],
  CANDIDATE_FACILITIES: [
    { field: "candidate_facility_id", requirement: "REQUIRED" },
    { field: "candidate_facility_name", requirement: "REQUIRED" },
    { field: "candidate_type", requirement: "REQUIRED" },
    { field: "postal_code", requirement: "REQUIRED" },
    { field: "candidate_country", requirement: "REQUIRED" },
    { field: "city", requirement: "OPTIONAL" },
    { field: "country", requirement: "OPTIONAL" },
    { field: "annual_fixed_cost", requirement: "OPTIONAL" },
    { field: "annual_facility_warehouse_cost", requirement: "OPTIONAL" },
    { field: "inbound_fee_per_pallet", requirement: "OPTIONAL" },
    { field: "outbound_fee_per_pallet", requirement: "OPTIONAL" },
    { field: "storage_fee_per_pallet_per_month", requirement: "OPTIONAL" },
    { field: "pallet_capacity", requirement: "OPTIONAL" },
    { field: "capacity", requirement: "OPTIONAL" },
    { field: "currency", requirement: "OPTIONAL" },
    { field: "notes", requirement: "OPTIONAL" },
    { field: "state_province", requirement: "OPTIONAL" },
    { field: "latitude", requirement: "OPTIONAL" },
    { field: "longitude", requirement: "OPTIONAL" },
    { field: "facility_type", requirement: "OPTIONAL" }
  ],
  SCENARIO_LANE_COSTS: [
    { field: "origin_facility_id", requirement: "REQUIRED" },
    { field: "destination_id", requirement: "REQUIRED" },
    { field: "cost_per_shipment", requirement: "REQUIRED" },
    { field: "service_days", requirement: "OPTIONAL" },
    { field: "mode", requirement: "OPTIONAL" },
    { field: "currency", requirement: "OPTIONAL" }
  ],
  DEMAND_POINTS: [
    { field: "destination_id", requirement: "REQUIRED" },
    { field: "postal_or_region_code", requirement: "REQUIRED" },
    { field: "country", requirement: "REQUIRED" },
    { field: "annual_shipment_count", requirement: "REQUIRED" },
    { field: "city", requirement: "OPTIONAL" },
    { field: "state_province", requirement: "OPTIONAL" },
    { field: "latitude", requirement: "OPTIONAL" },
    { field: "longitude", requirement: "OPTIONAL" },
    { field: "annual_weight", requirement: "OPTIONAL" },
    { field: "annual_pallets", requirement: "OPTIONAL" },
    { field: "shipment_profile_id", requirement: "OPTIONAL" }
  ],
  LOGISTICS_MARKETS: [
    { field: "market_id", requirement: "REQUIRED" },
    { field: "market_name", requirement: "REQUIRED" },
    { field: "state_province", requirement: "REQUIRED" },
    { field: "country", requirement: "REQUIRED" },
    { field: "latitude", requirement: "REQUIRED" },
    { field: "longitude", requirement: "REQUIRED" },
    { field: "active_eligible", requirement: "REQUIRED" },
    { field: "major_city", requirement: "OPTIONAL" },
    { field: "region_grouping", requirement: "OPTIONAL" }
  ],
  CANADA_PROVINCE_MARKET_MAP: [
    { field: "province", requirement: "OPTIONAL" },
    { field: "province_code", requirement: "REQUIRED" },
    { field: "approved_logistics_market_id", requirement: "REQUIRED" },
    { field: "approved_major_city", requirement: "REQUIRED" }
  ],
  STUDY_CONTROL: [
    { field: "study_name", requirement: "REQUIRED" },
    { field: "study_type", requirement: "REQUIRED" },
    { field: "country_scope", requirement: "REQUIRED" },
    { field: "compare_one_region", requirement: "OPTIONAL" },
    { field: "compare_two_regions", requirement: "OPTIONAL" },
    { field: "distance_method", requirement: "OPTIONAL" },
    { field: "road_factor", requirement: "OPTIONAL" },
    { field: "currency", requirement: "OPTIONAL" },
    { field: "maximum_regions_to_compare", requirement: "OPTIONAL" },
    { field: "weighting_measure", requirement: "OPTIONAL" },
    { field: "selected_demand_file", requirement: "OPTIONAL" },
    { field: "selected_market_file", requirement: "OPTIONAL" }
  ],
  PROVIDER_OPTIONS: [
    { field: "provider_option_id", requirement: "REQUIRED" },
    { field: "provider_name", requirement: "REQUIRED" },
    { field: "warehouse_postal_code", requirement: "REQUIRED" },
    { field: "warehouse_city", requirement: "REQUIRED" },
    { field: "warehouse_state_province", requirement: "REQUIRED" },
    { field: "warehouse_country", requirement: "REQUIRED" },
    { field: "warehouse_name", requirement: "OPTIONAL" },
    { field: "monthly_storage_cost", requirement: "OPTIONAL" },
    { field: "average_stored_pallets", requirement: "OPTIONAL" },
    { field: "annual_storage_cost", requirement: "OPTIONAL" },
    { field: "receiving_cost_per_unit", requirement: "OPTIONAL" },
    { field: "outbound_handling_cost_per_unit", requirement: "OPTIONAL" },
    { field: "monthly_minimum", requirement: "OPTIONAL" },
    { field: "annual_minimum", requirement: "OPTIONAL" },
    { field: "fixed_annual_cost", requirement: "OPTIONAL" },
    { field: "inbound_gateway_cost", requirement: "OPTIONAL" },
    { field: "other_annual_cost", requirement: "OPTIONAL" },
    { field: "currency", requirement: "OPTIONAL" },
    { field: "inbound_gateway", requirement: "OPTIONAL" }
  ],
  SHIPMENT_PROFILES: [
    { field: "shipment_profile_id", requirement: "REQUIRED" },
    { field: "mode", requirement: "REQUIRED" },
    { field: "description", requirement: "OPTIONAL" },
    { field: "pallets", requirement: "OPTIONAL" },
    { field: "weight_lb", requirement: "OPTIONAL" },
    { field: "freight_class", requirement: "OPTIONAL" },
    { field: "assumptions", requirement: "OPTIONAL" }
  ],
  OUTBOUND_RATE_CACHE: [
    { field: "provider_option_id", requirement: "REQUIRED" },
    { field: "destination_id", requirement: "REQUIRED" },
    { field: "shipment_profile_id", requirement: "REQUIRED" },
    { field: "cost_per_shipment", requirement: "REQUIRED" },
    { field: "transit_business_days", requirement: "OPTIONAL" },
    { field: "estimated_road_miles", requirement: "OPTIONAL" },
    { field: "currency", requirement: "OPTIONAL" },
    { field: "source", requirement: "OPTIONAL" }
  ],
  EXPECTED_PROVIDER_RESULTS: [
    { field: "rank", requirement: "REQUIRED" },
    { field: "provider_option_id", requirement: "REQUIRED" },
    { field: "provider_name", requirement: "REQUIRED" },
    { field: "outbound_cost", requirement: "REQUIRED" },
    { field: "warehouse_cost", requirement: "REQUIRED" },
    { field: "ocean_cost", requirement: "REQUIRED" },
    { field: "inland_to_warehouse_cost", requirement: "REQUIRED" },
    { field: "total_annual_cost", requirement: "REQUIRED" },
    { field: "shipments_within_3_days", requirement: "OPTIONAL" },
    { field: "three_day_coverage_percent", requirement: "OPTIONAL" }
  ]
};

export function isSupplyChainDesignTableType(value: string): value is SupplyChainDesignTableTypeValue {
  return SUPPLY_CHAIN_DESIGN_TABLE_TYPES.includes(value as SupplyChainDesignTableTypeValue);
}

export function getSupplyChainDesignMappingDefinition(tableType: SupplyChainDesignTableTypeValue) {
  return SUPPLY_CHAIN_DESIGN_MAPPING_DEFINITIONS[tableType];
}

export type RecognizedSupplyChainDesignOfficialTemplate = {
  tableType: SupplyChainDesignTableTypeValue;
  fieldMappings: Array<{
    standardField: string;
    sourceColumn: string;
    requirement: "REQUIRED" | "OPTIONAL";
  }>;
};

const OFFICIAL_TEMPLATE_HEADER_MAPPINGS: Array<{
  tableType: SupplyChainDesignTableTypeValue;
  headersByField: Record<string, string>;
  optionalHeadersByField?: Record<string, string>;
}> = [
  {
    tableType: "FACILITIES",
    headersByField: {
      facility_id: "Facility ID",
      facility_name: "Facility Name",
      facility_type: "Facility Type",
      postal_code: "Facility ZIP / Postal Code",
      annual_facility_warehouse_cost: "Annual Facility / Warehouse Cost",
      pallet_capacity: "Pallet Capacity",
      current_inventory_pallets: "Current Inventory Pallets",
      current_inventory_units: "Current Inventory Units",
      current_inventory_value: "Current Inventory Value",
      currency: "Currency",
      notes: "Notes"
    }
  },
  {
    tableType: "SHIPMENTS",
    headersByField: {
      record_type: "Record Type",
      shipment_id: "Shipment / Order Reference",
      shipment_date: "Shipment Date",
      origin_facility_id: "Origin Facility ID",
      destination_id: "Destination Customer / Group",
      postal_or_region_code: "Destination ZIP / Postal Code",
      destination_label: "Destination City / Region",
      country: "Destination Country",
      shipment_quantity: "Shipments",
      pallets: "Pallets",
      units: "Units",
      weight: "Weight",
      weight_unit: "Weight Unit",
      length: "Length",
      width: "Width",
      height: "Height",
      dimension_unit: "Dimension Unit",
      hazardous_materials: "Hazardous Materials",
      mode: "Transportation Mode",
      transportation_cost: "Transportation Cost",
      service_days: "Transit Days",
      service_level: "Service Level",
      item_id: "SKU / Item",
      currency: "Currency"
    },
    optionalHeadersByField: {
      state_province: "State/Province",
      inventory_dwell_time_days: "Inventory Dwell Time Days"
    }
  },
  {
    tableType: "CANDIDATE_FACILITIES",
    headersByField: {
      candidate_facility_id: "Candidate Facility ID",
      candidate_facility_name: "Candidate Facility Name",
      candidate_type: "Candidate Type",
      postal_code: "Candidate ZIP / Postal Code",
      candidate_country: "Candidate Country",
      annual_facility_warehouse_cost: "Annual Facility / Warehouse Cost",
      pallet_capacity: "Pallet Capacity",
      currency: "Currency",
      notes: "Notes"
    },
    optionalHeadersByField: {
      inbound_fee_per_pallet: "Inbound Fee Per Pallet",
      outbound_fee_per_pallet: "Outbound Fee Per Pallet",
      storage_fee_per_pallet_per_month: "Storage Fee Per Pallet Per Month"
    }
  }
];

export function recognizeSupplyChainDesignOfficialTemplate(
  headers: string[]
): RecognizedSupplyChainDesignOfficialTemplate | null {
  const sourceHeadersByNormalized = new Map(headers.map((header) => [normalizeOfficialTemplateHeader(header), header]));
  const normalizedHeaderSet = new Set(sourceHeadersByNormalized.keys());

  for (const template of OFFICIAL_TEMPLATE_HEADER_MAPPINGS) {
    const requiredHeaders = Object.values(template.headersByField).map(normalizeOfficialTemplateHeader);
    const optionalHeaders = Object.values(template.optionalHeadersByField ?? {}).map(normalizeOfficialTemplateHeader);
    const allowedHeaders = new Set([...requiredHeaders, ...optionalHeaders]);
    if (normalizedHeaderSet.size < requiredHeaders.length || normalizedHeaderSet.size > allowedHeaders.size) {
      continue;
    }
    if (!requiredHeaders.every((header) => normalizedHeaderSet.has(header))) {
      continue;
    }
    if (![...normalizedHeaderSet].every((header) => allowedHeaders.has(header))) {
      continue;
    }

    const definitionsByField = new Map(
      SUPPLY_CHAIN_DESIGN_MAPPING_DEFINITIONS[template.tableType].map((field) => [field.field, field.requirement])
    );
    const headersByField = {
      ...template.headersByField,
      ...Object.fromEntries(
        Object.entries(template.optionalHeadersByField ?? {}).filter(([, expectedHeader]) =>
          normalizedHeaderSet.has(normalizeOfficialTemplateHeader(expectedHeader))
        )
      )
    };
    return {
      tableType: template.tableType,
      fieldMappings: Object.entries(headersByField).map(([standardField, expectedHeader]) => ({
        standardField,
        sourceColumn: sourceHeadersByNormalized.get(normalizeOfficialTemplateHeader(expectedHeader)) ?? expectedHeader,
        requirement: definitionsByField.get(standardField) ?? "OPTIONAL"
      }))
    };
  }

  return null;
}

export function isAutomaticallyMappedFromNewlTemplate(headers: string[], tableType: string | null, fieldMappings: unknown) {
  const recognized = recognizeSupplyChainDesignOfficialTemplate(headers);
  if (!recognized || recognized.tableType !== tableType) {
    return false;
  }
  const mappedColumns = new Map(
    Array.isArray(fieldMappings)
      ? fieldMappings
          .filter((field): field is { standardField: string; sourceColumn: string } =>
            Boolean(field && typeof field === "object" && "standardField" in field && "sourceColumn" in field)
          )
          .map((field) => [field.standardField, normalizeOfficialTemplateHeader(field.sourceColumn)])
      : []
  );
  return recognized.fieldMappings.every(
    (field) => mappedColumns.get(field.standardField) === normalizeOfficialTemplateHeader(field.sourceColumn)
  );
}

function normalizeOfficialTemplateHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function getSupplyChainDesignTableLabel(tableType: string) {
  return isSupplyChainDesignTableType(tableType) ? SUPPLY_CHAIN_DESIGN_TABLE_LABELS[tableType] : tableType;
}

export function getSupplyChainDesignFieldLabel(field: string) {
  return SUPPLY_CHAIN_DESIGN_FIELD_LABELS[field] ?? field;
}

export function getSupplyChainDesignFieldHelp(field: string) {
  return SUPPLY_CHAIN_DESIGN_FIELD_HELP[field] ?? { description: "Optional supporting field." };
}

export function isSupplyChainDesignHiddenNormalMappingField(field: string) {
  return SUPPLY_CHAIN_DESIGN_HIDDEN_NORMAL_MAPPING_FIELDS.includes(
    field as (typeof SUPPLY_CHAIN_DESIGN_HIDDEN_NORMAL_MAPPING_FIELDS)[number]
  );
}

export function isSupplyChainDesignInternalTableType(tableType: string) {
  return SUPPLY_CHAIN_DESIGN_INTERNAL_TABLE_TYPES.includes(
    tableType as (typeof SUPPLY_CHAIN_DESIGN_INTERNAL_TABLE_TYPES)[number]
  );
}
