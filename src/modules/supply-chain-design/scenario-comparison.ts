import type { SupplyChainDesignScenarioSummary } from "@/modules/supply-chain-design/types";

export type SupplyChainDesignScenarioComparison = {
  scenarios: SupplyChainDesignScenarioSummary[];
  errorMessage: string | null;
  lowestObservedCostIds: string[];
  lowestTransportationCostIds: string[];
  fewestUnallocatedCustomerIds: string[];
  largestAnnualSavingIds: string[];
  lowestUnallocatedShipmentVolumeIds: string[];
  highestFacilityUtilizationIds: string[];
  facilityRows: Array<{
    scenarioId: string;
    scenarioName: string;
    facilityId: string;
    status: "OPEN" | "CLOSED";
    facilityKind: "EXISTING" | "CANDIDATE";
    assignedCustomers: number;
    assignedShipments: number;
    capacityStatus: "UNLIMITED" | "AVAILABLE" | "NEAR_CAPACITY" | "FULL" | "NOT_AVAILABLE";
    transportationCost: number;
    fixedOrOperatingCost: number;
    proposedObservedCost: number;
  }>;
  customerMovementRows: Array<{
    customerId: string;
    customerName: string;
    scenarioAName: string;
    scenarioBName: string;
    assignmentA: string;
    assignmentB: string;
    costPerShipmentA: number | null;
    costPerShipmentB: number | null;
    difference: number | null;
  }>;
};

export function getSuccessfulModel02Scenarios(scenarios: SupplyChainDesignScenarioSummary[]) {
  return scenarios.filter((scenario) => scenario.status === "SUCCESS" && scenario.resultSummary);
}

export function compareSupplyChainDesignScenarios(
  scenarios: SupplyChainDesignScenarioSummary[]
): SupplyChainDesignScenarioComparison {
  const selected = getSuccessfulModel02Scenarios(scenarios).slice(0, 4);
  if (selected.length < 2) {
    return {
      scenarios: selected,
      errorMessage: "Select at least two successful scenarios to compare.",
      lowestObservedCostIds: [],
      lowestTransportationCostIds: [],
      fewestUnallocatedCustomerIds: [],
      largestAnnualSavingIds: [],
      lowestUnallocatedShipmentVolumeIds: [],
      highestFacilityUtilizationIds: [],
      facilityRows: [],
      customerMovementRows: []
    };
  }

  return {
    scenarios: selected,
    errorMessage: null,
    lowestObservedCostIds: idsWithLowest(selected, (scenario) => scenario.resultSummary?.proposedObservedAnnualCost ?? 0),
    lowestTransportationCostIds: idsWithLowest(
      selected,
      (scenario) => scenario.resultSummary?.proposedTotalTransportationCost ?? 0
    ),
    fewestUnallocatedCustomerIds: idsWithLowest(selected, (scenario) => scenario.resultSummary?.customersUnallocated ?? 0),
    largestAnnualSavingIds: idsWithHighest(selected, (scenario) => -(scenario.resultSummary?.annualCostDifference ?? 0)),
    lowestUnallocatedShipmentVolumeIds: idsWithLowest(
      selected,
      (scenario) => scenario.resultSummary?.unallocatedShipmentCount ?? Number.POSITIVE_INFINITY
    ),
    highestFacilityUtilizationIds: idsWithHighest(selected, (scenario) => scenario.resultSummary?.highestFacilityUtilization ?? 0),
    facilityRows: buildFacilityRows(selected),
    customerMovementRows: selected.length === 2 ? buildCustomerMovementRows(selected[0], selected[1]) : []
  };
}

function idsWithLowest(scenarios: SupplyChainDesignScenarioSummary[], valueFor: (scenario: SupplyChainDesignScenarioSummary) => number) {
  const values = scenarios.map((scenario) => ({ id: scenario.id, value: valueFor(scenario) }));
  const lowest = Math.min(...values.map((item) => item.value));
  return values.filter((item) => item.value === lowest).map((item) => item.id).sort();
}

function idsWithHighest(scenarios: SupplyChainDesignScenarioSummary[], valueFor: (scenario: SupplyChainDesignScenarioSummary) => number) {
  const values = scenarios.map((scenario) => ({ id: scenario.id, value: valueFor(scenario) }));
  const highest = Math.max(...values.map((item) => item.value));
  return values.filter((item) => item.value === highest).map((item) => item.id).sort();
}

function buildFacilityRows(scenarios: SupplyChainDesignScenarioSummary[]) {
  return scenarios.flatMap((scenario) => {
    const result = scenario.resultSummary;
    if (!result) {
      return [];
    }

    const openRows = result.facilitySummary.map((facility) => ({
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      facilityId: facility.facilityId,
      status: "OPEN" as const,
      facilityKind: facility.facilityKind,
      assignedCustomers: facility.assignedCustomers,
      assignedShipments: facility.assignedShipments,
      capacityStatus: facility.capacityStatus,
      transportationCost: facility.transportationCost,
      fixedOrOperatingCost: facility.fixedOrOperatingCost,
      proposedObservedCost: facility.proposedObservedCost
    }));
    const closedRows = result.closedExistingFacilityIds.map((facilityId) => ({
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      facilityId,
      status: "CLOSED" as const,
      facilityKind: "EXISTING" as const,
      assignedCustomers: 0,
      assignedShipments: 0,
      capacityStatus: "NOT_AVAILABLE" as const,
      transportationCost: 0,
      fixedOrOperatingCost: 0,
      proposedObservedCost: 0
    }));

    return [...openRows, ...closedRows].sort((left, right) => left.facilityId.localeCompare(right.facilityId));
  });
}

function buildCustomerMovementRows(
  scenarioA: SupplyChainDesignScenarioSummary,
  scenarioB: SupplyChainDesignScenarioSummary
) {
  const resultA = scenarioA.resultSummary;
  const resultB = scenarioB.resultSummary;
  if (!resultA || !resultB) {
    return [];
  }

  const assignmentsA = summarizeCustomerAssignments(resultA.customerAssignments);
  const assignmentsB = summarizeCustomerAssignments(resultB.customerAssignments);

  return [...assignmentsA.values()]
    .map((assignmentA) => {
      const assignmentB = assignmentsB.get(assignmentA.customerId);
      if (!assignmentB) {
        return null;
      }

      if (assignmentA.assignment === assignmentB.assignment) {
        return null;
      }

      return {
        customerId: assignmentA.customerId,
        customerName: assignmentA.customerName,
        scenarioAName: scenarioA.name,
        scenarioBName: scenarioB.name,
        assignmentA: assignmentA.assignment,
        assignmentB: assignmentB.assignment,
        costPerShipmentA: assignmentA.costPerShipment,
        costPerShipmentB: assignmentB.costPerShipment,
        difference:
          typeof assignmentA.costPerShipment === "number" && typeof assignmentB.costPerShipment === "number"
            ? assignmentB.costPerShipment - assignmentA.costPerShipment
            : null
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((left, right) => left.customerId.localeCompare(right.customerId));
}

function summarizeCustomerAssignments(
  assignments: NonNullable<SupplyChainDesignScenarioSummary["resultSummary"]>["customerAssignments"]
) {
  const rowsByCustomer = new Map<string, typeof assignments>();
  for (const assignment of assignments) {
    rowsByCustomer.set(assignment.customerId, [...(rowsByCustomer.get(assignment.customerId) ?? []), assignment]);
  }

  const summaries = new Map<
    string,
    {
      customerId: string;
      customerName: string;
      assignment: string;
      costPerShipment: number | null;
    }
  >();

  for (const [customerId, rows] of rowsByCustomer.entries()) {
    const assignedRows = rows.filter((row) => row.assignedFacilityId);
    const assignedQuantity = assignedRows.reduce((total, row) => total + row.assignedShipmentQuantity, 0);
    const assignedCost = assignedRows.reduce((total, row) => total + (row.proposedAnnualTransportationCost ?? 0), 0);
    summaries.set(customerId, {
      customerId,
      customerName: rows[0]?.customerName ?? "",
      assignment:
        assignedRows.length > 0
          ? assignedRows.map((row) => `${row.assignedFacilityId} (${row.assignedShipmentQuantity})`).join(", ")
          : "Unallocated",
      costPerShipment: assignedQuantity > 0 ? assignedCost / assignedQuantity : null
    });
  }

  return summaries;
}
