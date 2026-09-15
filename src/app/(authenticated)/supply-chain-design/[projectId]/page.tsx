import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { SupplyChainDesignFileUploadForm } from "@/modules/supply-chain-design/components/file-upload-form";
import { SupplyChainDesignModel01ProofRunForm } from "@/modules/supply-chain-design/components/model-01-proof-run-form";
import { SupplyChainDesignNetworkDesignRunForm } from "@/modules/supply-chain-design/components/network-design-run-form";
import { SupplyChainDesignNetworkDesignProgressPoller } from "@/modules/supply-chain-design/components/network-design-progress-poller";
import { SupplyChainDesignNetworkScenarioComparisonForm } from "@/modules/supply-chain-design/components/network-scenario-comparison-form";
import { SupplyChainDesignNetworkScenarioComparisonProgressPoller } from "@/modules/supply-chain-design/components/network-scenario-comparison-progress-poller";
import { NetworkScenarioComparisonPagedTable } from "@/modules/supply-chain-design/components/network-scenario-comparison-result-tables";
import { SupplyChainDesignWarehouseLocationStrategyForm } from "@/modules/supply-chain-design/components/warehouse-location-strategy-form";
import { WarehouseLocationStrategySolutionViewer } from "@/modules/supply-chain-design/components/warehouse-location-strategy-solution-viewer";
import { DeleteConfirmationCancelButton } from "@/modules/supply-chain-design/components/delete-confirmation-cancel-button";
import {
  deleteSupplyChainDesignFileMappingFormAction,
  deleteSupplyChainDesignProjectFileFormAction,
  deleteSupplyChainDesignNetworkScenarioComparisonRunFormAction,
  deleteSupplyChainDesignRunFormAction,
  deleteSupplyChainDesignWarehouseLocationStrategyRunFormAction
} from "@/modules/supply-chain-design/actions";
import { requireSupplyChainDesignStudioAccess } from "@/modules/supply-chain-design/access";
import { getSupplyChainDesignProject } from "@/modules/supply-chain-design/queries";
import {
  alternativeRows,
  buildNetworkScenarioComparisonCostRows,
  facilitySummaryRows,
  hasCompetingAlternatives,
  networkScenarioComparisonSavingsCallout,
  winningDeliveryAssignmentRows
} from "@/modules/supply-chain-design/network-scenario-comparison-reporting";
import type { NetworkScenarioComparisonRunListItem } from "@/modules/supply-chain-design/network-scenario-comparison-persistence";
import type {
  SupplyChainDesignLtlRateBatchSummary,
  SupplyChainDesignLtlRatePreparationRunSummary,
  SupplyChainDesignModel01ProofResultSummary,
  SupplyChainDesignProjectDetail
} from "@/modules/supply-chain-design/types";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<{ tab?: string; networkDesignBatchId?: string; locationStrategyRunId?: string; locationStrategyStatus?: string; locationStrategySolutionId?: string; warehouseCostComparisonRunId?: string }>;
};

const PROJECT_TABS = [
  { id: "project-data", label: "Project Data" },
  { id: "current-network-baseline", label: "Current Network Baseline" },
  { id: "network-design", label: "Network Design" },
  { id: "warehouse-location-strategy", label: "Warehouse Location Strategy" },
  { id: "warehouse-cost-comparison", label: "Network Scenario Comparison" },
  { id: "run-history", label: "Run History" }
] as const;

export default async function SupplyChainDesignProjectPage({ params, searchParams }: PageProps) {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  const { projectId } = await params;
  const { tab, networkDesignBatchId, locationStrategyRunId, locationStrategyStatus, locationStrategySolutionId, warehouseCostComparisonRunId } = (await searchParams) ?? {};
  const project = await getSupplyChainDesignProject(context, projectId);
  if (!project) notFound();
  const activeTab = PROJECT_TABS.some((candidate) => candidate.id === tab) ? tab! : "project-data";
  const requestedLtlRateBatch = project.recentLtlRateBatches.find((batch) => batch.id === networkDesignBatchId) ?? null;
  const activeLtlRateBatch = project.recentLtlRateBatches.find((batch) => batch.status === "QUEUED" || batch.status === "RUNNING") ?? null;
  const selectedLtlResultBatch =
    requestedLtlRateBatch && requestedLtlRateBatch !== activeLtlRateBatch
      ? requestedLtlRateBatch
      : project.recentLtlRateBatches.find((batch) => batch.status === "SUCCESS") ?? project.latestLtlRateBatch;
  const selectedLtlRateBatch = activeLtlRateBatch ?? selectedLtlResultBatch;
  const hasActiveNetworkDesignBatch = Boolean(activeLtlRateBatch);
  const showNetworkDesignPreparation = !hasActiveNetworkDesignBatch && !selectedLtlRateBatch;
  const networkDesignProgress = getNetworkDesignProgress(project.latestLtlRatePreparationRun, activeLtlRateBatch ?? selectedLtlResultBatch);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Supply Chain Design Studio" title={project.name} description={project.description ?? "Current Network Baseline workspace."} />
      <Link href="/supply-chain-design" className="text-sm font-semibold text-primary hover:underline">Back to projects</Link>
      <ProjectTabs projectId={project.id} activeTab={activeTab} />
      {activeTab === "project-data" ? <ProjectDataPanel project={project} /> : null}
      {activeTab === "current-network-baseline" ? <CurrentNetworkBaselinePanel project={project} /> : null}
      {activeTab === "network-design" ? (
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <ModelRunLayout>
            <div>
              <h2 className="text-base font-semibold text-foreground">Network Design</h2>
              <p className="mt-1 text-sm text-mutedForeground">
                Compare the customer&apos;s current transportation and warehouse costs with each selected candidate warehouse.
              </p>
              <div className="mt-4">
                {project.candidateLtlRatePreparation.canRun && project.candidateLtlRatePreparation.inputSelection ? (
                  <SupplyChainDesignNetworkDesignRunForm
                    projectId={project.id}
                    inputSelection={project.candidateLtlRatePreparation.inputSelection}
                    preparationRunId={project.latestLtlRatePreparationRun?.id ?? null}
                    initialSelectedCandidateFacilityIds={selectedLtlRateBatch?.savedInputSelection?.selectedCandidateFacilityIds ?? null}
                  />
                ) : (
                  <EmptyState>Add the missing Network Design input before running: {project.candidateLtlRatePreparation.missingInputs.join(" and ")}.</EmptyState>
                )}
              </div>
              {!hasActiveNetworkDesignBatch ? (
                <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-sm text-mutedForeground">
                  <p className="font-semibold text-foreground">{networkDesignProgress.label}</p>
                  <p className="mt-1">{networkDesignProgress.description}</p>
                  {networkDesignProgress.needsReview ? <a href="#ltl-review" className="mt-2 inline-flex font-semibold text-primary hover:underline">Review excluded or incomplete rows</a> : null}
                </div>
              ) : null}
            </div>
            <div>
              {showNetworkDesignPreparation ? <h3 className="text-sm font-semibold uppercase tracking-wide text-mutedForeground">Network Design Progress</h3> : null}
              {showNetworkDesignPreparation && project.latestLtlRatePreparationRun ? <LatestLtlRatePreparationRun run={project.latestLtlRatePreparationRun} /> : null}
              {showNetworkDesignPreparation && !project.latestLtlRatePreparationRun ? <EmptyState>No LTL rate requests have been prepared yet.</EmptyState> : null}
              {activeLtlRateBatch ? <LatestLtlRateBatch projectId={project.id} batch={activeLtlRateBatch} /> : null}
              {selectedLtlResultBatch && selectedLtlResultBatch.id !== activeLtlRateBatch?.id ? <LatestLtlRateBatch projectId={project.id} batch={selectedLtlResultBatch} /> : null}
              {!activeLtlRateBatch && !selectedLtlResultBatch ? <EmptyState>No 7L rate batch has been run yet.</EmptyState> : null}
              {project.recentLtlRateBatches.length > 0 ? <NetworkDesignRunHistory projectId={project.id} batches={project.recentLtlRateBatches} selectedBatchId={selectedLtlResultBatch?.id ?? activeLtlRateBatch?.id ?? null} /> : null}
            </div>
          </ModelRunLayout>
        </section>
      ) : null}
      {activeTab === "warehouse-location-strategy" ? <WarehouseLocationStrategyPanel project={project} selectedRunId={locationStrategyRunId} selectedSolutionId={locationStrategySolutionId} locationStrategyStatus={locationStrategyStatus} /> : null}
      {activeTab === "warehouse-cost-comparison" ? <WarehouseCostComparisonPanel project={project} selectedRunId={warehouseCostComparisonRunId} /> : null}
      {activeTab === "run-history" ? <RunHistoryPanel project={project} /> : null}
    </div>
  );
}

function ProjectTabs({ projectId, activeTab }: { projectId: string; activeTab: string }) {
  return <nav className="flex flex-wrap gap-2 border-b border-border pb-3">{PROJECT_TABS.map((tab) => <Link key={tab.id} href={`/supply-chain-design/${projectId}?tab=${tab.id}`} className={`rounded-md px-3 py-2 text-sm font-semibold ${activeTab === tab.id ? "bg-primary text-primaryForeground" : "bg-muted text-mutedForeground hover:text-foreground"}`}>{tab.label}</Link>)}</nav>;
}

function ProjectDataPanel({ project }: { project: SupplyChainDesignProjectDetail }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="text-base font-semibold text-foreground">Project Data</h2>
      <p className="mt-1 text-sm text-mutedForeground">
        Upload and manage the shared datasets used across Supply Chain Design analyses.
      </p>

      <div className="mt-5 rounded-md border border-border bg-background p-4">
        <h3 className="text-sm font-semibold text-foreground">Download templates</h3>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link href="/supply-chain-design/templates/current-facilities-and-costs-template.csv" className="font-semibold text-primary hover:underline">
            Current Facilities and Warehouse Costs
          </Link>
          <Link href="/supply-chain-design/templates/historical-shipments-template.csv" className="font-semibold text-primary hover:underline">
            Historical Shipments
          </Link>
          <Link href="/supply-chain-design/templates/candidate-warehouses-and-costs-template.csv" className="font-semibold text-primary hover:underline">
            Candidate Warehouses and Proposed Costs
          </Link>
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-foreground">Upload data</h3>
        <div className="mt-3">
        <SupplyChainDesignFileUploadForm projectId={project.id} existingFileNames={project.files.map((file) => file.originalFileName)} />
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Uploaded files</h3>
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-mutedForeground">
            <tr>
              <th className="px-3 py-2">File</th>
              <th className="px-3 py-2">Rows</th>
              <th className="px-3 py-2">Mapping</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {project.files.map((file) => (
              <tr key={file.id}>
                <td className="px-3 py-2">
                  <Link href={`/supply-chain-design/${project.id}/files/${file.id}`} className="font-semibold text-primary hover:underline">
                    {file.originalFileName}
                  </Link>
                </td>
                <td className="px-3 py-2 text-mutedForeground">{formatNumber(file.rowCount)}</td>
                <td className="px-3 py-2 text-mutedForeground">{file.mappingDisplayStatus}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link href={`/supply-chain-design/${project.id}/files/${file.id}`} className="text-xs font-semibold text-primary hover:underline">
                      View mapping
                    </Link>
                    {file.mappingId ? (
                      <details>
                        <summary className="cursor-pointer text-xs font-semibold text-danger">Delete mapping</summary>
                        <div className="mt-2 rounded-md border border-border bg-background p-3">
                          <p className="text-xs text-mutedForeground">
                            Deleting this mapping will keep the uploaded file, but analyses cannot use it until a new mapping is saved.
                          </p>
                          <form action={deleteSupplyChainDesignFileMappingFormAction} className="mt-2 flex items-center gap-2">
                            <input type="hidden" name="projectId" value={project.id} />
                            <input type="hidden" name="mappingId" value={file.mappingId} />
                            <DeleteConfirmationCancelButton />
                            <button type="submit" name="confirmDelete" value="on" className="rounded-md bg-danger px-2 py-1 font-semibold text-dangerForeground">
                              Confirm delete
                            </button>
                          </form>
                        </div>
                      </details>
                    ) : null}
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-danger">Delete file</summary>
                      <div className="mt-2 rounded-md border border-border bg-background p-3">
                        <p className="text-xs text-mutedForeground">
                          Deleting this file will also delete its saved mapping. Future analyses cannot use this data.
                        </p>
                        <form action={deleteSupplyChainDesignProjectFileFormAction} className="mt-2 flex items-center gap-2">
                          <input type="hidden" name="projectId" value={project.id} />
                          <input type="hidden" name="fileId" value={file.id} />
                          <DeleteConfirmationCancelButton />
                          <button type="submit" name="confirmDelete" value="on" className="rounded-md bg-danger px-2 py-1 font-semibold text-dangerForeground">
                            Confirm delete
                          </button>
                        </form>
                      </div>
                    </details>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CurrentNetworkBaselinePanel({ project }: { project: SupplyChainDesignProjectDetail }) {
  const result = project.latestModelRun?.resultSummary ?? null;
  const shipmentFileId = project.latestModelRun?.inputReferences?.shipments?.fileId ?? null;
  const shipmentSourceRows = shipmentFileId ? project.files.find((file) => file.id === shipmentFileId)?.rowCount ?? null : null;

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <ModelRunLayout>
        <div>
          <h2 className="text-base font-semibold text-foreground">Current Network Baseline</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Review the customer&apos;s existing facilities, shipment activity, transportation costs, inventory, facility costs, service performance and capacity using the available project data.
          </p>
          <div className="mt-4">
            {project.model01Proof.canRun && project.model01Proof.inputSelection ? (
              <SupplyChainDesignModel01ProofRunForm projectId={project.id} inputSelection={project.model01Proof.inputSelection} />
            ) : (
              <EmptyState>Add the missing Current Network Baseline input before running: {project.model01Proof.missingInputs.join(" and ")}.</EmptyState>
            )}
          </div>
        </div>
        <div>
          {result ? (
            <CurrentNetworkBaselineResult
              result={result}
              runDate={project.latestModelRun?.createdAt ?? null}
              shipmentSourceRows={shipmentSourceRows}
              weightUnit={project.latestModelRun?.weightUnit ?? null}
              weightUnitWarning={project.latestModelRun?.weightUnitWarning ?? null}
            />
          ) : (
            <>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-mutedForeground">Current Network Summary</h3>
              <EmptyState>No Current Network Baseline run has been saved yet.</EmptyState>
            </>
          )}
        </div>
      </ModelRunLayout>
    </section>
  );
}

function CurrentNetworkBaselineResult({
  result,
  runDate,
  shipmentSourceRows,
  weightUnit,
  weightUnitWarning
}: {
  result: SupplyChainDesignModel01ProofResultSummary;
  runDate: Date | string | null;
  shipmentSourceRows: number | null;
  weightUnit: string | null;
  weightUnitWarning: string | null;
}) {
  const cards = buildCurrentNetworkSummaryCards(result, shipmentSourceRows, weightUnit, Boolean(weightUnitWarning));
  const utilizationByFacility = new Map(
    (result.snapshotPalletUtilization ?? [])
      .filter((row) => row.latest)
      .map((row) => [row.facilityId, row.utilizationPercent])
  );
  const showFacilityType = result.facilitySummary.some((row) => row.facilityType);
  const showFacilityCost = result.facilitySummary.some((row) => row.facilityOperatingCost !== null);
  const showTransportationCost = result.facilitySummary.some((row) => row.transportationCost !== null);
  const showPallets = result.facilitySummary.some((row) => row.pallets !== null);
  const showUnits = result.facilitySummary.some((row) => row.units !== null);
  const showWeight = result.facilitySummary.some((row) => row.weight !== null);
  const showInventoryQuantity = result.facilitySummary.some((row) => row.inventoryQuantity !== null);
  const showInventoryValue = result.facilitySummary.some((row) => row.inventoryValue !== null);
  const showObservedCost = result.facilitySummary.some((row) => row.observedCost !== null);
  const showUtilization = utilizationByFacility.size > 0;
  const headers = [
    "Facility",
    ...(showFacilityType ? ["Facility type"] : []),
    "Historical shipment activity",
    ...(showTransportationCost ? ["Transportation cost"] : []),
    ...(showFacilityCost ? ["Annual facility and warehouse cost"] : []),
    ...(showObservedCost ? ["Observed network cost"] : []),
    ...(showPallets ? ["Pallets"] : []),
    ...(showUnits ? ["Units"] : []),
    ...(showWeight ? ["Weight"] : []),
    ...(showInventoryQuantity ? ["Current inventory units"] : []),
    ...(showInventoryValue ? ["Current inventory value"] : []),
    ...(showUtilization ? ["Capacity utilization"] : [])
  ];
  const rows = result.facilitySummary.map((facility) => [
    `${facility.facilityId} - ${facility.facilityName}`,
    ...(showFacilityType ? [facility.facilityType ?? "-"] : []),
    formatNumber(facility.shipmentCount),
    ...(showTransportationCost ? [facility.transportationCost === null ? "-" : formatMoney(facility.transportationCost)] : []),
    ...(showFacilityCost ? [facility.facilityOperatingCost === null ? "-" : formatMoney(facility.facilityOperatingCost)] : []),
    ...(showObservedCost ? [facility.observedCost === null ? "-" : formatMoney(facility.observedCost)] : []),
    ...(showPallets ? [facility.pallets === null ? "-" : formatNumber(facility.pallets)] : []),
    ...(showUnits ? [facility.units === null ? "-" : formatNumber(facility.units)] : []),
    ...(showWeight ? [facility.weight === null ? "-" : formatWeight(facility.weight, weightUnit)] : []),
    ...(showInventoryQuantity ? [facility.inventoryQuantity === null ? "-" : formatNumber(facility.inventoryQuantity)] : []),
    ...(showInventoryValue ? [facility.inventoryValue === null ? "-" : formatMoney(facility.inventoryValue)] : []),
    ...(showUtilization ? [utilizationByFacility.has(facility.facilityId) ? formatPercent(utilizationByFacility.get(facility.facilityId) ?? 0) : "-"] : [])
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-mutedForeground">Current Network Summary</h3>
        {runDate ? <p className="mt-1 text-xs text-mutedForeground">Prepared {formatDateTime(runDate)}</p> : null}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <SummaryCard key={card.label} label={card.label} value={card.value} />
          ))}
        </div>
        {weightUnitWarning ? <p className="mt-2 text-xs text-mutedForeground">{weightUnitWarning}</p> : null}
      </div>
      <DetailPanel title="Facility Summary">
        <AnalysisTable headers={headers} rows={rows} />
      </DetailPanel>
    </div>
  );
}

function buildCurrentNetworkSummaryCards(
  result: SupplyChainDesignModel01ProofResultSummary,
  shipmentSourceRows: number | null,
  weightUnit: string | null,
  hasWeightUnitWarning: boolean
) {
  const cards: Array<{ label: string; value: string }> = [
    { label: "Current facilities", value: formatNumber(result.facilityCount) }
  ];
  if (shipmentSourceRows !== null) {
    cards.push({ label: "Historical shipment source rows", value: formatNumber(shipmentSourceRows) });
  }
  cards.push({ label: "Historical shipments represented", value: formatNumber(result.shipmentCount) });
  if (result.totalTransportationCost !== null) {
    cards.push({ label: "Total transportation cost", value: formatMoney(result.totalTransportationCost) });
  }
  if (result.totalFacilityOperatingCost !== null) {
    cards.push({ label: "Total annual facility and warehouse cost", value: formatMoney(result.totalFacilityOperatingCost) });
  }
  const observedNetworkCost = getPrimaryObservedNetworkCost(result);
  if (observedNetworkCost !== null) {
    cards.push({ label: "Total observed network cost", value: formatMoney(observedNetworkCost) });
  }
  if (result.volumeSummary?.totalPallets !== null && result.volumeSummary?.totalPallets !== undefined) {
    cards.push({ label: "Total pallets", value: formatNumber(result.volumeSummary.totalPallets) });
  }
  if (result.volumeSummary?.totalUnits !== null && result.volumeSummary?.totalUnits !== undefined) {
    cards.push({ label: "Total units", value: formatNumber(result.volumeSummary.totalUnits) });
  }
  if (result.volumeSummary?.totalWeight !== null && result.volumeSummary?.totalWeight !== undefined && !hasWeightUnitWarning) {
    cards.push({ label: "Total weight", value: formatWeight(result.volumeSummary.totalWeight, weightUnit) });
  }
  if (result.inventoryQuantity !== null) {
    cards.push({ label: "Inventory units", value: formatNumber(result.inventoryQuantity) });
  }
  if (result.inventoryValue !== null) {
    cards.push({ label: "Inventory value", value: formatMoney(result.inventoryValue) });
  }
  if (result.averageServiceDays !== null) {
    cards.push({ label: "Average transit days", value: result.averageServiceDays.toFixed(1) });
  }
  return cards;
}

function getPrimaryObservedNetworkCost(result: SupplyChainDesignModel01ProofResultSummary) {
  if (result.observedNetworkCostByCurrency?.length === 1) {
    return result.observedNetworkCostByCurrency[0]?.observedCost ?? null;
  }
  if (result.totalTransportationCost !== null || result.totalFacilityOperatingCost !== null) {
    return (result.totalTransportationCost ?? 0) + (result.totalFacilityOperatingCost ?? 0);
  }
  return null;
}

function WarehouseLocationStrategyPanel({
  project,
  selectedRunId,
  selectedSolutionId,
  locationStrategyStatus
}: {
  project: SupplyChainDesignProjectDetail;
  selectedRunId?: string;
  selectedSolutionId?: string;
  locationStrategyStatus?: string;
}) {
  const displayedRun = project.recentWarehouseLocationStrategyRuns.find((run) => run.id === selectedRunId) ?? project.latestWarehouseLocationStrategyRun;
  const activeRunId = displayedRun?.id ?? null;
  const result = displayedRun?.resultSummary ?? null;
  const recommended = result?.recommendedSolution ?? null;
  const selectedSolution = result?.solutions.find((solution) => solution.solutionId === selectedSolutionId) ?? recommended;
  const higherAvailableSolutions = result && recommended
    ? result.solutions.filter((solution) => solution.regionCount > recommended.regionCount && solution.recommendationStatus === "Available")
    : [];
  const firstHigherAvailableSolution = higherAvailableSolutions[0] ?? null;
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <ModelRunLayout>
        <div>
          <h2 className="text-base font-semibold text-foreground">Warehouse Location Strategy</h2>
          <p className="mt-1 text-sm text-mutedForeground">Identify promising warehouse search regions based on the geographic concentration of historical delivery activity.</p>
          <div className="mt-4">
            {project.warehouseLocationStrategy.canRun && project.warehouseLocationStrategy.inputSelection ? (
              <SupplyChainDesignWarehouseLocationStrategyForm
                projectId={project.id}
                inputSelection={project.warehouseLocationStrategy.inputSelection}
                initialSettings={displayedRun?.inputReferences ? {
                  shipmentsMappingId: displayedRun.inputReferences.shipments.mappingId,
                  maxRegions: displayedRun.inputReferences.maxRegions,
                  weightingMethod: displayedRun.inputReferences.weightingMethod,
                  countryScope: displayedRun.inputReferences.countryScope,
                  cadToUsdRate: displayedRun.inputReferences.cadToUsdRate ?? result?.cadToUsdRate ?? null
                } : null}
              />
            ) : (
              <EmptyState>Add the missing Warehouse Location Strategy input before running: {project.warehouseLocationStrategy.missingInputs.join(" and ")}.</EmptyState>
            )}
          </div>
        </div>
        <div className="space-y-4">
          {locationStrategyStatus === "reused" ? (
            <div className="rounded-md border border-success/40 bg-success/10 p-3 text-sm font-medium text-success">
              An existing report with the same data and settings was opened.
            </div>
          ) : null}
          {displayedRun && result && recommended ? (
            <>
              <DetailPanel title="Recommended Strategy">
                <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Report from {formatDateTime(displayedRun.createdAt)}</p>
                <p className="mt-1 text-sm font-semibold text-foreground">Viewing saved analysis: {formatLocationStrategyWeighting(result.weightingMethod)} {" - "} {formatLocationStrategyScope(result.countryScope)} {" - "} up to {formatNumber(result.maxRegions)} {result.maxRegions === 1 ? "region" : "regions"}</p>
                {result.spendCurrencyMode === "CONVERTED_MIXED_CURRENCY" && result.cadToUsdRate ? (
                  <p className="mt-1 text-sm text-mutedForeground">Historical transportation spend converted to USD using 1 CAD = {result.cadToUsdRate} USD.</p>
                ) : null}
                <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <SummaryCard label="Eligible destination profiles" value={formatNumber(result.eligibleDestinationProfiles)} />
                  <SummaryCard label="Shipments represented" value={formatNumber(result.shipmentsRepresented)} />
                  <SummaryCard label="Selected weighting method" value={formatLocationStrategyWeighting(result.weightingMethod)} />
                  <SummaryCard label="Selected metric total" value={formatLocationStrategySelectedMetric(result.selectedTotalDemandWeight, result.selectedDemandCurrency)} />
                  <SummaryCard label="Warehouse network option" value={formatLocationStrategyScope(result.countryScope)} />
                  {result.excludedDestinationCount > 0 ? <SummaryCard label="Excluded destinations" value={formatNumber(result.excludedDestinationCount)} /> : null}
                  <SummaryCard label="Recommended regions" value={formatNumber(result.recommendedRegionCount)} />
                </div>
                <p className="text-sm font-semibold text-foreground">{formatLocationStrategyRecommendation(result)}</p>
                <p className="mt-2 text-sm text-mutedForeground">{recommended.recommendationExplanation}</p>
                <p className="mt-2 text-xs text-mutedForeground">Location Strategy assigns each historical destination to a proposed geographic service region. It does not allocate SKUs or calculate inventory quantities.</p>
                <p className="mt-1 text-xs text-mutedForeground">The model calculates geographic centers that minimize weighted straight-line distance from historical delivery destinations. The named warehouse market is the nearest supported practical logistics market to each calculated center.</p>
                <p className="mt-2 text-xs text-mutedForeground">Location Strategy includes all valid delivery activity because every shipment contributes to warehouse demand.</p>
                <p className="mt-1 text-xs text-mutedForeground">Distances are straight-line geographic distances, not road miles or drive time.</p>
                {result.countryScope === "SEPARATE_BY_COUNTRY" ? (
                  <p className="mt-1 text-xs text-mutedForeground">Maximum regions applies separately to each independently analyzed country.</p>
                ) : null}
                {firstHigherAvailableSolution ? (
                  <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-sm text-mutedForeground">
                    <p>
                      {formatLocationStrategyRegionCount(firstHigherAvailableSolution.regionCount)} were also calculated, but were not automatically recommended because {locationStrategyAvailableSolutionReason(firstHigherAvailableSolution)}
                    </p>
                  </div>
                ) : null}
              </DetailPanel>
              <WarehouseLocationStrategySolutionViewer result={result} activeRunId={activeRunId ?? "latest"} selectedSolutionId={selectedSolution?.solutionId} />
              <DetailPanel title="Region-Count Comparison">
                <p className="mb-2 text-sm text-mutedForeground">Compare the geographic effect of using one, two, or three warehouse regions. Average distance measures delivery demand to its assigned calculated region center. The coverage radius is a separate measure showing where approximately 85% of assigned weighted demand is concentrated.</p>
                <p className="mb-3 text-xs text-mutedForeground">Distance reduction compared with one region uses the one-region option as the baseline. Additional reduction from newest region compares each option with the immediately preceding option.</p>
                <AnalysisTable
                  headers={[
                    "Regions",
                    <span key="markets" className="inline-flex items-center gap-1">Practical warehouse markets <HeaderHelp label="Practical warehouse markets help" text="The supported practical warehouse markets associated with the calculated region centers in this option. These market names are not the calculated-center coordinates." /></span>,
                    "Operating complexity",
                    <span key="average-distance" className="inline-flex items-center gap-1">Average distance to assigned region center <HeaderHelp label="Average distance to assigned region center help" text="The average straight-line distance between delivery destinations and their assigned calculated region center, weighted by the selected demand measure. This is different from the 85% demand coverage radius." /></span>,
                    "Maximum distance",
                    "Demand within 250 miles",
                    <span key="distance-reduction-one" className="inline-flex items-center gap-1">Distance reduction compared with one region <HeaderHelp label="Distance reduction compared with one region help" text="The percentage decrease in average distance to assigned region centers compared with serving all eligible demand using one warehouse region." /></span>,
                    <span key="additional-reduction" className="inline-flex items-center gap-1">Additional reduction from newest region <HeaderHelp label="Additional reduction from newest region help" text="The additional percentage decrease achieved by this option compared with the immediately preceding region-count option. For three regions, this compares three regions with two regions." /></span>,
                    <span key="smallest-share" className="inline-flex items-center gap-1">Smallest region share of selected demand <HeaderHelp label="Smallest region share of selected demand help" text="The percentage of selected demand assigned to the smallest proposed region. Every region in an automatically recommended solution must represent at least 10% of selected demand." /></span>,
                    "Recommendation"
                  ]}
                  rows={result.solutions.map((solution) => [
                    `${solution.regionCount === 1 ? "One" : solution.regionCount === 2 ? "Two" : "Three"} warehouse ${solution.regionCount === 1 ? "region" : "regions"}${solution.country ? ` (${solution.country})` : ""}`,
                    <span key={`${solution.solutionId}-markets`} className="block max-w-56 whitespace-normal normal-case leading-relaxed">{solution.regions.map((region) => region.recommendedMarketLabel).join("; ")}</span>,
                    solution.complexity,
                    `${formatNumber(solution.averageWeightedDistance)} miles`,
                    `${formatNumber(solution.maximumAssignedDistance)} miles`,
                    `${formatNumber(solution.demandWithinDistanceBands.find((band) => band.maximumMiles === 250)?.selectedWeightPercent ?? 0)}%`,
                    solution.improvementVersusOneRegionPercent === null ? "Reference option" : `${formatNumber(solution.improvementVersusOneRegionPercent)}%`,
                    solution.incrementalImprovementPercent === null ? "Reference option" : `${formatNumber(solution.incrementalImprovementPercent)}%`,
                    `${formatNumber(solution.minimumRegionDemandSharePercent)}%`,
                    solution.recommendationExplanation
                  ])}
                />
              </DetailPanel>
              <DetailPanel title="Analysis Assumptions">
                <AnalysisTable
                  headers={["Assumption", "Current setting", "Meaning"]}
                  rows={[
                    ["Additional region improvement", "15%", "An additional region must improve weighted average straight-line distance by at least 15% before it becomes the automatic recommendation."],
                    ["Minimum selected-demand share", "10%", "Every proposed region in the automatic recommendation must represent at least 10% of selected demand."],
                    ["Distance method", "Haversine", "Distances are straight-line geographic distances, not road miles or drive time."],
                    ["Coverage radius", "Weighted 85th percentile rounded to 25 miles", "The search radius shows where most assigned historical demand is located around the calculated demand center."]
                  ]}
                />
                <p className="mt-3 text-xs text-mutedForeground">These assumptions affect only the automatic recommendation. All calculated region-count options remain available for review, and this stage does not test financial viability.</p>
                <details className="mt-3 rounded-md border border-border bg-background p-3 text-sm text-mutedForeground">
                  <summary className="cursor-pointer font-semibold text-foreground">How the recommended regions are calculated</summary>
                  <p className="mt-2">The model starts with geographically separated demand points, assigns each destination to the nearest temporary center, recalculates each center using the selected demand measure, and repeats until the regions stabilize. The initial points are only starting positions; they are not the final recommended centers.</p>
                  <p className="mt-2">For a one-region analysis, every destination contributes to one weighted geographic center.</p>
                </details>
              </DetailPanel>
              <DetailPanel title="Download">
                <a href={`/supply-chain-design/${project.id}/warehouse-location-strategy/${displayedRun?.id}/download`} className="mt-3 inline-flex text-sm font-semibold text-primary hover:underline">Download Location Strategy Assignments</a>
              </DetailPanel>
              <DetailPanel title="Saved Location Strategy Reports">
                <AnalysisTable
                  headers={["Run date", "Weighting", "Scope", "Max regions", "Recommended", "Shipments", "Status", "Report action", "Delete action"]}
                  rows={project.recentWarehouseLocationStrategyRuns.map((run) => [
                    formatDateTime(run.createdAt),
                    run.inputReferences ? formatLocationStrategyWeighting(run.inputReferences.weightingMethod) : "-",
                    run.inputReferences ? formatLocationStrategyScope(run.inputReferences.countryScope) : "-",
                    run.inputReferences ? formatNumber(run.inputReferences.maxRegions) : "-",
                    run.resultSummary ? `${formatNumber(run.resultSummary.recommendedRegionCount)} ${run.resultSummary.recommendedRegionCount === 1 ? "region" : "regions"}` : "-",
                    run.resultSummary ? formatNumber(run.resultSummary.shipmentsRepresented) : "-",
                    run.status,
                    <Link key={`${run.id}-view`} href={`/supply-chain-design/${project.id}?tab=warehouse-location-strategy&locationStrategyRunId=${run.id}`} className="text-xs font-semibold text-primary hover:underline">
                      {run.id === activeRunId ? "Currently displayed" : "View report"}
                    </Link>,
                    <div key={`${run.id}-delete`}>
                      <details>
                        <summary className="cursor-pointer text-xs font-semibold text-danger">Delete report</summary>
                        <div className="mt-2 rounded-md border border-border bg-background p-3">
                          <p className="text-xs text-mutedForeground">Delete this saved Location Strategy report? This removes the saved result and download, but does not delete uploaded project data.</p>
                          <form action={deleteSupplyChainDesignWarehouseLocationStrategyRunFormAction} className="mt-2 flex items-center gap-2">
                            <input type="hidden" name="projectId" value={project.id} />
                            <input type="hidden" name="runId" value={run.id} />
                            {activeRunId ? <input type="hidden" name="currentRunId" value={activeRunId} /> : null}
                            <DeleteConfirmationCancelButton />
                            <button type="submit" name="confirmDelete" value="on" className="rounded-md bg-danger px-2 py-1 font-semibold text-dangerForeground">
                              Confirm delete
                            </button>
                          </form>
                        </div>
                      </details>
                    </div>
                  ])}
                />
              </DetailPanel>
            </>
          ) : (
            <EmptyState>No Warehouse Location Strategy run has been saved yet.</EmptyState>
          )}
        </div>
      </ModelRunLayout>
    </section>
  );
}

function NetworkScenarioComparisonReport({ projectId, run }: { projectId: string; run: NetworkScenarioComparisonRunListItem }) {
  const result = run.resultSummary;
  if (!result) {
    return <p className="text-sm text-mutedForeground">No comparison totals are available yet.</p>;
  }
  const scenarioACurrency = scenarioCurrency(result.scenarioA);
  const scenarioBCurrency = scenarioCurrency(result.scenarioB);
  const comparisonCurrency = String(result.scenarioB.normalizedCurrency ?? result.scenarioA.normalizedCurrency ?? scenarioBCurrency ?? scenarioACurrency);
  const complete = result.completenessStatus === "COMPLETE";
  const allAlternativeRows = alternativeRows(run);
  const assignmentRowsForDisplay = winningDeliveryAssignmentRows(run).map((row) => [
    row[0],
    row[1],
    row[2],
    row[3] || "-",
    formatCsvCurrencyCell(row[4], comparisonCurrency),
    formatCsvCurrencyCell(row[5], comparisonCurrency),
    formatAssignmentWarehouseCostCell(row[6], row[5], row[7], comparisonCurrency),
    formatCsvCurrencyCell(row[7], comparisonCurrency),
    formatCsvNumberCell(row[8]),
    formatCsvNumberCell(row[9])
  ]);
  const auditRowsForDisplay = allAlternativeRows.map((row) => [
    row[0],
    row[1],
    row[2],
    row[3],
    row[4] || "-",
    formatCsvCurrencyCell(row[5], comparisonCurrency),
    formatCsvNumberCell(row[8]),
    formatCsvNumberCell(row[9]),
    formatCsvCurrencyCell(row[10], comparisonCurrency),
    formatAssignmentWarehouseCostCell(row[11], row[10], row[12], comparisonCurrency),
    formatCsvCurrencyCell(row[12], comparisonCurrency),
    row[7] === "true" ? "Winner" : "Alternative",
    row[14] || "-",
    row[13] || "-"
  ]);
  const scenarioOptions = [
    { value: run.scenarioAName, label: "Scenario A" },
    { value: run.scenarioBName, label: "Scenario B" }
  ];
  const auditScenarioOptions = [{ value: "ALL", label: "All scenarios" }, ...scenarioOptions];
  const competingAlternatives = hasCompetingAlternatives(run);
  return (
    <div className="space-y-4">
      <DetailPanel title="Network Cost Comparison">
        <AnalysisTable
          headers={["Cost", run.scenarioAName, run.scenarioBName]}
          rows={buildNetworkScenarioComparisonCostRows(run).map((row) => [
            row[0] === "Total Network Cost" ? <span key="label" className="font-semibold text-foreground">{row[0]}</span> : row[0],
            row[1] ? <span key="a" className={row[0] === "Total Network Cost" ? "font-semibold text-foreground" : undefined}>{formatCsvCurrencyCell(row[1], scenarioACurrency)}</span> : "-",
            row[2] ? <span key="b" className={row[0] === "Total Network Cost" ? "font-semibold text-foreground" : undefined}>{formatCsvCurrencyCell(row[2], scenarioBCurrency)}</span> : "-"
          ])}
        />
        <p className="mt-2 text-sm font-medium text-foreground">{formatSavingsCallout(run, comparisonCurrency)}</p>
      </DetailPanel>
      {complete ? null : (
        <DetailPanel title="Incomplete Evidence">
          <p className="text-sm font-semibold text-foreground">Comparison is incomplete.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mutedForeground">
            {result.warnings.length ? result.warnings.map((warning) => <li key={warning}>{warning}</li>) : <li>Additional modeled rate or warehouse-cost evidence is required.</li>}
          </ul>
        </DetailPanel>
      )}
      <DetailPanel title="Warehouse Allocation">
        <p className="mb-3 text-sm text-mutedForeground">How much of the modeled network each selected warehouse serves. Annual all-in warehouse cost is counted once per selected facility.</p>
        <AnalysisTable
          headers={["Scenario", "Warehouse", "Type", "Delivery Locations Served", "Shipments", "Pallets", "Transportation", "Variable Warehouse Cost", "Fixed Warehouse Cost", "Total Contribution"]}
          rows={facilitySummaryRows(run).map((row) => [
            row[0],
            row[1],
            row[2],
            row[4],
            formatCsvNumberCell(row[5]),
            formatCsvNumberCell(row[6]),
            formatCsvCurrencyCell(row[7], comparisonCurrency),
            formatCsvCurrencyCell(row[8], comparisonCurrency),
            formatCsvCurrencyCell(row[9], comparisonCurrency),
            formatCsvCurrencyCell(row[10], comparisonCurrency)
          ])}
        />
      </DetailPanel>
      <DetailPanel title="Best Network Assignments">
        <p className="mb-3 text-sm text-mutedForeground">Winning delivery assignments using the selected warehouses in one scenario at a time.</p>
        <NetworkScenarioComparisonPagedTable
          headers={["Delivery Location", "Assigned Warehouse", "Carrier", "Selected Rate", "Transportation Cost", "Variable Warehouse Cost", "Total Served Cost", "Shipments", "Pallets"]}
          rows={assignmentRowsForDisplay}
          scenarioOptions={scenarioOptions}
          defaultScenario={run.scenarioAName}
        />
      </DetailPanel>
      <DetailPanel title="Download">
        <a href={`/supply-chain-design/${projectId}/network-scenario-comparisons/${run.id}/exports/results`} className="inline-flex rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-primary hover:underline">
          Download Results CSV
        </a>
      </DetailPanel>
      <details className="rounded-md border border-border bg-background p-3">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">Advanced / Cost Audit</summary>
        <p className="mt-2 text-sm text-mutedForeground">Why a warehouse won over other complete alternatives. Carrier and selected-rate evidence appears here when it was persisted with the assignment evidence.</p>
        <div className="mt-3">
          {competingAlternatives ? (
            <>
              <NetworkScenarioComparisonPagedTable
                headers={["Delivery Location", "Warehouse Considered", "Type", "Carrier", "Selected Rate", "Shipments", "Pallets", "Transportation Total", "Variable Warehouse Cost", "Combined Served Cost", "Winner / Alternative", "Rate Evidence", "Missing Reason"]}
                rows={auditRowsForDisplay}
                scenarioOptions={auditScenarioOptions}
                defaultScenario="ALL"
                enableSearch
              />
            </>
          ) : (
            <p className="text-sm text-mutedForeground">No competing warehouse alternatives existed in this scenario.</p>
          )}
          <a href={`/supply-chain-design/${projectId}/network-scenario-comparisons/${run.id}/exports/alternative-audit`} className="mt-3 inline-flex text-sm font-semibold text-primary hover:underline">Download Cost Audit CSV</a>
        </div>
      </details>
      <details className="rounded-md border border-border bg-background p-3">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">Assumptions and Source Evidence</summary>
        <div className="mt-3">
          <AnalysisTable
            headers={["Item", "Value"]}
            rows={[
              ["Historical Shipments file", run.inputReferences?.historicalShipments.fileName ?? "-"],
              ["Current Facilities file", run.inputReferences?.currentFacilities.fileName ?? "-"],
              ["Candidate Warehouses file", run.inputReferences?.candidateFacilities.fileName ?? "-"],
              ["Scenario A selected warehouses", run.scenarioInputs?.scenarios.find((scenario) => scenario.scenarioKey === "A")?.selectedFacilities.map((facility) => facility.facilityName).join(", ") ?? "-"],
              ["Scenario B selected warehouses", run.scenarioInputs?.scenarios.find((scenario) => scenario.scenarioKey === "B")?.selectedFacilities.map((facility) => facility.facilityName).join(", ") ?? "-"],
              ["FX conversion", formatFxEvidence(run)],
              ["Transportation evidence", "Modeled using 7L rate evidence. Existing exact modeled rates may be reused."],
              ["Warehouse cost", "Annual all-in warehouse cost is counted once per selected facility."],
              ["Assignment method", "Assignments are based on lowest complete modeled served cost, not nearest warehouse."],
              ["Technical difference convention", "Scenario B - Scenario A"]
            ]}
          />
        </div>
      </details>
    </div>
  );
}

function WarehouseCostComparisonPanel({ project, selectedRunId }: { project: SupplyChainDesignProjectDetail; selectedRunId?: string }) {
  const displayedComparisonRun =
    project.recentNetworkScenarioComparisonRuns.find((run) => run.id === selectedRunId) ?? project.latestNetworkScenarioComparisonRun;
  const ratingEvidence = displayedComparisonRun?.ratingEvidence ?? null;
  const comparisonBatchId = ratingEvidence?.ratingBatchIds[0] ?? null;
  const comparisonBatch = comparisonBatchId ? project.recentLtlRateBatches.find((batch) => batch.id === comparisonBatchId) ?? null : null;
  const comparisonRunIsActive = displayedComparisonRun
    ? ["EVALUATING", "RATES_REQUIRED", "RATING", "READY_FOR_COST_EVALUATION"].includes(displayedComparisonRun.status)
    : false;
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <ModelRunLayout>
        <div>
          <h2 className="text-base font-semibold text-foreground">Network Scenario Comparison</h2>
          <p className="mt-1 text-sm text-mutedForeground">Compare two explicit warehouse network scenarios using one shared Historical Shipments source.</p>
          <p className="mt-2 text-xs text-mutedForeground">This first phase starts the comparison lifecycle and shows compact status only. Detailed result tables come later.</p>
          <div className="mt-4">
            {project.networkScenarioComparison.canRun && project.networkScenarioComparison.inputSelection ? (
              <SupplyChainDesignNetworkScenarioComparisonForm
                projectId={project.id}
                inputSelection={project.networkScenarioComparison.inputSelection}
                displayedRun={displayedComparisonRun}
              />
            ) : (
              <EmptyState>Add the missing Network Scenario Comparison input before running: {project.networkScenarioComparison.missingInputs.join(" and ")}.</EmptyState>
            )}
          </div>
        </div>
        <div className="space-y-4">
          {displayedComparisonRun ? (
            <>
              <DetailPanel title="Status">
                <p className="text-sm font-semibold text-foreground">
                  {networkScenarioStatusLabel(displayedComparisonRun.status)}
                </p>
                <p className="mt-1 text-xs text-mutedForeground">Run from {formatDateTime(displayedComparisonRun.createdAt)}</p>
                {displayedComparisonRun.resultReadError ? <p className="mt-2 text-sm font-medium text-danger">Saved Network Scenario Comparison run could not be read: {displayedComparisonRun.resultReadError}</p> : null}
                {displayedComparisonRun.errorMessage ? <p className="mt-2 text-sm font-medium text-danger">{displayedComparisonRun.errorMessage}</p> : null}
                {ratingEvidence && displayedComparisonRun.status !== "COMPLETE" ? (
                  <p className="mt-2 text-xs text-mutedForeground">
                    {formatNumber(ratingEvidence.reusedLaneCount)} exact rates reused - {formatNumber(ratingEvidence.missingRateCount)} unique rates required
                  </p>
                ) : null}
                {ratingEvidence?.ratingBatchIds.length && displayedComparisonRun.status !== "COMPLETE" ? (
                  <p className="mt-1 text-xs text-mutedForeground">Shared rate batch: {ratingEvidence.ratingBatchIds.join(", ")}</p>
                ) : null}
                {ratingEvidence && displayedComparisonRun.status === "COMPLETE" ? (
                  <details className="mt-3 rounded-md border border-border bg-background p-3">
                    <summary className="cursor-pointer text-xs font-semibold text-mutedForeground">Technical rate evidence</summary>
                    <p className="mt-2 text-xs text-mutedForeground">
                      {formatNumber(ratingEvidence.reusedLaneCount)} exact rates reused - {formatNumber(ratingEvidence.missingRateCount)} unique rates required.
                    </p>
                    {ratingEvidence.ratingBatchIds.length ? <p className="mt-1 text-xs text-mutedForeground">Shared rate batch: {ratingEvidence.ratingBatchIds.join(", ")}</p> : null}
                  </details>
                ) : null}
                {comparisonRunIsActive && comparisonBatchId ? (
                  <SupplyChainDesignNetworkScenarioComparisonProgressPoller
                    projectId={project.id}
                    comparisonRunId={displayedComparisonRun.id}
                    batchId={comparisonBatchId}
                    initialStatus={comparisonBatch?.status ?? "QUEUED"}
                    initialRated={comparisonBatch ? comparisonBatch.ratedSuccessfully + comparisonBatch.manuallyRated : 0}
                    initialProcessed={comparisonBatch?.processedRequests ?? 0}
                    initialIssues={comparisonBatch?.issueRequests ?? 0}
                    total={comparisonBatch?.requestsSubmitted ?? ratingEvidence?.missingRateCount ?? 0}
                  />
                ) : null}
                <details className="mt-3 rounded-md border border-border bg-background p-3">
                  <summary className="cursor-pointer text-xs font-semibold text-danger">Delete Result</summary>
                  <p className="mt-2 text-xs text-mutedForeground">Delete this saved Network Scenario Comparison result? This removes only this comparison run record and keeps uploaded project data and shared 7L rate evidence.</p>
                  <form action={deleteSupplyChainDesignNetworkScenarioComparisonRunFormAction} className="mt-2 flex items-center gap-2">
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="runId" value={displayedComparisonRun.id} />
                    <DeleteConfirmationCancelButton />
                    <button type="submit" name="confirmDelete" value="on" className="rounded-md bg-danger px-2 py-1 text-xs font-semibold text-dangerForeground">
                      Confirm delete
                    </button>
                  </form>
                </details>
              </DetailPanel>
              <NetworkScenarioComparisonReport projectId={project.id} run={displayedComparisonRun} />
              {project.recentNetworkScenarioComparisonRuns.length > 1 ? (
                <NetworkScenarioComparisonRunHistory
                  projectId={project.id}
                  runs={project.recentNetworkScenarioComparisonRuns}
                  selectedRunId={displayedComparisonRun.id}
                />
              ) : null}
            </>
          ) : (
            <EmptyState>No Network Scenario Comparison run has been saved yet.</EmptyState>
          )}
        </div>
      </ModelRunLayout>
    </section>
  );
}

function networkScenarioStatusLabel(status: string) {
  if (status === "EVALUATING") return "Evaluating scenarios and checking reusable rates";
  if (status === "RATES_REQUIRED") return "Missing exact rates are required";
  if (status === "RATING") return "Rating missing lanes";
  if (status === "READY_FOR_COST_EVALUATION") return "Ready for cost evaluation";
  if (status === "COMPLETE") return "Complete";
  if (status === "INCOMPLETE") return "Incomplete";
  if (status === "FAILED") return "Failed";
  return status;
}

function NetworkScenarioComparisonRunHistory({
  projectId,
  runs,
  selectedRunId
}: {
  projectId: string;
  runs: NetworkScenarioComparisonRunListItem[];
  selectedRunId: string;
}) {
  return (
    <details className="rounded-md border border-border bg-background p-3">
      <summary className="cursor-pointer text-sm font-semibold text-foreground">Saved Network Scenario Comparison Results</summary>
      <p className="mt-2 text-sm text-mutedForeground">Open or delete a specific saved comparison result without changing uploaded data or shared rate evidence.</p>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-mutedForeground">
            <tr>
              {["Run date and time", "Status", "Scenarios", "Result action", "Delete action"].map((header) => <th key={header} className="px-3 py-2 font-semibold">{header}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {runs.map((run) => {
              const selected = run.id === selectedRunId;
              return (
                <tr key={run.id}>
                  <td className="px-3 py-2 text-mutedForeground">{formatDateTime(run.createdAt)}</td>
                  <td className="px-3 py-2 text-mutedForeground">{networkScenarioStatusLabel(run.status)}</td>
                  <td className="px-3 py-2 text-mutedForeground">{run.scenarioAName} vs {run.scenarioBName}</td>
                  <td className="px-3 py-2">
                    {selected ? (
                      <span className="text-xs font-semibold text-mutedForeground">Currently displayed</span>
                    ) : (
                      <Link href={`/supply-chain-design/${projectId}?tab=warehouse-cost-comparison&warehouseCostComparisonRunId=${run.id}`} className="text-xs font-semibold text-primary hover:underline">View result</Link>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-danger">Delete Result</summary>
                      <div className="mt-2 rounded-md border border-border bg-background p-3">
                        <p className="text-xs text-mutedForeground">Delete only this saved Network Scenario Comparison result. Shared 7L evidence and uploaded project data remain.</p>
                        <form action={deleteSupplyChainDesignNetworkScenarioComparisonRunFormAction} className="mt-2 flex items-center gap-2">
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="runId" value={run.id} />
                          <DeleteConfirmationCancelButton />
                          <button type="submit" name="confirmDelete" value="on" className="rounded-md bg-danger px-2 py-1 text-xs font-semibold text-dangerForeground">
                            Confirm delete
                          </button>
                        </form>
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function LatestLtlRatePreparationRun({ run }: { run: SupplyChainDesignLtlRatePreparationRunSummary }) {
  const result = run.resultSummary;
  const incompleteRows = result?.sourceRowOutcomes?.filter((row) => row.status === "Missing data").slice(0, 25) ?? [];
  const hasIncompleteRows = (result?.missingDataRequestCount ?? 0) > 0;
  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-mutedForeground">Prepared {formatDateTime(run.createdAt)}</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard label="LTL requests prepared" value={result ? formatNumber(result.readyRequestCount) : "-"} />
        <SummaryCard label="Incomplete LTL rows" value={result ? formatNumber(result.missingDataRequestCount) : "-"} />
        <SummaryCard label="Non-LTL rows excluded" value={result ? formatNumber(result.excludedNonLtlRowCount) : "-"} />
      </div>
      {result && !hasIncompleteRows ? <p className="text-sm text-mutedForeground">All required LTL shipment rows are ready for rating.</p> : null}
      {result && result.excludedNonLtlRowCount > 0 ? (
        <p className="text-sm text-mutedForeground">{formatNumber(result.excludedNonLtlRowCount)} non-LTL historical rows were excluded from LTL rating.</p>
      ) : null}
      {hasIncompleteRows ? (
        <details id="ltl-review" className="rounded-md border border-border bg-background p-3 text-sm">
          <summary className="cursor-pointer font-semibold text-foreground">Some LTL shipment rows are incomplete.</summary>
          <p className="mt-2 text-mutedForeground">Correct the source data before rating these rows.</p>
          <AnalysisTable headers={["Source reference", "Destination", "Missing fields"]} rows={incompleteRows.map((row) => [row.shipmentOrderReference || row.sourceRowId, row.destination || "-", row.reason])} />
        </details>
      ) : null}
    </div>
  );
}

function LatestLtlRateBatch({ projectId, batch }: { projectId: string; batch: SupplyChainDesignLtlRateBatchSummary }) {
  const validRateLanes = batch.lanes.filter((lane) => lane.status === "Rated" || lane.status === "Manual");
  const hasAcceptedRates = validRateLanes.length > 0;
  const hasCurrentCostEvidence = validRateLanes.every((lane) => Number.isFinite(lane.currentTransportationCost));
  const hasComparison = hasAcceptedRates && hasCurrentCostEvidence && batch.candidateComparisons.length > 0;
  const isActive = batch.status === "QUEUED" || batch.status === "RUNNING";
  const completedRateCount = batch.ratedSuccessfully + batch.manuallyRated;
  const warningMessages = [
    batch.sourceRowCounts.nonLtlRowsExcluded > 0 ? `${formatNumber(batch.sourceRowCounts.nonLtlRowsExcluded)} non-LTL historical row${batch.sourceRowCounts.nonLtlRowsExcluded === 1 ? " was" : "s were"} excluded.` : null,
    batch.sourceRowCounts.incompleteLtlRowsExcluded > 0 ? `${formatNumber(batch.sourceRowCounts.incompleteLtlRowsExcluded)} incomplete LTL row${batch.sourceRowCounts.incompleteLtlRowsExcluded === 1 ? " was" : "s were"} excluded.` : null,
    batch.sourceRowCounts.unratedRateRequests > 0 ? `${formatNumber(batch.sourceRowCounts.unratedRateRequests)} rate request${batch.sourceRowCounts.unratedRateRequests === 1 ? "" : "s"} could not be completed.` : null
  ].filter((message): message is string => Boolean(message));
  const currentTotalNetworkCost = batch.coverage.coveredHistoricalTransportationCost + batch.coverage.currentRepresentedWarehouseCost;
  const coverageMessages = [
    batch.coverage.shipmentCoveragePercent < 100 ? `Shipment coverage is ${formatPercent(batch.coverage.shipmentCoveragePercent)}.` : null,
    batch.coverage.historicalCostCoveragePercent < 100 ? `Historical-cost coverage is ${formatPercent(batch.coverage.historicalCostCoveragePercent)}.` : null
  ].filter((message): message is string => Boolean(message));
  const hasCandidateWarnings = batch.candidateComparisons.some((candidate) => Boolean(candidate.warning));
  const candidateComparisonHeaders = [
    "Candidate warehouse",
    "Current facilities represented",
    "Shipments represented",
    "Current transportation cost",
    "Candidate transportation cost",
    "Transportation difference",
    "Current warehouse cost",
    "Candidate warehouse cost",
    "Current total network cost",
    "Candidate total network cost",
    "Total difference",
    "Percentage change",
    ...(hasCandidateWarnings ? ["Warning only if applicable"] : [])
  ];
  const candidateComparisonRows = batch.candidateComparisons.map((candidate) => [
    `${candidate.candidateFacilityId} - ${candidate.candidateFacilityName}`,
    candidate.comparedCurrentFacilityIds.join(", "),
    formatNumber(candidate.coveredShipments),
    formatMoney(candidate.currentCoveredLtlCost),
    formatMoney(candidate.candidateLtlCost),
    formatMoney(candidate.transportationDifference),
    formatMoney(candidate.currentWarehouseCost),
    formatMoney(candidate.candidateWarehouseCost),
    formatMoney(candidate.currentCoveredNetworkCost),
    formatMoney(candidate.proposedCoveredNetworkCost),
    formatMoney(candidate.totalEstimatedDifference),
    candidate.percentageChange === null ? "Not available" : formatPercent(candidate.percentageChange),
    ...(hasCandidateWarnings ? [candidate.warning ?? ""] : [])
  ]);

  return (
    <div className="mt-4 space-y-4">
      <DetailPanel title={isActive ? "Rating candidate warehouses" : "Network Design Result"}>
        {!isActive ? <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-mutedForeground">Report from {formatDateTime(batch.startedAt)}</p> : null}
        <SupplyChainDesignNetworkDesignProgressPoller
          projectId={projectId}
          batchId={batch.id}
          initialStatus={batch.status}
          initialRated={completedRateCount}
          initialProcessed={batch.processedRequests}
          initialIssues={batch.issueRequests}
          total={batch.requestsSubmitted}
        />
        {batch.status === "ERROR" ? <p className="mt-3 text-sm text-mutedForeground">The 7L rate run did not complete.</p> : null}
        {!hasAcceptedRates && batch.status !== "ERROR" && !isActive ? <p className="mt-3 text-sm text-mutedForeground">Rates have not completed yet.</p> : null}
        {hasAcceptedRates && !hasCurrentCostEvidence ? <p className="mt-3 text-sm text-mutedForeground">Regenerate Network Design to include current shipment costs.</p> : null}
        {hasComparison && !isActive ? (
          <div className="space-y-2">
            <p className="text-sm text-mutedForeground">
              {formatNumber(batch.candidateComparisons.length)} candidate warehouses were evaluated using {formatNumber(batch.sourceRowCounts.ltlRowsReviewed)} LTL shipment profiles representing {formatNumber(batch.sourceRowCounts.shipmentsRepresented)} shipments.
            </p>
            {warningMessages.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-mutedForeground">
                {warningMessages.map((message) => <li key={message}>{message}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </DetailPanel>
      {hasComparison ? (
        <>
          <DetailPanel title="Current Network Baseline for This Comparison">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <SummaryCard label="LTL shipment profiles" value={formatNumber(batch.sourceRowCounts.ltlRowsReviewed)} />
              <SummaryCard label="Shipments represented" value={formatNumber(batch.sourceRowCounts.shipmentsRepresented)} />
              <SummaryCard label="Current transportation cost" value={formatMoney(batch.coverage.coveredHistoricalTransportationCost)} />
              <SummaryCard label="Current warehouse cost" value={formatMoney(batch.coverage.currentRepresentedWarehouseCost)} />
              <SummaryCard label="Current total network cost" value={formatMoney(currentTotalNetworkCost)} />
            </div>
            {coverageMessages.length > 0 ? <p className="mt-3 text-sm text-mutedForeground">{coverageMessages.join(" ")}</p> : null}
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <a href={`/supply-chain-design/${projectId}/ltl-rate-batches/${batch.id}/shipment-comparison`} className="font-semibold text-primary hover:underline">Download Shipment Comparison</a>
              <a href={`/supply-chain-design/${projectId}/ltl-rate-batches/${batch.id}/candidate-summary`} className="font-semibold text-primary hover:underline">Download Candidate Comparison</a>
            </div>
          </DetailPanel>
          <DetailPanel title="Single-Candidate Network Comparison">
            <p className="mb-3 text-sm text-mutedForeground">Each candidate is modeled as replacing all current facilities represented by the selected shipment data.</p>
            <AnalysisTable headers={candidateComparisonHeaders} rows={candidateComparisonRows} />
          </DetailPanel>
        </>
      ) : null}
    </div>
  );
}

function NetworkDesignRunHistory({ projectId, batches, selectedBatchId }: { projectId: string; batches: SupplyChainDesignLtlRateBatchSummary[]; selectedBatchId: string | null }) {
  return (
    <DetailPanel title="Saved Network Design Reports">
      <p className="mb-3 text-sm text-mutedForeground">Open a previous analysis without rerunning 7L.</p>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-mutedForeground">
            <tr>
              {["Run date and time", "Candidate warehouses evaluated", "LTL shipment profiles", "Shipments represented", "Status", "Report action", "Delete action"].map((header) => <th key={header} className="px-3 py-2 font-semibold">{header}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {batches.map((batch) => {
              const selected = batch.id === selectedBatchId;
              return (
                <tr key={batch.id}>
                  <td className="px-3 py-2 text-mutedForeground">{formatDateTime(batch.startedAt)}</td>
                  <td className="px-3 py-2 text-mutedForeground">{formatNetworkDesignCandidateLabel(batch)}</td>
                  <td className="px-3 py-2 text-mutedForeground">{formatNumber(batch.sourceRowCounts.ltlRowsReviewed)}</td>
                  <td className="px-3 py-2 text-mutedForeground">{formatNumber(batch.sourceRowCounts.shipmentsRepresented)}</td>
                  <td className="px-3 py-2 text-mutedForeground">{formatNetworkDesignStatus(batch.status)}</td>
                  <td className="px-3 py-2">
                    {selected ? (
                      <span className="text-xs font-semibold text-mutedForeground">Currently displayed</span>
                    ) : (
                      <Link href={`/supply-chain-design/${projectId}?tab=network-design&networkDesignBatchId=${batch.id}`} className="text-xs font-semibold text-primary hover:underline">View report</Link>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-danger">Delete report</summary>
                      <div className="mt-2 rounded-md border border-border bg-background p-3">
                        <p className="text-xs text-mutedForeground">Delete this saved Network Design report? This removes the saved comparison and rates for this report, but does not delete uploaded project data.</p>
                        <form action={deleteSupplyChainDesignRunFormAction} className="mt-2 flex items-center gap-2">
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="runId" value={batch.id} />
                          <input type="hidden" name="runType" value="NETWORK_DESIGN" />
                          <DeleteConfirmationCancelButton />
                          <button type="submit" name="confirmDelete" value="on" className="rounded-md bg-danger px-2 py-1 font-semibold text-dangerForeground">
                            Confirm delete
                          </button>
                        </form>
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DetailPanel>
  );
}

function RunHistoryPanel({ project }: { project: SupplyChainDesignProjectDetail }) {
  return <section className="rounded-lg border border-border bg-card p-5 shadow-sm"><h2 className="text-base font-semibold text-foreground">Run History</h2>{project.recentModelRuns.map((run) => <p key={run.id} className="mt-2 text-sm text-mutedForeground">{formatDateTime(run.createdAt)} - Current Network Baseline - {run.status}</p>)}</section>;
}

function ModelRunLayout({ children }: { children: ReactNode }) {
  return <div className="grid gap-6 lg:grid-cols-[minmax(0,0.22fr)_minmax(0,0.78fr)] xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">{children}</div>;
}

function DetailPanel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-md border border-border bg-background p-4"><h4 className="text-sm font-semibold text-foreground">{title}</h4><div className="mt-3">{children}</div></section>;
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border bg-background p-3"><p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p><p className="mt-1 text-lg font-semibold text-foreground">{value}</p></div>;
}

function AnalysisTable({ headers, rows }: { headers: ReactNode[]; rows: ReactNode[][] }) {
  return <div className="overflow-x-auto"><table className="min-w-full divide-y divide-border text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-mutedForeground"><tr>{headers.map((header, index) => <th key={index} className="px-3 py-2 font-semibold">{header}</th>)}</tr></thead><tbody className="divide-y divide-border bg-background">{rows.length === 0 ? <tr><td className="px-3 py-2 text-mutedForeground" colSpan={headers.length}>No rows to show.</td></tr> : rows.map((row, index) => <tr key={`${index}-${headers.length}`}>{row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 text-mutedForeground">{cell || "-"}</td>)}</tr>)}</tbody></table></div>;
}

function HeaderHelp({ label, text }: { label: string; text: string }) {
  return (
    <span className="group relative inline-flex normal-case tracking-normal">
      <button type="button" aria-label={label} title={text} className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background text-[10px] font-bold leading-none text-mutedForeground focus:outline-none focus:ring-2 focus:ring-ring">
        i
      </button>
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-64 -translate-x-1/2 rounded-md border border-border bg-popover p-2 text-left text-xs font-normal normal-case leading-snug text-popoverForeground shadow-md group-focus-within:block group-hover:block">
        {text}
      </span>
    </span>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="mt-3 rounded-md border border-dashed border-border bg-background p-4 text-sm text-mutedForeground">{children}</div>;
}

function getNetworkDesignProgress(preparation: SupplyChainDesignLtlRatePreparationRunSummary | null, batch: SupplyChainDesignLtlRateBatchSummary | null) {
  if (!preparation) return { label: "Preparing shipment data", description: "Run Network Design to prepare valid LTL rows.", needsReview: false };
  if (!batch) return { label: "Requesting 7L rates", description: "Prepared rows are ready for rating.", needsReview: false };
  if (batch.status === "QUEUED" || batch.status === "RUNNING") return { label: `Rated ${formatNumber(batch.ratedSuccessfully + batch.manuallyRated)} of ${formatNumber(batch.requestsSubmitted)}`, description: "7L rating is in progress. Completed rows are saved as they finish.", needsReview: false };
  if (batch.status === "ERROR") return { label: "Rate run failed.", description: "Retry Network Design after correcting the issue.", needsReview: false };
  if (batch.unratedRepresentedShipments > 0 || batch.noRateReturned > 0 || batch.sevenLErrors > 0) return { label: "Some rate requests need attention.", description: "Unrated rows are excluded from both current and candidate covered totals.", needsReview: false };
  return { label: "Complete", description: "Network Design comparison is available.", needsReview: false };
}

function scenarioCurrency(scenario: Record<string, unknown>) {
  return String(scenario.normalizedCurrency ?? scenario.currency ?? "USD");
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatSavingsCallout(run: NetworkScenarioComparisonRunListItem, currency: string) {
  const callout = networkScenarioComparisonSavingsCallout(run);
  const difference = numberOrNull(run.resultSummary?.comparison.totalDifference);
  if (difference === null) return callout;
  return callout.replace(String(Math.abs(difference)), formatOptionalCurrency(Math.abs(difference), currency));
}

function formatCsvNumberCell(value: string) {
  const number = Number(value);
  return value && Number.isFinite(number) ? formatNumber(number) : "-";
}

function formatCsvCurrencyCell(value: string, currency: string) {
  const number = Number(value);
  return value && Number.isFinite(number) ? formatOptionalCurrency(number, currency) : "Unavailable";
}

function formatAssignmentWarehouseCostCell(value: string, transportation: string, combined: string, currency: string) {
  const warehouseCost = Number(value);
  if (value && Number.isFinite(warehouseCost)) return formatOptionalCurrency(warehouseCost, currency);
  const transportationCost = Number(transportation);
  const combinedCost = Number(combined);
  if (Number.isFinite(transportationCost) && Number.isFinite(combinedCost) && Math.abs(combinedCost - transportationCost) < 0.005) {
    return formatOptionalCurrency(0, currency);
  }
  return "Unavailable";
}

function formatFxEvidence(run: NetworkScenarioComparisonRunListItem) {
  const scenarioA = run.resultSummary?.scenarioA;
  const scenarioB = run.resultSummary?.scenarioB;
  if (scenarioA?.fxApplied || scenarioB?.fxApplied) {
    const rate = run.fxInput?.cadToUsdRate ?? numberOrNull(scenarioA?.cadToUsdRate) ?? numberOrNull(scenarioB?.cadToUsdRate);
    return rate ? `CAD converted to USD at ${rate}.` : "FX conversion applied.";
  }
  return "No FX conversion applied.";
}

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function formatWeight(value: number, unit: string | null) {
  return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(value);
}

function formatOptionalCurrency(value: number | null, currency: string) {
  return value === null ? "Unavailable" : new Intl.NumberFormat("en", { style: "currency", currency }).format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatLocationStrategyWeighting(value: string) {
  if (value === "PALLETS") return "Pallets";
  if (value === "WEIGHT") return "Weight";
  if (value === "UNITS") return "Units";
  if (value === "CURRENT_TRANSPORTATION_COST") return "Historical transportation spend";
  return "Shipments represented";
}

function formatLocationStrategyScope(value: string) {
  if (value === "US") return "U.S.-only warehouse markets";
  if (value === "CA") return "Canada-only warehouse markets";
  if (value === "SEPARATE_BY_COUNTRY") return "Separate U.S. and Canada networks";
  return "United States and Canada together";
}

function formatLocationStrategySelectedMetric(value: number, currency?: string | null) {
  return currency ? `${formatNumber(value)} ${currency}` : formatNumber(value);
}

function formatLocationStrategyRecommendation(result: NonNullable<SupplyChainDesignProjectDetail["latestWarehouseLocationStrategyRun"]>["resultSummary"]) {
  if (!result) return "";
  const names = result.recommendedSolution.regions.map((region) => region.recommendedMarketLabel).join(", ");
  return `Use ${formatNumber(result.recommendedRegionCount)} warehouse search ${result.recommendedRegionCount === 1 ? "region" : "regions"}: ${names}.`;
}

function formatLocationStrategyRegionCount(regionCount: number) {
  if (regionCount === 1) return "One warehouse region";
  if (regionCount === 2) return "Two warehouse regions";
  return "Three warehouse regions";
}

type WarehouseLocationStrategyResult = NonNullable<NonNullable<SupplyChainDesignProjectDetail["latestWarehouseLocationStrategyRun"]>["resultSummary"]>;

function locationStrategyAvailableSolutionReason(solution: WarehouseLocationStrategyResult["solutions"][number]) {
  const weakRegion = solution.regions.find((region) => region.selectedDemandSharePercent < 10);
  if (weakRegion) {
    return `the smallest region represents ${formatNumber(weakRegion.selectedDemandSharePercent)}% of selected demand, below the 10% minimum.`;
  }
  if ((solution.incrementalImprovementPercent ?? 0) < 15) {
    return `the additional region improves weighted average distance by only ${formatNumber(solution.incrementalImprovementPercent ?? 0)}%, below the 15% minimum.`;
  }
  return "it did not meet the automatic recommendation rule.";
}

function formatNetworkDesignCandidateLabel(batch: SupplyChainDesignLtlRateBatchSummary) {
  const candidates = batch.candidateComparisons.length > 0
    ? batch.candidateComparisons.map((candidate) => candidate.candidateFacilityName || candidate.candidateFacilityId)
    : uniqueStrings(batch.lanes.map((lane) => lane.candidateFacilityName || lane.candidateFacilityId));
  if (candidates.length > 4) return `${formatNumber(candidates.length)} candidates`;
  return candidates.join(", ") || "No candidates";
}

function formatNetworkDesignStatus(status: string) {
  if (status === "SUCCESS") return "Complete";
  if (status === "ERROR") return "Failed";
  if (status === "RUNNING") return "Running";
  if (status === "QUEUED") return "Queued";
  return status;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
