import { SupplyChainDesignTableType } from "@prisma/client";

import { parseCsvRows } from "@/modules/supply-chain-design/csv-intake";
import { getSourceColumn } from "@/modules/supply-chain-design/model-01-proof";
import type { SupplyChainDesignFieldMapping } from "@/modules/supply-chain-design/types";

export type SupplyChainDesignModel02ProofInput = {
  scenarioName: string;
  baselineRunId: string;
  baselineObservedCost: number;
  baselineRunCreatedAt?: string;
  facilities: SupplyChainDesignMappedScenarioFile;
  shipments: SupplyChainDesignMappedScenarioFile;
  customers: SupplyChainDesignMappedScenarioFile;
  candidateFacilities: SupplyChainDesignMappedScenarioFile;
  scenarioLaneCosts?: SupplyChainDesignMappedScenarioFile | null;
  facilityCosts?: SupplyChainDesignMappedScenarioFile | null;
  selectedExistingFacilityIds: string[];
  selectedCandidateFacilityIds: string[];
  enforceCapacity: boolean;
};

export type SupplyChainDesignMappedScenarioFile = {
  fileId: string;
  mappingId: string;
  fileName?: string;
  tableType: SupplyChainDesignTableType;
  fileBytes: Buffer;
  fieldMappings: SupplyChainDesignFieldMapping[];
};

export type SupplyChainDesignModel02ProofResult = {
  scenarioName: string;
  baselineRunId: string;
  selectedExistingFacilityIds: string[];
  selectedCandidateFacilityIds: string[];
  closedExistingFacilityIds: string[];
  unselectedCandidateFacilityIds: string[];
  selectedFacilityIds: string[];
  enforceCapacity: boolean;
  customersAllocated: number;
  customersUnallocated: number;
  historicalShipmentCount: number;
  assignedShipmentCount: number;
  unallocatedShipmentCount: number;
  totalFiniteCapacity: number | null;
  facilitiesNearCapacityOrFull: number;
  highestFacilityUtilization: number | null;
  fullFacilityCount: number;
  baselineObservedCost: number;
  proposedTotalTransportationCost: number;
  selectedCandidateAnnualFixedCost: number;
  retainedExistingFacilityOperatingCost: number;
  proposedObservedAnnualCost: number;
  annualCostDifference: number;
  percentageDifference: number | null;
  customerAssignments: Array<{
    customerId: string;
    customerName: string;
    historicalShipmentCount: number;
    assignedFacilityId: string | null;
    assignedFacilityName: string | null;
    assignedShipmentQuantity: number;
    costPerShipment: number | null;
    proposedAnnualTransportationCost: number | null;
    remainingUnallocatedShipmentQuantity: number;
    serviceDays: number | null;
    allocationStatus: "FULLY_ALLOCATED" | "SPLIT_ACROSS_FACILITIES" | "PARTIALLY_ALLOCATED" | "UNALLOCATED";
  }>;
  facilitySummary: Array<{
    facilityId: string;
    facilityName: string;
    facilityKind: "EXISTING" | "CANDIDATE";
    assignedCustomers: number;
    assignedShipments: number;
    transportationCost: number;
    fixedOrOperatingCost: number;
    proposedObservedCost: number;
    capacity: number | null;
    remainingCapacity: number | null;
    utilizationPercent: number | null;
    capacityStatus: "UNLIMITED" | "AVAILABLE" | "NEAR_CAPACITY" | "FULL";
  }>;
  proposedShipmentCountByFacility: Array<{
    facilityId: string;
    shipmentCount: number;
  }>;
  proposedTransportationCostByFacility: Array<{
    facilityId: string;
    transportationCost: number;
  }>;
  unallocatedCustomerIds: string[];
  missingScenarioLaneCosts: Array<{
    facilityId: string;
    destinationId: string;
  }>;
  unmatchedFacilityIds: string[];
  unmatchedCustomerIds: string[];
  deferredValidation: string[];
};

type FacilityOption = {
  facilityId: string;
  facilityName: string;
  kind: "EXISTING" | "CANDIDATE";
  fixedOrOperatingCost: number;
  capacity: number | null;
};

type AllocationOption = {
  facility: FacilityOption;
  costPerShipment: number;
  serviceDays: number | null;
};

export function runSupplyChainDesignModel02Proof(
  input: SupplyChainDesignModel02ProofInput
): SupplyChainDesignModel02ProofResult {
  if (input.selectedExistingFacilityIds.length + input.selectedCandidateFacilityIds.length === 0) {
    throw new Error("Select at least one existing or candidate facility to keep open for the Model 02 proof scenario.");
  }

  const facilities = readMappedRows(input.facilities, ["facility_id", "facility_name"]);
  const shipments = readMappedRows(input.shipments, ["shipment_id", "origin_facility_id", "destination_id"]);
  const customers = readMappedRows(input.customers, ["customer_id", "customer_name", "city", "country"]);
  const candidateFacilities = readMappedRows(input.candidateFacilities, [
    "candidate_facility_id",
    "candidate_facility_name"
  ]);
  const scenarioLaneCosts = input.scenarioLaneCosts
    ? readMappedRows(input.scenarioLaneCosts, ["origin_facility_id", "destination_id", "cost_per_shipment"])
    : null;
  const facilityCosts = input.facilityCosts
    ? readMappedRows(input.facilityCosts, ["facility_id", "cost_category", "annual_cost"])
    : null;
  const shipmentCostColumn = getSourceColumn(input.shipments.fieldMappings, "transportation_cost");

  const existingFacilities = new Map<string, FacilityOption>();
  for (const row of facilities.rows) {
    const facilityId = requiredValue(row, facilities.columnIndexes, "facility_id", "FACILITIES");
    const facilityName = requiredValue(row, facilities.columnIndexes, "facility_name", "FACILITIES");
    existingFacilities.set(facilityId, {
      facilityId,
      facilityName,
      kind: "EXISTING",
      fixedOrOperatingCost: 0,
      capacity: optionalCapacity(row, facilities.columnIndexes, "capacity", "FACILITIES capacity")
    });
  }

  if (facilityCosts) {
    for (const row of facilityCosts.rows) {
      const facilityId = requiredValue(row, facilityCosts.columnIndexes, "facility_id", "FACILITY_COSTS");
      const annualCost = parseNumber(
        requiredValue(row, facilityCosts.columnIndexes, "annual_cost", "FACILITY_COSTS"),
        "FACILITY_COSTS annual_cost"
      );
      const existing = existingFacilities.get(facilityId);
      if (existing) {
        existing.fixedOrOperatingCost += annualCost;
      }
    }
  }

  const customersById = new Map<string, string>();
  for (const row of customers.rows) {
    const customerId = requiredValue(row, customers.columnIndexes, "customer_id", "CUSTOMERS");
    const customerName = requiredValue(row, customers.columnIndexes, "customer_name", "CUSTOMERS");
    requiredValue(row, customers.columnIndexes, "city", "CUSTOMERS");
    requiredValue(row, customers.columnIndexes, "country", "CUSTOMERS");
    customersById.set(customerId, customerName);
  }

  const historicalShipmentCountByCustomer = new Map<string, number>();
  const historicalLaneCostTotals = new Map<string, { total: number; count: number }>();
  const unmatchedCustomerIds = new Set<string>();
  const unmatchedFacilityIds = new Set<string>();
  for (const row of shipments.rows) {
    requiredValue(row, shipments.columnIndexes, "shipment_id", "SHIPMENTS");
    const originFacilityId = requiredValue(row, shipments.columnIndexes, "origin_facility_id", "SHIPMENTS");
    const destinationId = requiredValue(row, shipments.columnIndexes, "destination_id", "SHIPMENTS");
    historicalShipmentCountByCustomer.set(destinationId, (historicalShipmentCountByCustomer.get(destinationId) ?? 0) + 1);
    if (!customersById.has(destinationId)) {
      unmatchedCustomerIds.add(destinationId);
    }
    if (!existingFacilities.has(originFacilityId)) {
      unmatchedFacilityIds.add(originFacilityId);
    }
    if (shipmentCostColumn) {
      const cost = parseNumber(requiredValue(row, shipments.columnIndexes, "transportation_cost", "SHIPMENTS"), "SHIPMENTS transportation_cost");
      addAverage(historicalLaneCostTotals, laneKey(originFacilityId, destinationId), cost);
    }
  }

  const selectedExistingSet = new Set(input.selectedExistingFacilityIds);
  const selectedCandidateSet = new Set(input.selectedCandidateFacilityIds);
  const selectedFacilities: FacilityOption[] = [];
  const candidateFacilityIds = new Set<string>();
  for (const facility of existingFacilities.values()) {
    if (selectedExistingSet.has(facility.facilityId)) {
      selectedFacilities.push(facility);
    }
  }

  for (const row of candidateFacilities.rows) {
    const facilityId = requiredValue(
      row,
      candidateFacilities.columnIndexes,
      "candidate_facility_id",
      "CANDIDATE_FACILITIES"
    );
    const facilityName = requiredValue(
      row,
      candidateFacilities.columnIndexes,
      "candidate_facility_name",
      "CANDIDATE_FACILITIES"
    );
    const rawAnnualFixedCost =
      valueAt(row, candidateFacilities.columnIndexes, "annual_facility_warehouse_cost").trim() ||
      valueAt(row, candidateFacilities.columnIndexes, "annual_fixed_cost").trim() ||
      "0";
    const annualFixedCost = parseNumber(rawAnnualFixedCost, "CANDIDATE_FACILITIES annual_facility_warehouse_cost");
    candidateFacilityIds.add(facilityId);

    if (selectedCandidateSet.has(facilityId)) {
      selectedFacilities.push({
        facilityId,
        facilityName,
        kind: "CANDIDATE",
        fixedOrOperatingCost: annualFixedCost,
        capacity: optionalCapacity(row, candidateFacilities.columnIndexes, "capacity", "CANDIDATE_FACILITIES capacity")
      });
    }
  }

  const selectedFacilityIds = new Set(selectedFacilities.map((facility) => facility.facilityId));
  const missingSelectedExistingIds = [...selectedExistingSet]
    .filter((facilityId) => !existingFacilities.has(facilityId))
    .sort();
  const missingSelectedCandidateIds = [...selectedCandidateSet]
    .filter((facilityId) => !selectedFacilityIds.has(facilityId))
    .sort();
  const missingSelectedIds = [...missingSelectedExistingIds, ...missingSelectedCandidateIds];
  for (const facilityId of missingSelectedIds) {
    unmatchedFacilityIds.add(facilityId);
  }
  if (selectedFacilities.length === 0) {
    throw new Error("Select at least one valid existing or candidate facility to keep open for the Model 02 proof scenario.");
  }

  const uploadedLaneCosts = new Map<string, { costPerShipment: number; serviceDays: number | null }>();
  if (scenarioLaneCosts) {
    for (const row of scenarioLaneCosts.rows) {
      const facilityId = requiredValue(row, scenarioLaneCosts.columnIndexes, "origin_facility_id", "SCENARIO_LANE_COSTS");
      const destinationId = requiredValue(row, scenarioLaneCosts.columnIndexes, "destination_id", "SCENARIO_LANE_COSTS");
      const costPerShipment = parseNumber(
        requiredValue(row, scenarioLaneCosts.columnIndexes, "cost_per_shipment", "SCENARIO_LANE_COSTS"),
        "SCENARIO_LANE_COSTS cost_per_shipment"
      );
      uploadedLaneCosts.set(laneKey(facilityId, destinationId), {
        costPerShipment,
        serviceDays: optionalNumber(row, scenarioLaneCosts.columnIndexes, "service_days", "SCENARIO_LANE_COSTS service_days")
      });
      if (!selectedFacilityIds.has(facilityId)) {
        unmatchedFacilityIds.add(facilityId);
      }
      if (!customersById.has(destinationId)) {
        unmatchedCustomerIds.add(destinationId);
      }
    }
  }

  const missingScenarioLaneCosts: Array<{ facilityId: string; destinationId: string }> = [];
  const customerAssignments: SupplyChainDesignModel02ProofResult["customerAssignments"] = [];
  const facilitySummary = new Map<string, SupplyChainDesignModel02ProofResult["facilitySummary"][number]>();
  for (const facility of selectedFacilities) {
    facilitySummary.set(facility.facilityId, {
      facilityId: facility.facilityId,
      facilityName: facility.facilityName,
      facilityKind: facility.kind,
      assignedCustomers: 0,
      assignedShipments: 0,
      transportationCost: 0,
      fixedOrOperatingCost: facility.fixedOrOperatingCost,
      proposedObservedCost: facility.fixedOrOperatingCost,
      capacity: facility.capacity,
      remainingCapacity: facility.capacity,
      utilizationPercent: facility.capacity === null ? null : 0,
      capacityStatus: facility.capacity === null ? "UNLIMITED" : facility.capacity === 0 ? "FULL" : "AVAILABLE"
    });
  }
  const remainingCapacityByFacility = new Map(
    selectedFacilities.map((facility) => [facility.facilityId, facility.capacity])
  );

  const consideredCustomersById = new Map(customersById);
  for (const customerId of historicalShipmentCountByCustomer.keys()) {
    if (!consideredCustomersById.has(customerId)) {
      consideredCustomersById.set(customerId, customerId);
    }
  }

  for (const [customerId, customerName] of [...consideredCustomersById.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const historicalShipmentCount = historicalShipmentCountByCustomer.get(customerId) ?? 0;
    const options = selectedFacilities
      .map((facility) => {
        const uploaded = uploadedLaneCosts.get(laneKey(facility.facilityId, customerId));
        const historical = facility.kind === "EXISTING" ? historicalLaneCostTotals.get(laneKey(facility.facilityId, customerId)) : null;
        const costPerShipment = uploaded?.costPerShipment ?? (historical ? historical.total / historical.count : null);
        if (costPerShipment === null) {
          missingScenarioLaneCosts.push({ facilityId: facility.facilityId, destinationId: customerId });
        }
        return {
          facility,
          costPerShipment,
          serviceDays: uploaded?.serviceDays ?? null
        };
      })
      .filter((option): option is AllocationOption => option.costPerShipment !== null)
      .sort((left, right) => {
        const costDifference = left.costPerShipment - right.costPerShipment;
        return costDifference || left.facility.facilityId.localeCompare(right.facility.facilityId);
      });

    const allocations = input.enforceCapacity
      ? allocateWithCapacity(options, historicalShipmentCount, remainingCapacityByFacility)
      : allocateWithoutCapacity(options, historicalShipmentCount);
    const allocatedQuantity = allocations.reduce((total, allocation) => total + allocation.assignedShipmentQuantity, 0);
    const remainingUnallocatedShipmentQuantity = Math.max(0, historicalShipmentCount - allocatedQuantity);
    const allocationStatus =
      allocatedQuantity === 0
        ? "UNALLOCATED"
        : remainingUnallocatedShipmentQuantity > 0
          ? "PARTIALLY_ALLOCATED"
          : allocations.length > 1
            ? "SPLIT_ACROSS_FACILITIES"
            : "FULLY_ALLOCATED";

    for (const allocation of allocations) {
      const proposedAnnualTransportationCost = allocation.assignedShipmentQuantity * allocation.costPerShipment;
      const summary = facilitySummary.get(allocation.facility.facilityId);
      if (summary) {
        summary.assignedCustomers += 1;
        summary.assignedShipments += allocation.assignedShipmentQuantity;
        summary.transportationCost += proposedAnnualTransportationCost;
        summary.proposedObservedCost = summary.transportationCost + summary.fixedOrOperatingCost;
      }

      customerAssignments.push({
        customerId,
        customerName,
        historicalShipmentCount,
        assignedFacilityId: allocation.facility.facilityId,
        assignedFacilityName: allocation.facility.facilityName,
        assignedShipmentQuantity: allocation.assignedShipmentQuantity,
        costPerShipment: allocation.costPerShipment,
        proposedAnnualTransportationCost,
        remainingUnallocatedShipmentQuantity,
        serviceDays: allocation.serviceDays,
        allocationStatus
      });
    }

    if (allocations.length === 0 || remainingUnallocatedShipmentQuantity > 0) {
      customerAssignments.push({
        customerId,
        customerName,
        historicalShipmentCount,
        assignedFacilityId: null,
        assignedFacilityName: null,
        assignedShipmentQuantity: 0,
        costPerShipment: null,
        proposedAnnualTransportationCost: null,
        remainingUnallocatedShipmentQuantity,
        serviceDays: null,
        allocationStatus
      });
    }
  }

  for (const summary of facilitySummary.values()) {
    if (summary.capacity === null) {
      summary.remainingCapacity = null;
      summary.utilizationPercent = null;
      summary.capacityStatus = "UNLIMITED";
      continue;
    }
    summary.remainingCapacity = Math.max(0, summary.capacity - summary.assignedShipments);
    summary.utilizationPercent = summary.capacity > 0 ? (summary.assignedShipments / summary.capacity) * 100 : null;
    summary.capacityStatus = getCapacityStatus(summary.capacity, summary.assignedShipments);
    if (input.enforceCapacity && summary.assignedShipments > summary.capacity) {
      throw new Error(`${summary.facilityId} assigned shipments exceed configured capacity.`);
    }
  }

  const historicalShipmentCount = [...historicalShipmentCountByCustomer.values()].reduce((total, count) => total + count, 0);
  const assignedShipmentCount = customerAssignments.reduce(
    (total, assignment) => total + assignment.assignedShipmentQuantity,
    0
  );
  const unallocatedShipmentCount = customerAssignments.reduce(
    (total, assignment) =>
      assignment.assignedFacilityId === null ? total + assignment.remainingUnallocatedShipmentQuantity : total,
    0
  );
  if (Math.abs(assignedShipmentCount + unallocatedShipmentCount - historicalShipmentCount) > 0.000001) {
    const difference = assignedShipmentCount + unallocatedShipmentCount - historicalShipmentCount;
    throw new Error(
      `Assigned and unallocated shipments do not reconcile to historical shipment count. Historical shipment count: ${historicalShipmentCount}; assigned shipment count: ${assignedShipmentCount}; unallocated shipment count: ${unallocatedShipmentCount}; difference: ${difference}.`
    );
  }

  const finiteCapacityValues = [...facilitySummary.values()]
    .map((facility) => facility.capacity)
    .filter((capacity): capacity is number => typeof capacity === "number");
  const totalFiniteCapacity =
    finiteCapacityValues.length > 0 ? finiteCapacityValues.reduce((total, capacity) => total + capacity, 0) : null;
  const facilitiesNearCapacityOrFull = [...facilitySummary.values()].filter(
    (facility) => facility.capacityStatus === "NEAR_CAPACITY" || facility.capacityStatus === "FULL"
  ).length;
  const highestFacilityUtilization = [...facilitySummary.values()].reduce<number | null>(
    (highest, facility) =>
      typeof facility.utilizationPercent === "number"
        ? highest === null
          ? facility.utilizationPercent
          : Math.max(highest, facility.utilizationPercent)
        : highest,
    null
  );
  const fullFacilityCount = [...facilitySummary.values()].filter((facility) => facility.capacityStatus === "FULL").length;

  const proposedTotalTransportationCost = customerAssignments.reduce(
    (total, assignment) => total + (assignment.proposedAnnualTransportationCost ?? 0),
    0
  );
  const selectedCandidateAnnualFixedCost = selectedFacilities
    .filter((facility) => facility.kind === "CANDIDATE")
    .reduce((total, facility) => total + facility.fixedOrOperatingCost, 0);
  const retainedExistingFacilityOperatingCost = selectedFacilities
    .filter((facility) => facility.kind === "EXISTING")
    .reduce((total, facility) => total + facility.fixedOrOperatingCost, 0);
  const proposedObservedAnnualCost =
    proposedTotalTransportationCost + selectedCandidateAnnualFixedCost + retainedExistingFacilityOperatingCost;
  const annualCostDifference = proposedObservedAnnualCost - input.baselineObservedCost;

  return {
    scenarioName: input.scenarioName,
    baselineRunId: input.baselineRunId,
    selectedExistingFacilityIds: [...selectedExistingSet].sort(),
    selectedCandidateFacilityIds: [...selectedCandidateSet].sort(),
    closedExistingFacilityIds: [...existingFacilities.keys()].filter((facilityId) => !selectedExistingSet.has(facilityId)).sort(),
    unselectedCandidateFacilityIds: [...candidateFacilityIds].filter((facilityId) => !selectedCandidateSet.has(facilityId)).sort(),
    selectedFacilityIds: [...selectedFacilityIds].sort(),
    enforceCapacity: input.enforceCapacity,
    customersAllocated: new Set(
      customerAssignments
        .filter((assignment) => assignment.assignedFacilityId !== null)
        .map((assignment) => assignment.customerId)
    ).size,
    customersUnallocated: new Set(
      customerAssignments
        .filter((assignment) => assignment.allocationStatus === "UNALLOCATED")
        .map((assignment) => assignment.customerId)
    ).size,
    historicalShipmentCount,
    assignedShipmentCount,
    unallocatedShipmentCount,
    totalFiniteCapacity,
    facilitiesNearCapacityOrFull,
    highestFacilityUtilization,
    fullFacilityCount,
    baselineObservedCost: input.baselineObservedCost,
    proposedTotalTransportationCost,
    selectedCandidateAnnualFixedCost,
    retainedExistingFacilityOperatingCost,
    proposedObservedAnnualCost,
    annualCostDifference,
    percentageDifference: input.baselineObservedCost > 0 ? (annualCostDifference / input.baselineObservedCost) * 100 : null,
    customerAssignments,
    facilitySummary: [...facilitySummary.values()].sort((left, right) => left.facilityId.localeCompare(right.facilityId)),
    proposedShipmentCountByFacility: [...facilitySummary.values()]
      .map((facility) => ({ facilityId: facility.facilityId, shipmentCount: facility.assignedShipments }))
      .sort((left, right) => left.facilityId.localeCompare(right.facilityId)),
    proposedTransportationCostByFacility: [...facilitySummary.values()]
      .map((facility) => ({ facilityId: facility.facilityId, transportationCost: facility.transportationCost }))
      .sort((left, right) => left.facilityId.localeCompare(right.facilityId)),
    unallocatedCustomerIds: customerAssignments
      .filter((assignment) => assignment.allocationStatus === "UNALLOCATED")
      .map((assignment) => assignment.customerId),
    missingScenarioLaneCosts: missingScenarioLaneCosts.sort(
      (left, right) => left.facilityId.localeCompare(right.facilityId) || left.destinationId.localeCompare(right.destinationId)
    ),
    unmatchedFacilityIds: [...unmatchedFacilityIds].sort(),
    unmatchedCustomerIds: [...unmatchedCustomerIds].sort(),
    deferredValidation: [
      "Warehouse-location optimization solver",
      "Distance-based rate estimation",
      "Facility closure costs",
      "Facility opening implementation costs",
      "Severance, lease termination, transition inventory, and capital expenditure",
      "Scenario comparison workflow",
      "Geocoding, fuzzy matching, duplicate handling, and advanced validation"
    ]
  };
}

function allocateWithoutCapacity(options: AllocationOption[], shipmentCount: number) {
  const selected = options[0] ?? null;
  return selected ? [{ ...selected, assignedShipmentQuantity: shipmentCount }] : [];
}

function allocateWithCapacity(
  options: AllocationOption[],
  shipmentCount: number,
  remainingCapacityByFacility: Map<string, number | null>
) {
  const allocations: Array<AllocationOption & { assignedShipmentQuantity: number }> = [];
  let remainingShipmentCount = shipmentCount;

  for (const option of options) {
    if (remainingShipmentCount <= 0) {
      break;
    }
    const remainingCapacity = remainingCapacityByFacility.get(option.facility.facilityId);
    if (remainingCapacity === undefined) continue;
    const assignableQuantity =
      remainingCapacity === null ? remainingShipmentCount : Math.min(remainingShipmentCount, remainingCapacity);
    if (assignableQuantity <= 0) {
      continue;
    }
    allocations.push({ ...option, assignedShipmentQuantity: assignableQuantity });
    remainingShipmentCount -= assignableQuantity;
    if (remainingCapacity !== null) {
      remainingCapacityByFacility.set(option.facility.facilityId, remainingCapacity - assignableQuantity);
    }
  }

  return allocations;
}

function getCapacityStatus(capacity: number, assignedShipments: number) {
  const remainingCapacity = Math.max(0, capacity - assignedShipments);
  if (remainingCapacity === 0) {
    return "FULL";
  }
  const utilizationPercent = capacity > 0 ? (assignedShipments / capacity) * 100 : null;
  return typeof utilizationPercent === "number" && utilizationPercent >= 90 ? "NEAR_CAPACITY" : "AVAILABLE";
}

function readMappedRows(file: SupplyChainDesignMappedScenarioFile, requiredFields: string[]) {
  const rows = parseCsvRows(file.fileBytes.toString("utf8").replace(/^\uFEFF/, ""));
  const headers = rows[0]?.map((header) => header.trim()) ?? [];
  const dataRows = rows.slice(1).filter((row) => row.some((value) => value.trim()));
  const columnIndexes = new Map<string, number>();
  const mappedFields = new Set([...requiredFields, ...file.fieldMappings.map((field) => field.standardField)]);

  for (const standardField of mappedFields) {
    const sourceColumn = getSourceColumn(file.fieldMappings, standardField);
    if (!sourceColumn) {
      if (requiredFields.includes(standardField)) {
        throw new Error(`${file.tableType} mapping is missing required field ${standardField}.`);
      }
      continue;
    }
    const index = headers.indexOf(sourceColumn);
    if (index === -1) {
      throw new Error(`${file.tableType} mapped source column "${sourceColumn}" was not found in the CSV headers.`);
    }
    columnIndexes.set(standardField, index);
  }

  return { rows: dataRows, columnIndexes };
}

function requiredValue(
  row: string[],
  columnIndexes: Map<string, number>,
  standardField: string,
  tableType: string
) {
  const value = valueAt(row, columnIndexes, standardField).trim();
  if (!value) {
    throw new Error(`${tableType} ${standardField} is blank in a row used by the proof run.`);
  }
  return value;
}

function optionalNumber(row: string[], columnIndexes: Map<string, number>, standardField: string, label: string) {
  const rawValue = valueAt(row, columnIndexes, standardField).trim();
  return rawValue ? parseNumber(rawValue, label) : null;
}

function optionalCapacity(row: string[], columnIndexes: Map<string, number>, standardField: string, label: string) {
  const rawValue = valueAt(row, columnIndexes, standardField).trim();
  if (!rawValue) {
    return null;
  }
  const capacity = parseNumber(rawValue, label);
  if (capacity < 0) {
    throw new Error(`${label} cannot be negative.`);
  }
  return capacity;
}

function parseNumber(rawValue: string, label: string) {
  const parsed = Number(rawValue.replace(/[$,]/g, ""));
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} value "${rawValue}" is not a valid number.`);
  }
  return parsed;
}

function valueAt(row: string[], columnIndexes: Map<string, number>, standardField: string) {
  const index = columnIndexes.get(standardField);
  return typeof index === "number" ? row[index] ?? "" : "";
}

function addAverage(values: Map<string, { total: number; count: number }>, key: string, amount: number) {
  const current = values.get(key) ?? { total: 0, count: 0 };
  values.set(key, {
    total: current.total + amount,
    count: current.count + 1
  });
}

function laneKey(originFacilityId: string, destinationId: string) {
  return `${originFacilityId}\u001f${destinationId}`;
}
