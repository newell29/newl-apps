"use client";

import { useMemo, useState } from "react";

import {
  compareSupplyChainDesignScenarios,
  getSuccessfulModel02Scenarios
} from "@/modules/supply-chain-design/scenario-comparison";
import type { SupplyChainDesignScenarioSummary } from "@/modules/supply-chain-design/types";

export function SupplyChainDesignModel02ScenarioComparison({
  scenarios
}: {
  scenarios: SupplyChainDesignScenarioSummary[];
}) {
  const successfulScenarios = useMemo(() => getSuccessfulModel02Scenarios(scenarios), [scenarios]);
  const [selectedIds, setSelectedIds] = useState(() => successfulScenarios.slice(0, 2).map((scenario) => scenario.id));
  const selectedScenarios = successfulScenarios.filter((scenario) => selectedIds.includes(scenario.id));
  const comparison = compareSupplyChainDesignScenarios(selectedScenarios);

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-foreground">Compare scenarios</h4>
        <p className="mt-1 text-xs text-mutedForeground">Select two to four successful saved scenarios. Failed scenarios are excluded from comparison.</p>
        {successfulScenarios.length < 2 ? (
          <p className="mt-2 text-sm text-mutedForeground">At least two successful scenarios are needed for comparison.</p>
        ) : (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {successfulScenarios.map((scenario) => (
              <label key={scenario.id} className="flex items-start gap-2 rounded-md border border-border bg-background p-3 text-sm">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(scenario.id)}
                  disabled={!selectedIds.includes(scenario.id) && selectedIds.length >= 4}
                  onChange={(event) => {
                    setSelectedIds((current) =>
                      event.target.checked
                        ? [...current, scenario.id].slice(0, 4)
                        : current.filter((scenarioId) => scenarioId !== scenario.id)
                    );
                  }}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-foreground">{scenario.name}</span>
                  <span className="block text-xs text-mutedForeground">{formatDateTime(scenario.createdAt)}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {comparison.errorMessage ? <p className="text-sm font-medium text-danger">{comparison.errorMessage}</p> : null}
      {!comparison.errorMessage ? (
        <>
          <ComparisonTable comparison={comparison} />
          <FacilityComparisonTable comparison={comparison} />
          <CustomerMovementTable comparison={comparison} />
        </>
      ) : null}
    </div>
  );
}

function ComparisonTable({ comparison }: { comparison: ReturnType<typeof compareSupplyChainDesignScenarios> }) {
  const rows = [
    {
      label: "Open existing facilities",
      value: (scenario: SupplyChainDesignScenarioSummary) => scenario.resultSummary?.selectedExistingFacilityIds.join(", ") || "None"
    },
    {
      label: "Closed existing facilities",
      value: (scenario: SupplyChainDesignScenarioSummary) => scenario.resultSummary?.closedExistingFacilityIds.join(", ") || "None"
    },
    {
      label: "Opened candidate facilities",
      value: (scenario: SupplyChainDesignScenarioSummary) => scenario.resultSummary?.selectedCandidateFacilityIds.join(", ") || "None"
    },
    {
      label: "Customers allocated",
      value: (scenario: SupplyChainDesignScenarioSummary) => formatNumber(scenario.resultSummary?.customersAllocated ?? 0)
    },
    {
      label: "Customers unallocated",
      value: (scenario: SupplyChainDesignScenarioSummary) => formatNumber(scenario.resultSummary?.customersUnallocated ?? 0),
      indicator: comparison.fewestUnallocatedCustomerIds,
      indicatorLabel: "Fewest unallocated customers"
    },
    {
      label: "Capacity enforcement enabled",
      value: (scenario: SupplyChainDesignScenarioSummary) => (scenario.resultSummary?.enforceCapacity ? "Enabled" : "Disabled")
    },
    {
      label: "Total finite capacity",
      value: (scenario: SupplyChainDesignScenarioSummary) =>
        typeof scenario.resultSummary?.totalFiniteCapacity === "number"
          ? formatNumber(scenario.resultSummary.totalFiniteCapacity)
          : "Not available"
    },
    {
      label: "Unallocated shipment volume",
      value: (scenario: SupplyChainDesignScenarioSummary) =>
        typeof scenario.resultSummary?.unallocatedShipmentCount === "number"
          ? formatNumber(scenario.resultSummary.unallocatedShipmentCount)
          : "Not available",
      indicator: comparison.lowestUnallocatedShipmentVolumeIds,
      indicatorLabel: "Lowest unallocated shipment volume"
    },
    {
      label: "Highest facility utilization",
      value: (scenario: SupplyChainDesignScenarioSummary) => formatPercent(scenario.resultSummary?.highestFacilityUtilization ?? null),
      indicator: comparison.highestFacilityUtilizationIds,
      indicatorLabel: "Highest utilization among compared scenarios"
    },
    {
      label: "Number of full facilities",
      value: (scenario: SupplyChainDesignScenarioSummary) =>
        typeof scenario.resultSummary?.fullFacilityCount === "number"
          ? formatNumber(scenario.resultSummary.fullFacilityCount)
          : "Not available"
    },
    {
      label: "Proposed transportation cost",
      value: (scenario: SupplyChainDesignScenarioSummary) => formatMoney(scenario.resultSummary?.proposedTotalTransportationCost ?? 0),
      indicator: comparison.lowestTransportationCostIds,
      indicatorLabel: "Lowest transportation cost"
    },
    {
      label: "Retained existing operating cost",
      value: (scenario: SupplyChainDesignScenarioSummary) => formatMoney(scenario.resultSummary?.retainedExistingFacilityOperatingCost ?? 0)
    },
    {
      label: "Candidate fixed cost",
      value: (scenario: SupplyChainDesignScenarioSummary) => formatMoney(scenario.resultSummary?.selectedCandidateAnnualFixedCost ?? 0)
    },
    {
      label: "Proposed observed cost",
      value: (scenario: SupplyChainDesignScenarioSummary) => formatMoney(scenario.resultSummary?.proposedObservedAnnualCost ?? 0),
      indicator: comparison.lowestObservedCostIds,
      indicatorLabel: "Lowest cost among compared scenarios"
    },
    {
      label: "Annual difference from baseline",
      value: (scenario: SupplyChainDesignScenarioSummary) => formatMoney(scenario.resultSummary?.annualCostDifference ?? 0),
      indicator: comparison.largestAnnualSavingIds,
      indicatorLabel: "Largest reduction from baseline"
    },
    {
      label: "Percentage difference from baseline",
      value: (scenario: SupplyChainDesignScenarioSummary) => formatPercent(scenario.resultSummary?.percentageDifference ?? null)
    },
    {
      label: "Highest-cost facility",
      value: (scenario: SupplyChainDesignScenarioSummary) => highestCostFacility(scenario)
    },
    {
      label: "Total assigned shipments",
      value: (scenario: SupplyChainDesignScenarioSummary) =>
        formatNumber(scenario.resultSummary?.facilitySummary.reduce((total, facility) => total + facility.assignedShipments, 0) ?? 0)
    }
  ];

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-mutedForeground">
          <tr>
            <th className="px-3 py-2 font-semibold">Metric</th>
            {comparison.scenarios.map((scenario) => (
              <th key={scenario.id} className="px-3 py-2 font-semibold">{scenario.name}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-background">
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="px-3 py-2 font-medium text-foreground">{row.label}</td>
              {comparison.scenarios.map((scenario) => (
                <td key={scenario.id} className="px-3 py-2 text-mutedForeground">
                  <span>{row.value(scenario)}</span>
                  {row.indicator?.includes(scenario.id) ? (
                    <span className="mt-1 block text-xs font-semibold text-success">{row.indicatorLabel}</span>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FacilityComparisonTable({ comparison }: { comparison: ReturnType<typeof compareSupplyChainDesignScenarios> }) {
  return (
    <details className="rounded-md border border-border bg-background p-4">
      <summary className="cursor-pointer text-sm font-semibold text-foreground">Facility comparison</summary>
      <div className="mt-3 overflow-x-auto rounded-md border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-mutedForeground">
            <tr>
              <th className="px-3 py-2 font-semibold">Scenario</th>
              <th className="px-3 py-2 font-semibold">Facility ID</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Kind</th>
              <th className="px-3 py-2 font-semibold">Assigned customers</th>
              <th className="px-3 py-2 font-semibold">Assigned shipments</th>
              <th className="px-3 py-2 font-semibold">Capacity status</th>
              <th className="px-3 py-2 font-semibold">Transportation cost</th>
              <th className="px-3 py-2 font-semibold">Operating or fixed cost</th>
              <th className="px-3 py-2 font-semibold">Proposed observed cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {comparison.facilityRows.map((row) => (
              <tr key={`${row.scenarioId}-${row.facilityId}`}>
                <td className="px-3 py-2 font-medium text-foreground">{row.scenarioName}</td>
                <td className="px-3 py-2 text-mutedForeground">{row.facilityId}</td>
                <td className="px-3 py-2 text-mutedForeground">{row.status}</td>
                <td className="px-3 py-2 text-mutedForeground">{row.facilityKind}</td>
                <td className="px-3 py-2 text-mutedForeground">{formatNumber(row.assignedCustomers)}</td>
                <td className="px-3 py-2 text-mutedForeground">{formatNumber(row.assignedShipments)}</td>
                <td className="px-3 py-2 text-mutedForeground">{row.status === "OPEN" ? row.capacityStatus : "CLOSED"}</td>
                <td className="px-3 py-2 text-mutedForeground">{formatMoney(row.transportationCost)}</td>
                <td className="px-3 py-2 text-mutedForeground">{formatMoney(row.fixedOrOperatingCost)}</td>
                <td className="px-3 py-2 text-mutedForeground">{formatMoney(row.proposedObservedCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function CustomerMovementTable({ comparison }: { comparison: ReturnType<typeof compareSupplyChainDesignScenarios> }) {
  if (comparison.scenarios.length !== 2) {
    return <p className="text-sm text-mutedForeground">Customer movement is shown when exactly two scenarios are selected.</p>;
  }

  return (
    <details className="rounded-md border border-border bg-background p-4">
      <summary className="cursor-pointer text-sm font-semibold text-foreground">Customer movement summary</summary>
      {comparison.customerMovementRows.length === 0 ? (
        <p className="mt-3 text-sm text-mutedForeground">No customer assignments changed between the two selected scenarios.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-mutedForeground">
              <tr>
                <th className="px-3 py-2 font-semibold">Customer ID</th>
                <th className="px-3 py-2 font-semibold">Customer name</th>
                <th className="px-3 py-2 font-semibold">Assignment in Scenario A</th>
                <th className="px-3 py-2 font-semibold">Assignment in Scenario B</th>
                <th className="px-3 py-2 font-semibold">Cost per shipment in Scenario A</th>
                <th className="px-3 py-2 font-semibold">Cost per shipment in Scenario B</th>
                <th className="px-3 py-2 font-semibold">Difference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {comparison.customerMovementRows.map((row) => (
                <tr key={row.customerId}>
                  <td className="px-3 py-2 font-medium text-foreground">{row.customerId}</td>
                  <td className="px-3 py-2 text-mutedForeground">{row.customerName}</td>
                  <td className="px-3 py-2 text-mutedForeground">{row.assignmentA}</td>
                  <td className="px-3 py-2 text-mutedForeground">{row.assignmentB}</td>
                  <td className="px-3 py-2 text-mutedForeground">{formatNullableMoney(row.costPerShipmentA)}</td>
                  <td className="px-3 py-2 text-mutedForeground">{formatNullableMoney(row.costPerShipmentB)}</td>
                  <td className="px-3 py-2 text-mutedForeground">{formatNullableMoney(row.difference)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

function highestCostFacility(scenario: SupplyChainDesignScenarioSummary) {
  const rows = scenario.resultSummary?.facilitySummary ?? [];
  if (rows.length === 0) {
    return "Not available";
  }

  const sorted = [...rows].sort(
    (left, right) => right.proposedObservedCost - left.proposedObservedCost || left.facilityId.localeCompare(right.facilityId)
  );
  return `${sorted[0].facilityId} (${formatMoney(sorted[0].proposedObservedCost)})`;
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(date);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 2
  }).format(value);
}

function formatMoney(value: number) {
  return formatNumber(value);
}

function formatNullableMoney(value: number | null) {
  return typeof value === "number" ? formatMoney(value) : "Not available";
}

function formatPercent(value: number | null) {
  return typeof value === "number" ? `${value.toFixed(1)}%` : "Not available";
}
