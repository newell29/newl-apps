"use client";

import { useMemo, useState } from "react";

import { WarehouseLocationStrategyMap } from "@/modules/supply-chain-design/components/warehouse-location-strategy-map";
import type { WarehouseLocationStrategyResultSummary } from "@/modules/supply-chain-design/warehouse-location-strategy";

export function WarehouseLocationStrategySolutionViewer({
  result,
  activeRunId,
  selectedSolutionId
}: {
  result: WarehouseLocationStrategyResultSummary;
  activeRunId: string;
  selectedSolutionId?: string | null;
}) {
  const recommendedIds = new Set((result.recommendedSolutions?.length ? result.recommendedSolutions : [result.recommendedSolution]).map((solution) => solution.solutionId));
  const initialSolutionId = result.solutions.some((solution) => solution.solutionId === selectedSolutionId) ? selectedSolutionId! : result.recommendedSolution.solutionId;
  const [solutionId, setSolutionId] = useState(initialSolutionId);
  const solution = result.solutions.find((candidate) => candidate.solutionId === solutionId) ?? result.recommendedSolution;
  const isRecommended = recommendedIds.has(solution.solutionId);

  const rows = useMemo(() => solution.regions.map((region) => [
    region.broadRegionApproximation ? `${region.recommendedMarketLabel} (broad regional recommendation)` : region.recommendedMarketLabel,
    region.stateProvince ? `${region.country} / ${region.stateProvince}` : region.country,
    `${region.centerLatitude}, ${region.centerLongitude}`,
    region.searchRadiusMiles === null ? "Broad Canadian approximation" : `${formatNumber(region.searchRadiusMiles)} miles`,
    formatNumber(region.assignedProfileCount),
    formatNumber(region.distinctDestinationCount),
    formatNumber(region.shipmentsRepresented),
    ...(result.weightingMethod !== "SHIPMENTS_REPRESENTED" ? [formatSelectedMetric(region.selectedMetricWeight, result.selectedDemandCurrency)] : []),
    `${formatNumber(region.selectedDemandSharePercent)}%`,
    `${formatNumber(region.averageAssignedDistance)} miles`
  ]), [result.selectedDemandCurrency, result.weightingMethod, solution]);

  function selectSolution(nextSolutionId: string) {
    if (nextSolutionId === solutionId) return;
    setSolutionId(nextSolutionId);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "warehouse-location-strategy");
    url.searchParams.set("locationStrategySolutionId", nextSolutionId);
    window.history.replaceState(window.history.state, "", url.toString());
  }

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-border bg-background p-4">
        <h4 className="text-sm font-semibold text-foreground">Interactive Map</h4>
        <div className="mt-3">
          <WarehouseLocationStrategyMap
            key={activeRunId}
            result={result}
            activeRunId={activeRunId}
            selectedSolutionId={solution.solutionId}
            onSolutionChange={selectSolution}
          />
        </div>
      </section>
      <section className="rounded-md border border-border bg-background p-4">
        <h4 className="text-sm font-semibold text-foreground">{isRecommended ? "Recommended Warehouse Search Regions" : "Available Warehouse Search Regions"}</h4>
        <div className="mt-3 mb-3 rounded-md border border-border bg-muted/30 p-3 text-sm text-mutedForeground">
          <p className="font-semibold text-foreground">
            Viewing: {formatRegionCount(solution.regionCount)} - {isRecommended ? "recommended" : "available, not recommended"}
          </p>
          {!isRecommended ? <p className="mt-1">{availableSolutionReason(solution)}</p> : null}
        </div>
        <p className="mb-3 text-sm text-mutedForeground">This table shows the individual regions and practical warehouse markets for the currently selected option.</p>
        <Table
          headers={[
            "Recommended warehouse market",
            "Country / province / state",
            "Calculated demand center",
            "85% demand coverage radius",
            "Assigned destination profiles",
            "Distinct destinations",
            "Shipments represented",
            ...(result.weightingMethod !== "SHIPMENTS_REPRESENTED" ? [selectedMetricHeader(result)] : []),
            "Share of selected demand",
            "Average distance to assigned region center"
          ]}
          rows={rows}
        />
        <p className="mt-3 text-xs text-mutedForeground">The calculated demand center drives the geographic analysis. The named market is the nearest supported practical warehouse market.</p>
      </section>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-mutedForeground">
          <tr>{headers.map((header) => <th key={header} className="px-3 py-2 font-semibold">{header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border bg-background">
          {rows.map((row, index) => <tr key={`${index}-${row.join("|")}`}>{row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 text-mutedForeground">{cell || "-"}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function selectedMetricHeader(result: WarehouseLocationStrategyResultSummary) {
  const label = result.weightingMethod === "CURRENT_TRANSPORTATION_COST"
    ? "Historical transportation spend represented"
    : result.weightingMethod === "PALLETS"
      ? "Pallets represented"
      : result.weightingMethod === "WEIGHT"
        ? "Weight represented"
        : "Units represented";
  return result.selectedDemandCurrency ? `${label} (${result.selectedDemandCurrency})` : label;
}

function formatSelectedMetric(value: number, currency?: string | null) {
  return currency ? `${formatNumber(value)} ${currency}` : formatNumber(value);
}

function formatRegionCount(value: number) {
  if (value === 1) return "One warehouse region";
  if (value === 2) return "Two warehouse regions";
  return "Three warehouse regions";
}

function availableSolutionReason(solution: WarehouseLocationStrategyResultSummary["solutions"][number]) {
  return solution.recommendationExplanation.replace(/^Not recommended - /, "").replace(/^Available - /, "");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value);
}
