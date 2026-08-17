import { SupplyChainDesignTableType } from "@prisma/client";

import { parseCsvRows } from "@/modules/supply-chain-design/csv-intake";
import type { SupplyChainDesignFieldMapping } from "@/modules/supply-chain-design/types";

export type SupplyChainDesignModel01ProofInput = {
  currentNetworkActivity?: SupplyChainDesignMappedFile | null;
  facilities: SupplyChainDesignMappedFile;
  shipments: SupplyChainDesignMappedFile;
  inventory?: SupplyChainDesignMappedFile | null;
  facilityCosts?: SupplyChainDesignMappedFile | null;
  customers?: SupplyChainDesignMappedFile | null;
};

export type SupplyChainDesignMappedFile = {
  fileId: string;
  mappingId: string;
  tableType: SupplyChainDesignTableType;
  fileBytes: Buffer;
  fieldMappings: SupplyChainDesignFieldMapping[];
};

export type SupplyChainDesignModel01ProofResult = {
  facilityCount: number;
  shipmentCount: number;
  hasTransportationCost: boolean;
  totalTransportationCost: number | null;
  shipmentCountByOrigin: Array<{
    originFacilityId: string;
    shipmentCount: number;
  }>;
  transportationCostByOrigin: Array<{
    originFacilityId: string;
    transportationCost: number;
  }> | null;
  unmatchedShipmentOriginIds: string[];
  hasInventory: boolean;
  inventoryQuantity: number | null;
  inventoryQuantityByFacility: Array<{
    facilityId: string;
    inventoryQuantity: number;
  }> | null;
  hasInventoryValue: boolean;
  inventoryValue: number | null;
  inventoryValueByFacility: Array<{
    facilityId: string;
    inventoryValue: number;
  }> | null;
  unmatchedInventoryFacilityIds: string[];
  hasFacilityCosts: boolean;
  totalFacilityOperatingCost: number | null;
  facilityOperatingCostByFacility: Array<{
    facilityId: string;
    facilityOperatingCost: number;
  }> | null;
  facilityOperatingCostByCategory: Array<{
    costCategory: string;
    facilityOperatingCost: number;
  }> | null;
  unmatchedFacilityCostFacilityIds: string[];
  hasCustomers: boolean;
  customerCount: number | null;
  shipmentCountByDestination: Array<{
    destinationId: string;
    shipmentCount: number;
  }> | null;
  transportationCostByDestination: Array<{
    destinationId: string;
    transportationCost: number;
  }> | null;
  laneShipmentCounts: Array<{
    originFacilityId: string;
    destinationId: string;
    shipmentCount: number;
  }> | null;
  transportationCostByLane: Array<{
    originFacilityId: string;
    destinationId: string;
    transportationCost: number;
  }> | null;
  unmatchedShipmentDestinationIds: string[];
  hasCustomerDemand: boolean;
  totalAnnualCustomerDemand: number | null;
  annualDemandByCustomer: Array<{
    customerId: string;
    annualDemand: number;
  }> | null;
  hasServiceDays: boolean;
  averageServiceDays: number | null;
  averageServiceDaysByDestination: Array<{
    destinationId: string;
    averageServiceDays: number;
  }> | null;
  averageServiceDaysByLane: Array<{
    originFacilityId: string;
    destinationId: string;
    averageServiceDays: number;
  }> | null;
  networkLanes: Array<{
    originFacilityId: string;
    originFacilityName: string;
    destinationId: string;
    customerName: string | null;
    shipmentCount: number;
    transportationCost: number | null;
    averageServiceDays: number | null;
  }> | null;
  facilitySummary: Array<{
    facilityId: string;
    facilityName: string;
    facilityType: string | null;
    shipmentCount: number;
    pallets: number | null;
    units: number | null;
    weight: number | null;
    transportationCost: number | null;
    inventoryQuantity: number | null;
    inventoryValue: number | null;
    facilityOperatingCost: number | null;
    observedCost: number | null;
  }>;
  analysisLevels?: Array<{
    label: string;
    status: "AVAILABLE" | "NOT_CALCULATED";
    explanation: string;
  }>;
  facilityDataWarnings?: string[];
  volumeSummary?: {
    totalShipments: number;
    totalPallets: number | null;
    totalUnits: number | null;
    totalWeight: number | null;
    averagePalletsPerShipment: number | null;
    averageUnitsPerShipment: number | null;
    averageWeightPerShipment: number | null;
    transportationCostPerShipment: number | null;
    transportationCostPerPallet: number | null;
    transportationCostPerUnit: number | null;
    transportationCostPerPound: number | null;
  };
  currencyWarnings?: string[];
  transportationCostByCurrency?: Array<{ currency: string; transportationCost: number }>;
  facilityCostByCurrency?: Array<{ currency: string; facilityOperatingCost: number }>;
  observedNetworkCostByCurrency?: Array<{ currency: string; observedCost: number }>;
  snapshotPalletUtilization?: Array<{
    facilityId: string;
    facilityName: string;
    facilityType: string | null;
    capacityPalletPositions: number;
    inventoryPallets: number;
    snapshotDate: string;
    utilizationPercent: number;
    latest: boolean;
    warning: string | null;
  }>;
  modeSummary?: Array<{ mode: string; shipmentCount: number; transportationCost: number | null }>;
  serviceLevelSummary?: Array<{ serviceLevel: string; shipmentCount: number }>;
  skuSummary?: { distinctSkuCount: number; shipmentCountBySku: Array<{ itemId: string; shipmentCount: number }> } | null;
  deferredValidation: string[];
};

export function runSupplyChainDesignModel01Proof(
  input: SupplyChainDesignModel01ProofInput
): SupplyChainDesignModel01ProofResult {
  const normalizedInput = input.currentNetworkActivity ? normalizeCurrentNetworkActivityInput(input) : input;
  const facilities = readMappedRows(normalizedInput.facilities, ["facility_id", "facility_name"]);
  const shipments = readMappedRows(normalizedInput.shipments, ["origin_facility_id"]);
  const inventory = normalizedInput.inventory ? readMappedRows(normalizedInput.inventory, ["facility_id", "item_id", "quantity"]) : null;
  const facilityCosts = normalizedInput.facilityCosts
    ? readMappedRows(normalizedInput.facilityCosts, ["facility_id", "cost_category", "annual_cost"])
    : null;
  const customers = normalizedInput.customers
    ? readMappedRows(normalizedInput.customers, ["customer_id", "customer_name", "city", "country"])
    : null;
  const shipmentCostColumn = getSourceColumn(normalizedInput.shipments.fieldMappings, "transportation_cost");
  const shipmentDestinationColumn = normalizedInput.customers ? getSourceColumn(normalizedInput.shipments.fieldMappings, "destination_id") : null;
  const serviceDaysColumn = getSourceColumn(normalizedInput.shipments.fieldMappings, "service_days");
  const shipmentQuantityColumn = getSourceColumn(normalizedInput.shipments.fieldMappings, "shipment_quantity");
  const palletsColumn = getSourceColumn(normalizedInput.shipments.fieldMappings, "pallets");
  const unitsColumn = getSourceColumn(normalizedInput.shipments.fieldMappings, "units");
  const weightColumn = getSourceColumn(normalizedInput.shipments.fieldMappings, "weight");
  const currencyColumn = getSourceColumn(normalizedInput.shipments.fieldMappings, "currency");
  const modeColumn = getSourceColumn(normalizedInput.shipments.fieldMappings, "mode");
  const serviceLevelColumn = getSourceColumn(normalizedInput.shipments.fieldMappings, "service_level");
  const itemColumn = getSourceColumn(normalizedInput.shipments.fieldMappings, "item_id");
  const inventoryUnitCostColumn = normalizedInput.inventory ? getSourceColumn(normalizedInput.inventory.fieldMappings, "unit_cost") : null;
  const inventoryPalletsColumn = normalizedInput.inventory ? getSourceColumn(normalizedInput.inventory.fieldMappings, "inventory_pallets") : null;
  const inventorySnapshotDateColumn = normalizedInput.inventory ? getSourceColumn(normalizedInput.inventory.fieldMappings, "snapshot_date") : null;
  const facilityCapacityColumn = getSourceColumn(normalizedInput.facilities.fieldMappings, "capacity");
  const facilityPalletCapacityColumn = getSourceColumn(normalizedInput.facilities.fieldMappings, "pallet_capacity");
  const facilityTypeColumn = getSourceColumn(normalizedInput.facilities.fieldMappings, "facility_type");
  const facilityAnnualCostColumn =
    getSourceColumn(normalizedInput.facilities.fieldMappings, "annual_facility_warehouse_cost") ??
    getSourceColumn(normalizedInput.facilities.fieldMappings, "annual_fixed_cost");
  const facilityCurrencyColumn = getSourceColumn(normalizedInput.facilities.fieldMappings, "currency");
  const facilityInventoryPalletsColumn = getSourceColumn(normalizedInput.facilities.fieldMappings, "current_inventory_pallets");
  const facilityInventoryUnitsColumn = getSourceColumn(normalizedInput.facilities.fieldMappings, "current_inventory_units");
  const facilityInventoryValueColumn = getSourceColumn(normalizedInput.facilities.fieldMappings, "current_inventory_value");
  const facilityCostCurrencyColumn = normalizedInput.facilityCosts ? getSourceColumn(normalizedInput.facilityCosts.fieldMappings, "currency") : null;
  const annualDemandColumn = normalizedInput.customers ? getSourceColumn(normalizedInput.customers.fieldMappings, "annual_demand") : null;
  const activityWarnings = input.currentNetworkActivity ? getActivityWarnings(normalizedInput) : [];
  const facilityIds = new Set<string>();
  const facilityNames = new Map<string, string>();
  const facilityTypes = new Map<string, string>();
  const facilityCapacities = new Map<string, number>();
  const customerIds = new Set<string>();
  const customerNames = new Map<string, string>();

  if (input.customers && !shipmentDestinationColumn) {
    throw new Error("SHIPMENTS mapping is missing required field destination_id for customer destination analysis.");
  }

  for (const row of facilities.rows) {
    const facilityId = requiredValue(row, facilities.columnIndexes, "facility_id", "FACILITIES");
    const facilityName = requiredValue(row, facilities.columnIndexes, "facility_name", "FACILITIES");
    facilityIds.add(facilityId);
    facilityNames.set(facilityId, facilityName);
    if (facilityTypeColumn) {
      const facilityType = valueAt(row, facilities.columnIndexes, "facility_type").trim();
      if (facilityType) facilityTypes.set(facilityId, facilityType);
    }
    if (facilityCapacityColumn) {
      const rawCapacity = valueAt(row, facilities.columnIndexes, "capacity").trim();
      if (rawCapacity) {
        const capacity = parseNumber(rawCapacity, "FACILITIES capacity");
        if (capacity <= 0) {
          throw new Error("FACILITIES capacity must be greater than zero when pallet utilization is calculated.");
        }
        facilityCapacities.set(facilityId, capacity);
      }
    }
    if (facilityPalletCapacityColumn) {
      const rawCapacity = valueAt(row, facilities.columnIndexes, "pallet_capacity").trim();
      if (rawCapacity) {
        const capacity = parseNumber(rawCapacity, "FACILITIES pallet_capacity");
        if (capacity <= 0) {
          throw new Error("FACILITIES pallet_capacity must be greater than zero when pallet utilization is calculated.");
        }
        facilityCapacities.set(facilityId, capacity);
      }
    }
  }

  let totalTransportationCost = 0;
  const shipmentCountByOrigin = new Map<string, number>();
  const transportationCostByOrigin = new Map<string, number>();
  const unmatchedShipmentOriginIds = new Set<string>();
  let totalInventoryQuantity = 0;
  let totalInventoryValue = 0;
  const inventoryQuantityByFacility = new Map<string, number>();
  const inventoryValueByFacility = new Map<string, number>();
  const unmatchedInventoryFacilityIds = new Set<string>();
  let totalFacilityOperatingCost = 0;
  const facilityOperatingCostByFacility = new Map<string, number>();
  const facilityOperatingCostByCategory = new Map<string, number>();
  const unmatchedFacilityCostFacilityIds = new Set<string>();
  let totalAnnualCustomerDemand = 0;
  const annualDemandByCustomer = new Map<string, number>();
  const shipmentCountByDestination = new Map<string, number>();
  const transportationCostByDestination = new Map<string, number>();
  const laneShipmentCounts = new Map<string, number>();
  const transportationCostByLane = new Map<string, number>();
  const unmatchedShipmentDestinationIds = new Set<string>();
  let serviceDaysTotal = 0;
  let serviceDaysCount = 0;
  let totalShipmentQuantity = 0;
  let totalPallets = 0;
  let totalUnits = 0;
  let totalWeight = 0;
  const currencyWarnings: string[] = [];
  const transportationCostByCurrency = new Map<string, number>();
  const shipmentQuantityByCurrency = new Map<string, number>();
  const palletsByCurrency = new Map<string, number>();
  const unitsByCurrency = new Map<string, number>();
  const weightByCurrency = new Map<string, number>();
  const palletsByFacility = new Map<string, number>();
  const unitsByFacility = new Map<string, number>();
  const weightByFacility = new Map<string, number>();
  const facilityCostByCurrency = new Map<string, number>();
  let snapshotPalletUtilization: SupplyChainDesignModel01ProofResult["snapshotPalletUtilization"] = [];
  const modeShipments = new Map<string, number>();
  const modeCosts = new Map<string, number>();
  const serviceLevelShipments = new Map<string, number>();
  const shipmentCountBySku = new Map<string, number>();
  const serviceDaysByDestination = new Map<string, { total: number; count: number }>();
  const serviceDaysByLane = new Map<string, { total: number; count: number }>();
  const facilityInventoryPalletSnapshots = new Map<
    string,
    { facilityId: string; itemId: string; snapshotDate: string; inventoryPallets: number }
  >();

  for (const row of facilities.rows) {
    const facilityId = requiredValue(row, facilities.columnIndexes, "facility_id", "FACILITIES");
    if (facilityAnnualCostColumn) {
      const rawAnnualCost = valueAt(row, facilities.columnIndexes, "annual_facility_warehouse_cost").trim() ||
        valueAt(row, facilities.columnIndexes, "annual_fixed_cost").trim();
      if (rawAnnualCost) {
        const annualCost = parseNumber(rawAnnualCost, "FACILITIES annual_facility_warehouse_cost");
        totalFacilityOperatingCost += annualCost;
        facilityOperatingCostByFacility.set(facilityId, (facilityOperatingCostByFacility.get(facilityId) ?? 0) + annualCost);
        facilityOperatingCostByCategory.set(
          "Annual facility and warehouse cost",
          (facilityOperatingCostByCategory.get("Annual facility and warehouse cost") ?? 0) + annualCost
        );
        if (facilityCurrencyColumn) {
          const currency = valueAt(row, facilities.columnIndexes, "currency").trim();
          if (currency) {
            facilityCostByCurrency.set(currency, (facilityCostByCurrency.get(currency) ?? 0) + annualCost);
          } else {
            currencyWarnings.push(`${facilityId} has annual facility/warehouse cost but no currency.`);
          }
        }
      }
    }
    if (facilityInventoryUnitsColumn) {
      const units = parseOptionalNumber(valueAt(row, facilities.columnIndexes, "current_inventory_units"), "FACILITIES current_inventory_units");
      if (units !== null) {
        totalInventoryQuantity += units;
        inventoryQuantityByFacility.set(facilityId, (inventoryQuantityByFacility.get(facilityId) ?? 0) + units);
      }
    }
    if (facilityInventoryValueColumn) {
      const value = parseOptionalNumber(valueAt(row, facilities.columnIndexes, "current_inventory_value"), "FACILITIES current_inventory_value");
      if (value !== null) {
        totalInventoryValue += value;
        inventoryValueByFacility.set(facilityId, (inventoryValueByFacility.get(facilityId) ?? 0) + value);
      }
    }
    if (facilityInventoryPalletsColumn) {
      const inventoryPallets = parseOptionalNumber(valueAt(row, facilities.columnIndexes, "current_inventory_pallets"), "FACILITIES current_inventory_pallets");
      if (inventoryPallets !== null) {
        facilityInventoryPalletSnapshots.set(`${facilityId}\u001fCURRENT\u001fCURRENT_INVENTORY`, {
          facilityId,
          itemId: "CURRENT_INVENTORY",
          snapshotDate: "Current baseline",
          inventoryPallets
        });
      }
    }
  }

  if (customers) {
    for (const row of customers.rows) {
      const customerId = requiredValue(row, customers.columnIndexes, "customer_id", "CUSTOMERS");
      const customerName = requiredValue(row, customers.columnIndexes, "customer_name", "CUSTOMERS");
      requiredValue(row, customers.columnIndexes, "city", "CUSTOMERS");
      requiredValue(row, customers.columnIndexes, "country", "CUSTOMERS");
      customerIds.add(customerId);
      customerNames.set(customerId, customerName);

      if (annualDemandColumn) {
        const rawAnnualDemand = valueAt(row, customers.columnIndexes, "annual_demand").trim();
        if (rawAnnualDemand) {
          const annualDemand = parseNumber(rawAnnualDemand, "CUSTOMERS annual_demand");
          totalAnnualCustomerDemand += annualDemand;
          annualDemandByCustomer.set(customerId, annualDemand);
        }
      }
    }
  }

  for (const row of shipments.rows) {
    const shipmentId =
      valueAt(row, shipments.columnIndexes, "shipment_id").trim() ||
      valueAt(row, shipments.columnIndexes, "shipment_reference").trim() ||
      `SHIPMENT-${String(totalShipmentQuantity + 1).padStart(5, "0")}`;
    const originFacilityId = requiredValue(row, shipments.columnIndexes, "origin_facility_id", "SHIPMENTS");
    const shipmentQuantity = shipmentQuantityColumn
      ? parseOptionalPositiveNumber(valueAt(row, shipments.columnIndexes, "shipment_quantity"), "SHIPMENTS shipment_quantity") ?? 1
      : 1;
    totalShipmentQuantity += shipmentQuantity;
    const destinationId = customers
      ? requiredValue(row, shipments.columnIndexes, "destination_id", "SHIPMENTS")
      : null;
    const laneKey = destinationId ? makeLaneKey(originFacilityId, destinationId) : null;

    shipmentCountByOrigin.set(originFacilityId, (shipmentCountByOrigin.get(originFacilityId) ?? 0) + shipmentQuantity);
    if (destinationId) {
      shipmentCountByDestination.set(destinationId, (shipmentCountByDestination.get(destinationId) ?? 0) + shipmentQuantity);
      laneShipmentCounts.set(laneKey ?? "", (laneShipmentCounts.get(laneKey ?? "") ?? 0) + shipmentQuantity);

      if (!customerIds.has(destinationId)) {
        unmatchedShipmentDestinationIds.add(destinationId);
      }
    }

    if (!facilityIds.has(originFacilityId)) {
      unmatchedShipmentOriginIds.add(originFacilityId);
    }

    if (shipmentCostColumn) {
      const rawCost = valueAt(row, shipments.columnIndexes, "transportation_cost").trim();
      if (!rawCost) {
        throw new Error("SHIPMENTS transportation_cost is blank in a row used by the proof run.");
      }
      const cost = parseNumber(rawCost, "SHIPMENTS transportation_cost");
      if (currencyColumn && !valueAt(row, shipments.columnIndexes, "currency").trim()) {
        currencyWarnings.push(`Shipment ${shipmentId} has transportation cost but no currency.`);
      }
      if (currencyColumn) {
        const currency = valueAt(row, shipments.columnIndexes, "currency").trim();
        if (currency) {
          transportationCostByCurrency.set(currency, (transportationCostByCurrency.get(currency) ?? 0) + cost);
          shipmentQuantityByCurrency.set(currency, (shipmentQuantityByCurrency.get(currency) ?? 0) + shipmentQuantity);
        }
      }
      totalTransportationCost += cost;
      transportationCostByOrigin.set(originFacilityId, (transportationCostByOrigin.get(originFacilityId) ?? 0) + cost);
      if (destinationId) {
        transportationCostByDestination.set(
          destinationId,
          (transportationCostByDestination.get(destinationId) ?? 0) + cost
        );
        transportationCostByLane.set(laneKey ?? "", (transportationCostByLane.get(laneKey ?? "") ?? 0) + cost);
      }
    }

    const pallets = parseOptionalNumber(valueAt(row, shipments.columnIndexes, "pallets"), "SHIPMENTS pallets");
    const units = parseOptionalNumber(valueAt(row, shipments.columnIndexes, "units"), "SHIPMENTS units");
    const weight = parseOptionalNumber(valueAt(row, shipments.columnIndexes, "weight"), "SHIPMENTS weight");
    if (pallets !== null) {
      totalPallets += pallets;
      palletsByFacility.set(originFacilityId, (palletsByFacility.get(originFacilityId) ?? 0) + pallets);
    }
    if (units !== null) {
      totalUnits += units;
      unitsByFacility.set(originFacilityId, (unitsByFacility.get(originFacilityId) ?? 0) + units);
    }
    if (weight !== null) {
      totalWeight += weight;
      weightByFacility.set(originFacilityId, (weightByFacility.get(originFacilityId) ?? 0) + weight);
    }
    if (currencyColumn) {
      const currency = valueAt(row, shipments.columnIndexes, "currency").trim();
      if (currency) {
        if (pallets !== null) palletsByCurrency.set(currency, (palletsByCurrency.get(currency) ?? 0) + pallets);
        if (units !== null) unitsByCurrency.set(currency, (unitsByCurrency.get(currency) ?? 0) + units);
        if (weight !== null) weightByCurrency.set(currency, (weightByCurrency.get(currency) ?? 0) + weight);
      }
    }
    if (modeColumn) {
      const mode = valueAt(row, shipments.columnIndexes, "mode").trim();
      if (mode) {
        modeShipments.set(mode, (modeShipments.get(mode) ?? 0) + shipmentQuantity);
        if (shipmentCostColumn) {
          modeCosts.set(mode, (modeCosts.get(mode) ?? 0) + parseNumber(valueAt(row, shipments.columnIndexes, "transportation_cost"), "SHIPMENTS transportation_cost"));
        }
      }
    }
    if (serviceLevelColumn) {
      const serviceLevel = valueAt(row, shipments.columnIndexes, "service_level").trim();
      if (serviceLevel) {
        serviceLevelShipments.set(serviceLevel, (serviceLevelShipments.get(serviceLevel) ?? 0) + shipmentQuantity);
      }
    }
    if (itemColumn) {
      const itemId = valueAt(row, shipments.columnIndexes, "item_id").trim();
      if (itemId) {
        shipmentCountBySku.set(itemId, (shipmentCountBySku.get(itemId) ?? 0) + shipmentQuantity);
      }
    }

    if (serviceDaysColumn) {
      const rawServiceDays = valueAt(row, shipments.columnIndexes, "service_days").trim();
      if (rawServiceDays) {
        const serviceDays = parseNumber(rawServiceDays, "SHIPMENTS service_days");
        serviceDaysTotal += serviceDays;
        serviceDaysCount += 1;
        if (destinationId) {
          addAverageValue(serviceDaysByDestination, destinationId, serviceDays);
          addAverageValue(serviceDaysByLane, laneKey ?? "", serviceDays);
        }
      }
    }
  }

  if (inventory && normalizedInput.inventory) {
    const inventoryPalletSnapshots = new Map<
      string,
      { facilityId: string; itemId: string; snapshotDate: string; inventoryPallets: number }
    >();
    for (const row of inventory.rows) {
      const facilityId = requiredValue(row, inventory.columnIndexes, "facility_id", "INVENTORY");
      const itemId = requiredValue(row, inventory.columnIndexes, "item_id", "INVENTORY");
      const rawQuantity = requiredValue(row, inventory.columnIndexes, "quantity", "INVENTORY");
      const quantity = parseNumber(rawQuantity, "INVENTORY quantity");

      totalInventoryQuantity += quantity;
      inventoryQuantityByFacility.set(facilityId, (inventoryQuantityByFacility.get(facilityId) ?? 0) + quantity);

      if (!facilityIds.has(facilityId)) {
        unmatchedInventoryFacilityIds.add(facilityId);
      }

      if (inventoryUnitCostColumn) {
        const rawUnitCost = valueAt(row, inventory.columnIndexes, "unit_cost").trim();
        if (!rawUnitCost) {
          throw new Error("INVENTORY unit_cost is blank in a row used by the proof run.");
        }
        const rowValue = quantity * parseNumber(rawUnitCost, "INVENTORY unit_cost");
        totalInventoryValue += rowValue;
        inventoryValueByFacility.set(facilityId, (inventoryValueByFacility.get(facilityId) ?? 0) + rowValue);
      }
      if (inventoryPalletsColumn && inventorySnapshotDateColumn) {
        const rawPallets = valueAt(row, inventory.columnIndexes, "inventory_pallets").trim();
        const snapshotDate = valueAt(row, inventory.columnIndexes, "snapshot_date").trim();
        if (rawPallets && snapshotDate) {
          if (Number.isNaN(Date.parse(snapshotDate))) {
            throw new Error(`INVENTORY snapshot_date value "${snapshotDate}" is not a valid date.`);
          }
          const inventoryPallets = parseNumber(rawPallets, "INVENTORY inventory_pallets");
          if (inventoryPallets < 0) {
            throw new Error("INVENTORY inventory_pallets cannot be negative.");
          }
          const snapshotKey = `${facilityId}\u001f${snapshotDate}\u001f${itemId}`;
          const existing = inventoryPalletSnapshots.get(snapshotKey);
          if (!existing) {
            inventoryPalletSnapshots.set(snapshotKey, { facilityId, itemId, snapshotDate, inventoryPallets });
          } else if (existing.inventoryPallets !== inventoryPallets) {
            currencyWarnings.push(
              `Conflicting inventory pallet snapshot for ${facilityId}/${snapshotDate}/${itemId}: ${existing.inventoryPallets} and ${inventoryPallets}.`
            );
          }
        }
      }
    }
    snapshotPalletUtilization = buildSnapshotUtilization(
      inventoryPalletSnapshots,
      facilityCapacities,
      facilityNames,
      facilityTypes
    );
  }
  if (facilityInventoryPalletSnapshots.size > 0) {
    snapshotPalletUtilization = buildSnapshotUtilization(
      facilityInventoryPalletSnapshots,
      facilityCapacities,
      facilityNames,
      facilityTypes
    );
  }

  if (facilityCosts) {
    for (const row of facilityCosts.rows) {
      const facilityId = requiredValue(row, facilityCosts.columnIndexes, "facility_id", "FACILITY_COSTS");
      const costCategory = requiredValue(row, facilityCosts.columnIndexes, "cost_category", "FACILITY_COSTS");
      const annualCost = parseNumber(
        requiredValue(row, facilityCosts.columnIndexes, "annual_cost", "FACILITY_COSTS"),
        "FACILITY_COSTS annual_cost"
      );

      totalFacilityOperatingCost += annualCost;
      if (facilityCostCurrencyColumn) {
        const currency = valueAt(row, facilityCosts.columnIndexes, "currency").trim();
        if (currency) {
          facilityCostByCurrency.set(currency, (facilityCostByCurrency.get(currency) ?? 0) + annualCost);
        } else {
          currencyWarnings.push(`${facilityId} ${costCategory} has facility cost but no currency.`);
        }
      }
      facilityOperatingCostByFacility.set(
        facilityId,
        (facilityOperatingCostByFacility.get(facilityId) ?? 0) + annualCost
      );
      facilityOperatingCostByCategory.set(
        costCategory,
        (facilityOperatingCostByCategory.get(costCategory) ?? 0) + annualCost
      );

      if (!facilityIds.has(facilityId)) {
        unmatchedFacilityCostFacilityIds.add(facilityId);
      }
    }
  }

  const facilitySummary = [...facilityNames.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([facilityId, facilityName]) => ({
      facilityId,
      facilityName,
      facilityType: facilityTypes.get(facilityId) ?? null,
      shipmentCount: shipmentCountByOrigin.get(facilityId) ?? 0,
      pallets: palletsColumn ? palletsByFacility.get(facilityId) ?? 0 : null,
      units: unitsColumn ? unitsByFacility.get(facilityId) ?? 0 : null,
      weight: weightColumn ? weightByFacility.get(facilityId) ?? 0 : null,
      transportationCost: shipmentCostColumn ? transportationCostByOrigin.get(facilityId) ?? 0 : null,
      inventoryQuantity: inventory || facilityInventoryUnitsColumn ? inventoryQuantityByFacility.get(facilityId) ?? 0 : null,
      inventoryValue: inventoryUnitCostColumn || facilityInventoryValueColumn ? inventoryValueByFacility.get(facilityId) ?? 0 : null,
      facilityOperatingCost:
        facilityCosts || facilityAnnualCostColumn ? facilityOperatingCostByFacility.get(facilityId) ?? 0 : null,
      observedCost:
        shipmentCostColumn || facilityCosts || facilityAnnualCostColumn
          ? (shipmentCostColumn ? transportationCostByOrigin.get(facilityId) ?? 0 : 0) +
            (facilityCosts || facilityAnnualCostColumn ? facilityOperatingCostByFacility.get(facilityId) ?? 0 : 0)
          : null
    }));

  return {
    facilityCount: facilities.rows.length,
    shipmentCount: totalShipmentQuantity,
    hasTransportationCost: Boolean(shipmentCostColumn),
    totalTransportationCost: shipmentCostColumn ? totalTransportationCost : null,
    shipmentCountByOrigin: sortCounts(shipmentCountByOrigin),
    transportationCostByOrigin: shipmentCostColumn ? sortCosts(transportationCostByOrigin) : null,
    unmatchedShipmentOriginIds: [...unmatchedShipmentOriginIds].sort(),
    hasInventory: Boolean(inventory) || Boolean(facilityInventoryUnitsColumn),
    inventoryQuantity: inventory || facilityInventoryUnitsColumn ? totalInventoryQuantity : null,
    inventoryQuantityByFacility: inventory || facilityInventoryUnitsColumn ? sortInventoryQuantities(inventoryQuantityByFacility) : null,
    hasInventoryValue: Boolean(inventoryUnitCostColumn) || Boolean(facilityInventoryValueColumn),
    inventoryValue: inventoryUnitCostColumn || facilityInventoryValueColumn ? totalInventoryValue : null,
    inventoryValueByFacility: inventoryUnitCostColumn || facilityInventoryValueColumn ? sortInventoryValues(inventoryValueByFacility) : null,
    unmatchedInventoryFacilityIds: [...unmatchedInventoryFacilityIds].sort(),
    hasFacilityCosts: Boolean(facilityCosts) || Boolean(facilityAnnualCostColumn),
    totalFacilityOperatingCost: facilityCosts || facilityAnnualCostColumn ? totalFacilityOperatingCost : null,
    facilityOperatingCostByFacility: facilityCosts || facilityAnnualCostColumn ? sortFacilityCosts(facilityOperatingCostByFacility) : null,
    facilityOperatingCostByCategory: facilityCosts || facilityAnnualCostColumn ? sortFacilityCostCategories(facilityOperatingCostByCategory) : null,
    unmatchedFacilityCostFacilityIds: [...unmatchedFacilityCostFacilityIds].sort(),
    hasCustomers: Boolean(customers),
    customerCount: customers ? customers.rows.length : null,
    shipmentCountByDestination: customers ? sortDestinationCounts(shipmentCountByDestination) : null,
    transportationCostByDestination:
      customers && shipmentCostColumn ? sortDestinationCosts(transportationCostByDestination) : null,
    laneShipmentCounts: customers ? sortLaneCounts(laneShipmentCounts) : null,
    transportationCostByLane: customers && shipmentCostColumn ? sortLaneCosts(transportationCostByLane) : null,
    unmatchedShipmentDestinationIds: [...unmatchedShipmentDestinationIds].sort(),
    hasCustomerDemand: Boolean(annualDemandColumn),
    totalAnnualCustomerDemand: annualDemandColumn ? totalAnnualCustomerDemand : null,
    annualDemandByCustomer: annualDemandColumn ? sortCustomerDemand(annualDemandByCustomer) : null,
    hasServiceDays: Boolean(serviceDaysColumn),
    averageServiceDays: serviceDaysColumn && serviceDaysCount > 0 ? serviceDaysTotal / serviceDaysCount : null,
    averageServiceDaysByDestination:
      customers && serviceDaysColumn ? sortDestinationAverages(serviceDaysByDestination) : null,
    averageServiceDaysByLane: customers && serviceDaysColumn ? sortLaneAverages(serviceDaysByLane) : null,
    networkLanes: customers
      ? sortNetworkLanes(laneShipmentCounts, {
          facilityNames,
          customerNames,
          transportationCostByLane,
          serviceDaysByLane,
          hasTransportationCost: Boolean(shipmentCostColumn),
          hasServiceDays: Boolean(serviceDaysColumn)
        })
      : null,
    facilitySummary,
    analysisLevels: buildAnalysisLevels({
      hasCustomers: Boolean(customers),
      hasTransportationCost: Boolean(shipmentCostColumn),
      hasInventory: Boolean(inventory) || Boolean(facilityInventoryUnitsColumn),
      hasInventoryValue: Boolean(inventoryUnitCostColumn) || Boolean(facilityInventoryValueColumn),
      hasFacilityCosts: Boolean(facilityCosts) || Boolean(facilityAnnualCostColumn),
      hasServiceDays: Boolean(serviceDaysColumn)
    }),
    facilityDataWarnings: activityWarnings,
    volumeSummary: {
      totalShipments: totalShipmentQuantity,
      totalPallets: palletsColumn ? totalPallets : null,
      totalUnits: unitsColumn ? totalUnits : null,
      totalWeight: weightColumn ? totalWeight : null,
      averagePalletsPerShipment: palletsColumn ? divideOrNull(totalPallets, totalShipmentQuantity) : null,
      averageUnitsPerShipment: unitsColumn ? divideOrNull(totalUnits, totalShipmentQuantity) : null,
      averageWeightPerShipment: weightColumn ? divideOrNull(totalWeight, totalShipmentQuantity) : null,
      transportationCostPerShipment: shipmentCostColumn ? divideOrNull(totalTransportationCost, totalShipmentQuantity) : null,
      transportationCostPerPallet: shipmentCostColumn && palletsColumn ? divideOrNull(totalTransportationCost, totalPallets) : null,
      transportationCostPerUnit: shipmentCostColumn && unitsColumn ? divideOrNull(totalTransportationCost, totalUnits) : null,
      transportationCostPerPound: shipmentCostColumn && weightColumn ? divideOrNull(totalTransportationCost, totalWeight) : null
    },
    currencyWarnings,
    transportationCostByCurrency: sortCurrencyCosts(transportationCostByCurrency, "transportationCost"),
    facilityCostByCurrency: sortCurrencyCosts(facilityCostByCurrency, "facilityOperatingCost"),
    observedNetworkCostByCurrency: sortObservedCostsByCurrency(transportationCostByCurrency, facilityCostByCurrency),
    snapshotPalletUtilization,
    modeSummary: modeColumn ? sortModeSummary(modeShipments, modeCosts, Boolean(shipmentCostColumn)) : [],
    serviceLevelSummary: serviceLevelColumn ? sortServiceLevelSummary(serviceLevelShipments) : [],
    skuSummary:
      itemColumn && shipmentCountBySku.size > 0
        ? {
            distinctSkuCount: shipmentCountBySku.size,
            shipmentCountBySku: sortSkuCounts(shipmentCountBySku)
          }
        : null,
    deferredValidation: [
      "Full row-level validation framework",
      "Date, location, unit, and currency normalization",
      "Duplicate business-key detection",
      "Full Model 01 cost categories",
      "Currency conversion, inflation adjustments, and cost-period normalization",
      "Cost allocation, inventory, service, capacity, and optimization rules",
      "Customer normalization, fuzzy matching, geocoding, duplicate handling, and advanced destination validation"
    ]
  };
}

function normalizeCurrentNetworkActivityInput(
  input: SupplyChainDesignModel01ProofInput
): SupplyChainDesignModel01ProofInput & { __activityWarnings?: string[] } {
  const activity = input.currentNetworkActivity!;
  const activityRows = readActivityRows(activity, ["origin_facility_id", "facility_name"]);
  const hasDestination =
    hasActivityField(activityRows, "destination_id") ||
    hasActivityField(activityRows, "postal_or_region_code") ||
    hasActivityField(activityRows, "destination_label");
  const hasInventory = hasActivityField(activityRows, "quantity") || hasActivityField(activityRows, "inventory_pallets");
  const hasInventoryValue = hasActivityField(activityRows, "inventory_value_total");
  const warnings: string[] = [];

  const facilities = new Map<string, Record<string, string>>();
  const customers = new Map<string, Record<string, string>>();
  const facilityRows: Record<string, string>[] = [];
  const shipmentRows: Record<string, string>[] = [];
  const inventoryRows: Record<string, string>[] = [];

  for (const row of activityRows.rows) {
    const rawShipmentReference = activityValue(row, activityRows.columnIndexes, "shipment_reference");
    const shipmentQuantity = activityValue(row, activityRows.columnIndexes, "shipment_quantity");
    const recordType = activityValue(row, activityRows.columnIndexes, "record_type");
    validateActivityRecordType(recordType, rawShipmentReference, shipmentQuantity);
    const shipmentReference = rawShipmentReference || `ACTIVITY-${String(shipmentRows.length + 1).padStart(5, "0")}`;
    const facilityId = requiredActivityValue(row, activityRows.columnIndexes, "origin_facility_id");
    const facilityName = requiredActivityValue(row, activityRows.columnIndexes, "facility_name");
    const facilityRecord = {
      facility_id: facilityId,
      facility_name: facilityName,
      facility_type: activityValue(row, activityRows.columnIndexes, "facility_type"),
      postal_code: activityValue(row, activityRows.columnIndexes, "postal_code"),
      country: activityValue(row, activityRows.columnIndexes, "country"),
      capacity: activityValue(row, activityRows.columnIndexes, "facility_capacity_pallet_positions")
    };
    upsertDedupeRecord(facilities, facilityId, facilityRecord, "facility", warnings);

    const destinationId = hasDestination ? deriveActivityDestinationId(row, activityRows.columnIndexes) : "";
    shipmentRows.push({
      shipment_id: shipmentReference,
      origin_facility_id: facilityId,
      destination_id: destinationId,
      shipment_quantity: shipmentQuantity,
      pallets: activityValue(row, activityRows.columnIndexes, "pallets"),
      units: activityValue(row, activityRows.columnIndexes, "units"),
      weight: activityValue(row, activityRows.columnIndexes, "weight"),
      transportation_cost: activityValue(row, activityRows.columnIndexes, "transportation_cost"),
      service_days: activityValue(row, activityRows.columnIndexes, "service_days"),
      mode: activityValue(row, activityRows.columnIndexes, "mode"),
      service_level: activityValue(row, activityRows.columnIndexes, "service_level"),
      item_id: activityValue(row, activityRows.columnIndexes, "item_id"),
      currency: activityValue(row, activityRows.columnIndexes, "currency")
    });

    if (hasDestination && destinationId) {
      const destinationLabel =
        activityValue(row, activityRows.columnIndexes, "destination_label") ||
        activityValue(row, activityRows.columnIndexes, "destination_id") ||
        activityValue(row, activityRows.columnIndexes, "postal_or_region_code") ||
        destinationId;
      upsertDedupeRecord(
        customers,
        destinationId,
        {
          customer_id: destinationId,
          customer_name: destinationLabel,
          city: destinationLabel,
          country: activityValue(row, activityRows.columnIndexes, "country") || "Unspecified"
        },
        "destination/customer",
        warnings
      );
    }

    if (hasInventory) {
      const quantity =
        activityValue(row, activityRows.columnIndexes, "quantity") ||
        activityValue(row, activityRows.columnIndexes, "inventory_pallets");
      if (quantity) {
        const inventoryValue = activityValue(row, activityRows.columnIndexes, "inventory_value_total");
        const unitCost = inventoryValue ? String(parseNumber(inventoryValue, "CURRENT_NETWORK_ACTIVITY inventory_value_total") / parseNumber(quantity, "CURRENT_NETWORK_ACTIVITY quantity")) : "";
        inventoryRows.push({
          facility_id: facilityId,
          item_id: activityValue(row, activityRows.columnIndexes, "item_id") || "UNSPECIFIED",
          quantity,
          inventory_pallets: activityValue(row, activityRows.columnIndexes, "inventory_pallets"),
          unit_cost: unitCost,
          snapshot_date: activityValue(row, activityRows.columnIndexes, "snapshot_date")
        });
      }
    }

  }

  facilityRows.push(...[...facilities.values()]);

  return {
    ...input,
    facilities: mappedFileFromRows(activity, "FACILITIES", ["facility_id", "facility_name", "facility_type", "postal_code", "country", "capacity"], facilityRows),
    shipments: mappedFileFromRows(
      activity,
      "SHIPMENTS",
      [
        "shipment_id",
        "origin_facility_id",
        ...(hasDestination ? ["destination_id"] : []),
        ...(hasActivityField(activityRows, "shipment_quantity") ? ["shipment_quantity"] : []),
        ...(hasActivityField(activityRows, "pallets") ? ["pallets"] : []),
        ...(hasActivityField(activityRows, "units") ? ["units"] : []),
        ...(hasActivityField(activityRows, "weight") ? ["weight"] : []),
        ...(hasActivityField(activityRows, "transportation_cost") ? ["transportation_cost"] : []),
        ...(hasActivityField(activityRows, "service_days") ? ["service_days"] : []),
        ...(hasActivityField(activityRows, "mode") ? ["mode"] : []),
        ...(hasActivityField(activityRows, "service_level") ? ["service_level"] : []),
        ...(hasActivityField(activityRows, "item_id") ? ["item_id"] : []),
        ...(hasActivityField(activityRows, "currency") ? ["currency"] : [])
      ],
      shipmentRows
    ),
    customers: hasDestination
      ? mappedFileFromRows(activity, "CUSTOMERS", ["customer_id", "customer_name", "city", "country"], [...customers.values()])
      : null,
    inventory:
      hasInventory && inventoryRows.length > 0
        ? mappedFileFromRows(
            activity,
            "INVENTORY",
            [
              "facility_id",
              "item_id",
              "quantity",
              ...(hasActivityField(activityRows, "inventory_pallets") ? ["inventory_pallets"] : []),
              ...(hasInventoryValue ? ["unit_cost"] : []),
              "snapshot_date"
            ],
            inventoryRows
          )
        : null,
    facilityCosts: input.facilityCosts ?? null,
    __activityWarnings: warnings
  };
}

function getActivityWarnings(input: SupplyChainDesignModel01ProofInput & { __activityWarnings?: string[] }) {
  return input.__activityWarnings ?? [];
}

function readActivityRows(file: SupplyChainDesignMappedFile, requiredFields: string[]) {
  const rows = parseCsvRows(file.fileBytes.toString("utf8").replace(/^\uFEFF/, ""));
  const headers = rows[0]?.map((header) => header.trim()) ?? [];
  const dataRows = rows.slice(1).filter((row) => row.some((value) => value.trim()));
  const columnIndexes = new Map<string, number>();

  for (const field of file.fieldMappings) {
    if (!field.sourceColumn) continue;
    const index = headers.indexOf(field.sourceColumn);
    if (index === -1) {
      throw new Error(`CURRENT_NETWORK_ACTIVITY mapped source column "${field.sourceColumn}" was not found in the CSV headers.`);
    }
    columnIndexes.set(field.standardField, index);
  }

  for (const requiredField of requiredFields) {
    if (!columnIndexes.has(requiredField)) {
      throw new Error(`CURRENT_NETWORK_ACTIVITY mapping is missing required field ${requiredField}.`);
    }
  }

  return { rows: dataRows, columnIndexes };
}

function hasActivityField(activityRows: { columnIndexes: Map<string, number> }, field: string) {
  return activityRows.columnIndexes.has(field);
}

function requiredActivityValue(row: string[], columnIndexes: Map<string, number>, field: string) {
  const value = activityValue(row, columnIndexes, field);
  if (!value) {
    throw new Error(`CURRENT_NETWORK_ACTIVITY ${field} is blank in a row used by the baseline.`);
  }
  return value;
}

function activityValue(row: string[], columnIndexes: Map<string, number>, field: string) {
  const index = columnIndexes.get(field);
  return typeof index === "number" ? (row[index] ?? "").trim() : "";
}

function deriveActivityDestinationId(row: string[], columnIndexes: Map<string, number>) {
  return (
    activityValue(row, columnIndexes, "destination_id") ||
    activityValue(row, columnIndexes, "postal_or_region_code") ||
    slugId(activityValue(row, columnIndexes, "destination_label")) ||
    ""
  );
}

function slugId(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized ? `DEST-${normalized}` : "";
}

function upsertDedupeRecord(
  records: Map<string, Record<string, string>>,
  key: string,
  next: Record<string, string>,
  label: string,
  warnings: string[]
) {
  const current = records.get(key);
  if (!current) {
    records.set(key, next);
    return;
  }

  for (const [field, value] of Object.entries(next)) {
    if (!value) continue;
    const existing = current[field] ?? "";
    if (!existing) {
      current[field] = value;
    } else if (existing !== value) {
      warnings.push(`Conflicting repeated ${label} value for ${key}: ${field} has "${existing}" and "${value}".`);
    }
  }
}

function mappedFileFromRows(
  source: SupplyChainDesignMappedFile,
  tableType: SupplyChainDesignTableType,
  fields: string[],
  rows: Array<Record<string, string>>
): SupplyChainDesignMappedFile {
  const csvRows = [fields, ...rows.map((row) => fields.map((field) => row[field] ?? ""))];
  return {
    fileId: source.fileId,
    mappingId: source.mappingId,
    tableType,
    fileBytes: Buffer.from(toCsv(csvRows)),
    fieldMappings: fields.map((field) => ({
      standardField: field,
      sourceColumn: field,
      requirement: "OPTIONAL"
    }))
  };
}

function toCsv(rows: string[][]) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function buildAnalysisLevels(options: {
  hasCustomers: boolean;
  hasTransportationCost: boolean;
  hasInventory: boolean;
  hasInventoryValue: boolean;
  hasFacilityCosts: boolean;
  hasServiceDays: boolean;
}) {
  return [
    {
      label: "Basic activity baseline",
      status: "AVAILABLE" as const,
      explanation: "Facilities, shipment/activity count, and volume by origin were calculated."
    },
    {
      label: "Geographic and lane baseline",
      status: options.hasCustomers ? ("AVAILABLE" as const) : ("NOT_CALCULATED" as const),
      explanation: options.hasCustomers
        ? "Destination/customer fields were supplied, so lanes and destination concentrations were calculated."
        : "Not calculated - destination/customer fields were not supplied."
    },
    {
      label: "Transportation-cost baseline",
      status: options.hasTransportationCost ? ("AVAILABLE" as const) : ("NOT_CALCULATED" as const),
      explanation: options.hasTransportationCost
        ? "Transportation cost was supplied and summed by facility, lane, and destination where available."
        : "Not calculated - transportation cost was not supplied."
    },
    {
      label: "Facility-cost baseline",
      status: options.hasFacilityCosts ? ("AVAILABLE" as const) : ("NOT_CALCULATED" as const),
      explanation: options.hasFacilityCosts
        ? "Facility or 3PL operating cost was supplied and included in observed current network cost."
        : "Not calculated - facility/warehouse cost data was not supplied."
    },
    {
      label: "Capacity/utilization baseline",
      status: options.hasInventory ? ("AVAILABLE" as const) : ("NOT_CALCULATED" as const),
      explanation: options.hasInventory
        ? "Inventory or occupancy quantity was supplied; capacity-unit interpretation remains limited to pallet-position compatibility."
        : "Not calculated - compatible inventory or occupancy data was not supplied."
    },
    {
      label: "Service baseline",
      status: options.hasServiceDays ? ("AVAILABLE" as const) : ("NOT_CALCULATED" as const),
      explanation: options.hasServiceDays
        ? "Transit/service days were supplied and averaged."
        : "Not calculated - transit days or service information was not supplied."
    }
  ];
}

export function getSourceColumn(fieldMappings: SupplyChainDesignFieldMapping[], standardField: string) {
  return fieldMappings.find((field) => field.standardField === standardField)?.sourceColumn ?? null;
}

function readMappedRows(file: SupplyChainDesignMappedFile, requiredFields: string[]) {
  const rows = parseCsvRows(file.fileBytes.toString("utf8").replace(/^\uFEFF/, ""));
  const headers = rows[0]?.map((header) => header.trim()) ?? [];
  const dataRows = rows.slice(1).filter((row) => row.some((value) => value.trim()));
  const columnIndexes = new Map<string, number>();

  for (const standardField of requiredFields) {
    const sourceColumn = getSourceColumn(file.fieldMappings, standardField);
    if (!sourceColumn) {
      throw new Error(`${file.tableType} mapping is missing required field ${standardField}.`);
    }

    const index = headers.indexOf(sourceColumn);
    if (index === -1) {
      throw new Error(`${file.tableType} mapped source column "${sourceColumn}" was not found in the CSV headers.`);
    }

    columnIndexes.set(standardField, index);
  }

  for (const field of file.fieldMappings) {
    if (!field.sourceColumn || columnIndexes.has(field.standardField)) continue;
    const index = headers.indexOf(field.sourceColumn);
    if (index === -1) {
      throw new Error(`${file.tableType} mapped source column "${field.sourceColumn}" was not found in the CSV headers.`);
    }
    columnIndexes.set(field.standardField, index);
  }

  const costColumn = getSourceColumn(file.fieldMappings, "transportation_cost");
  if (costColumn) {
    const index = headers.indexOf(costColumn);
    if (index === -1) {
      throw new Error(`${file.tableType} mapped source column "${costColumn}" was not found in the CSV headers.`);
    }
    columnIndexes.set("transportation_cost", index);
  }

  const unitCostColumn = getSourceColumn(file.fieldMappings, "unit_cost");
  if (unitCostColumn) {
    const index = headers.indexOf(unitCostColumn);
    if (index === -1) {
      throw new Error(`${file.tableType} mapped source column "${unitCostColumn}" was not found in the CSV headers.`);
    }
    columnIndexes.set("unit_cost", index);
  }

  const annualCostColumn = getSourceColumn(file.fieldMappings, "annual_cost");
  if (annualCostColumn) {
    const index = headers.indexOf(annualCostColumn);
    if (index === -1) {
      throw new Error(`${file.tableType} mapped source column "${annualCostColumn}" was not found in the CSV headers.`);
    }
    columnIndexes.set("annual_cost", index);
  }

  const annualDemandColumn = getSourceColumn(file.fieldMappings, "annual_demand");
  if (annualDemandColumn) {
    const index = headers.indexOf(annualDemandColumn);
    if (index === -1) {
      throw new Error(`${file.tableType} mapped source column "${annualDemandColumn}" was not found in the CSV headers.`);
    }
    columnIndexes.set("annual_demand", index);
  }

  const destinationColumn = getSourceColumn(file.fieldMappings, "destination_id");
  if (destinationColumn) {
    const index = headers.indexOf(destinationColumn);
    if (index === -1) {
      throw new Error(`${file.tableType} mapped source column "${destinationColumn}" was not found in the CSV headers.`);
    }
    columnIndexes.set("destination_id", index);
  }

  const serviceDaysColumn = getSourceColumn(file.fieldMappings, "service_days");
  if (serviceDaysColumn) {
    const index = headers.indexOf(serviceDaysColumn);
    if (index === -1) {
      throw new Error(`${file.tableType} mapped source column "${serviceDaysColumn}" was not found in the CSV headers.`);
    }
    columnIndexes.set("service_days", index);
  }

  return {
    rows: dataRows,
    columnIndexes
  };
}

function requiredValue(
  row: string[],
  columnIndexes: Map<string, number>,
  standardField: string,
  tableType: "FACILITIES" | "SHIPMENTS" | "INVENTORY" | "FACILITY_COSTS" | "CUSTOMERS"
) {
  const value = valueAt(row, columnIndexes, standardField).trim();
  if (!value) {
    throw new Error(`${tableType} ${standardField} is blank in a row used by the proof run.`);
  }
  return value;
}

function parseNumber(rawValue: string, label: string) {
  const parsed = Number(rawValue.replace(/[$,]/g, ""));
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} value "${rawValue}" is not a valid number.`);
  }
  return parsed;
}

function parseOptionalNumber(rawValue: string, label: string) {
  const value = rawValue.trim();
  return value ? parseNumber(value, label) : null;
}

function parseOptionalPositiveNumber(rawValue: string, label: string) {
  const parsed = parseOptionalNumber(rawValue, label);
  if (parsed === null) return null;
  if (parsed <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
}

function validateActivityRecordType(recordType: string, shipmentReference: string, shipmentQuantity: string) {
  const normalized = recordType.trim().toLowerCase();
  if (normalized && normalized !== "individual shipment" && normalized !== "aggregated activity") {
    throw new Error(`CURRENT_NETWORK_ACTIVITY Record Type "${recordType}" must be Individual Shipment or Aggregated Activity.`);
  }
  const quantity = shipmentQuantity.trim() ? parseNumber(shipmentQuantity, "CURRENT_NETWORK_ACTIVITY Shipments") : null;
  if (quantity !== null && quantity <= 0) {
    throw new Error("CURRENT_NETWORK_ACTIVITY Shipments must be greater than zero.");
  }
  if (normalized === "individual shipment" && quantity !== null && quantity > 1) {
    throw new Error("CURRENT_NETWORK_ACTIVITY Individual Shipment rows cannot have Shipments greater than 1.");
  }
  if (normalized === "aggregated activity" && quantity === null) {
    throw new Error("CURRENT_NETWORK_ACTIVITY Aggregated Activity rows must include Shipments.");
  }
  if (!normalized && !shipmentReference.trim() && quantity === null) {
    throw new Error("CURRENT_NETWORK_ACTIVITY rows without Shipment / Order Reference must include Shipments.");
  }
}

function divideOrNull(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function valueAt(row: string[], columnIndexes: Map<string, number>, standardField: string) {
  const index = columnIndexes.get(standardField);
  return typeof index === "number" ? row[index] ?? "" : "";
}

function sortCounts(counts: Map<string, number>) {
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([originFacilityId, shipmentCount]) => ({ originFacilityId, shipmentCount }));
}

function sortCosts(costs: Map<string, number>) {
  return [...costs.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([originFacilityId, transportationCost]) => ({ originFacilityId, transportationCost }));
}

function sortInventoryQuantities(counts: Map<string, number>) {
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([facilityId, inventoryQuantity]) => ({ facilityId, inventoryQuantity }));
}

function sortInventoryValues(values: Map<string, number>) {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([facilityId, inventoryValue]) => ({ facilityId, inventoryValue }));
}

function sortFacilityCosts(values: Map<string, number>) {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([facilityId, facilityOperatingCost]) => ({ facilityId, facilityOperatingCost }));
}

function sortFacilityCostCategories(values: Map<string, number>) {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([costCategory, facilityOperatingCost]) => ({ costCategory, facilityOperatingCost }));
}

function makeLaneKey(originFacilityId: string, destinationId: string) {
  return `${originFacilityId}\u001f${destinationId}`;
}

function splitLaneKey(key: string) {
  const [originFacilityId = "", destinationId = ""] = key.split("\u001f");
  return { originFacilityId, destinationId };
}

function sortDestinationCounts(counts: Map<string, number>) {
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([destinationId, shipmentCount]) => ({ destinationId, shipmentCount }));
}

function sortDestinationCosts(costs: Map<string, number>) {
  return [...costs.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([destinationId, transportationCost]) => ({ destinationId, transportationCost }));
}

function sortLaneCounts(counts: Map<string, number>) {
  return [...counts.entries()]
    .map(([key, shipmentCount]) => ({ ...splitLaneKey(key), shipmentCount }))
    .sort(sortLaneRows);
}

function sortLaneCosts(costs: Map<string, number>) {
  return [...costs.entries()]
    .map(([key, transportationCost]) => ({ ...splitLaneKey(key), transportationCost }))
    .sort(sortLaneRows);
}

function sortCustomerDemand(values: Map<string, number>) {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([customerId, annualDemand]) => ({ customerId, annualDemand }));
}

function addAverageValue(values: Map<string, { total: number; count: number }>, key: string, value: number) {
  const current = values.get(key) ?? { total: 0, count: 0 };
  values.set(key, {
    total: current.total + value,
    count: current.count + 1
  });
}

function sortDestinationAverages(values: Map<string, { total: number; count: number }>) {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([destinationId, value]) => ({ destinationId, averageServiceDays: value.total / value.count }));
}

function sortLaneAverages(values: Map<string, { total: number; count: number }>) {
  return [...values.entries()]
    .map(([key, value]) => ({ ...splitLaneKey(key), averageServiceDays: value.total / value.count }))
    .sort(sortLaneRows);
}

function sortNetworkLanes(
  laneCounts: Map<string, number>,
  options: {
    facilityNames: Map<string, string>;
    customerNames: Map<string, string>;
    transportationCostByLane: Map<string, number>;
    serviceDaysByLane: Map<string, { total: number; count: number }>;
    hasTransportationCost: boolean;
    hasServiceDays: boolean;
  }
) {
  return [...laneCounts.entries()]
    .map(([key, shipmentCount]) => {
      const { originFacilityId, destinationId } = splitLaneKey(key);
      const serviceDays = options.serviceDaysByLane.get(key);

      return {
        originFacilityId,
        originFacilityName: options.facilityNames.get(originFacilityId) ?? "Unknown facility",
        destinationId,
        customerName: options.customerNames.get(destinationId) ?? null,
        shipmentCount,
        transportationCost: options.hasTransportationCost ? options.transportationCostByLane.get(key) ?? 0 : null,
        averageServiceDays: options.hasServiceDays && serviceDays ? serviceDays.total / serviceDays.count : null
      };
    })
    .sort(sortLaneRows);
}

function sortLaneRows<T extends { originFacilityId: string; destinationId: string }>(left: T, right: T) {
  return (
    left.originFacilityId.localeCompare(right.originFacilityId) ||
    left.destinationId.localeCompare(right.destinationId)
  );
}

function sortModeSummary(modeShipments: Map<string, number>, modeCosts: Map<string, number>, hasCost: boolean) {
  return [...modeShipments.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([mode, shipmentCount]) => ({
      mode,
      shipmentCount,
      transportationCost: hasCost ? modeCosts.get(mode) ?? 0 : null
    }));
}

function sortServiceLevelSummary(serviceLevelShipments: Map<string, number>) {
  return [...serviceLevelShipments.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([serviceLevel, shipmentCount]) => ({ serviceLevel, shipmentCount }));
}

function sortSkuCounts(values: Map<string, number>) {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemId, shipmentCount]) => ({ itemId, shipmentCount }));
}

function sortCurrencyCosts(
  values: Map<string, number>,
  label: "transportationCost"
): Array<{ currency: string; transportationCost: number }>;
function sortCurrencyCosts(
  values: Map<string, number>,
  label: "facilityOperatingCost"
): Array<{ currency: string; facilityOperatingCost: number }>;
function sortCurrencyCosts(
  values: Map<string, number>,
  label: "transportationCost" | "facilityOperatingCost"
) {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, value]) =>
      label === "transportationCost" ? { currency, transportationCost: value } : { currency, facilityOperatingCost: value }
    );
}

function sortObservedCostsByCurrency(transportation: Map<string, number>, facility: Map<string, number>) {
  const currencies = new Set([...transportation.keys(), ...facility.keys()]);
  return [...currencies]
    .sort((left, right) => left.localeCompare(right))
    .map((currency) => ({
      currency,
      observedCost: (transportation.get(currency) ?? 0) + (facility.get(currency) ?? 0)
    }));
}

function buildSnapshotUtilization(
  snapshots: Map<string, { facilityId: string; snapshotDate: string; inventoryPallets: number }>,
  capacities: Map<string, number>,
  facilityNames: Map<string, string>,
  facilityTypes: Map<string, string>
) {
  const byFacilityDate = new Map<string, { facilityId: string; snapshotDate: string; inventoryPallets: number }>();
  for (const snapshot of snapshots.values()) {
    const key = `${snapshot.facilityId}\u001f${snapshot.snapshotDate}`;
    const current = byFacilityDate.get(key);
    byFacilityDate.set(key, {
      facilityId: snapshot.facilityId,
      snapshotDate: snapshot.snapshotDate,
      inventoryPallets: (current?.inventoryPallets ?? 0) + snapshot.inventoryPallets
    });
  }
  const latestByFacility = new Map<string, string>();
  for (const snapshot of byFacilityDate.values()) {
    const current = latestByFacility.get(snapshot.facilityId);
    if (!current || snapshot.snapshotDate.localeCompare(current) > 0) {
      latestByFacility.set(snapshot.facilityId, snapshot.snapshotDate);
    }
  }
  return [...byFacilityDate.values()]
    .filter((snapshot) => capacities.has(snapshot.facilityId))
    .map((snapshot) => {
      const capacity = capacities.get(snapshot.facilityId)!;
      const utilizationPercent = (snapshot.inventoryPallets / capacity) * 100;
      return {
        facilityId: snapshot.facilityId,
        facilityName: facilityNames.get(snapshot.facilityId) ?? snapshot.facilityId,
        facilityType: facilityTypes.get(snapshot.facilityId) ?? null,
        capacityPalletPositions: capacity,
        inventoryPallets: snapshot.inventoryPallets,
        snapshotDate: snapshot.snapshotDate,
        utilizationPercent,
        latest: latestByFacility.get(snapshot.facilityId) === snapshot.snapshotDate,
        warning: utilizationPercent > 100 ? "At/over capacity" : null
      };
    })
    .sort(
      (left, right) =>
        Number(right.latest) - Number(left.latest) ||
        left.facilityId.localeCompare(right.facilityId) ||
        right.snapshotDate.localeCompare(left.snapshotDate)
    );
}
