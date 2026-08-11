import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { FileUploadForm } from "@/modules/supply-chain-design/components/file-upload-form";
import { SupplyChainDesignModel01ProofRunForm } from "@/modules/supply-chain-design/components/model-01-proof-run-form";
import { SupplyChainDesignNetworkDesignRunForm } from "@/modules/supply-chain-design/components/network-design-run-form";
import { SupplyChainDesignThreePlScreeningForm } from "@/modules/supply-chain-design/components/three-pl-screening-form";
import { DeleteConfirmationCancelButton } from "@/modules/supply-chain-design/components/delete-confirmation-cancel-button";
import { requireSupplyChainDesignStudioAccess } from "@/modules/supply-chain-design/access";
import { getSupplyChainDesignProject } from "@/modules/supply-chain-design/queries";
import type {
  SupplyChainDesignLtlRateBatchSummary,
  SupplyChainDesignLtlRatePreparationRunSummary,
  SupplyChainDesignProjectDetail
} from "@/modules/supply-chain-design/types";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<{ tab?: string }>;
};

const PROJECT_TABS = [
  { id: "project-data", label: "Project Data" },
  { id: "current-network-baseline", label: "Current Network Baseline" },
  { id: "network-design", label: "Network Design" },
  { id: "warehouse-location-strategy", label: "Warehouse Location Strategy" },
  { id: "warehouse-cost-comparison", label: "Warehouse Cost Comparison" },
  { id: "run-history", label: "Run History" }
] as const;

export default async function SupplyChainDesignProjectPage({ params, searchParams }: PageProps) {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  const { projectId } = await params;
  const { tab } = (await searchParams) ?? {};
  const project = await getSupplyChainDesignProject(context, projectId);
  if (!project) notFound();
  const activeTab = PROJECT_TABS.some((candidate) => candidate.id === tab) ? tab! : "project-data";
  const networkDesignProgress = getNetworkDesignProgress(project.latestLtlRatePreparationRun, project.latestLtlRateBatch);

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
                Compare current shipment and warehouse costs with the estimated costs of operating from selected candidate warehouses.
              </p>
              <p className="mt-3 text-sm text-mutedForeground">
                Inputs: Historical Shipments; Candidate Warehouses and Proposed Costs; Current Facilities and Warehouse Costs; current facilities being replaced/compared.
              </p>
              <div className="mt-4">
                {project.candidateLtlRatePreparation.canRun && project.candidateLtlRatePreparation.inputSelection ? (
                  <SupplyChainDesignNetworkDesignRunForm
                    projectId={project.id}
                    inputSelection={project.candidateLtlRatePreparation.inputSelection}
                    preparationRunId={project.latestLtlRatePreparationRun?.id ?? null}
                  />
                ) : (
                  <EmptyState>Add the missing Network Design input before running: {project.candidateLtlRatePreparation.missingInputs.join(" and ")}.</EmptyState>
                )}
              </div>
              <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-sm text-mutedForeground">
                <p className="font-semibold text-foreground">{networkDesignProgress.label}</p>
                <p className="mt-1">{networkDesignProgress.description}</p>
                {networkDesignProgress.needsReview ? <a href="#ltl-review" className="mt-2 inline-flex font-semibold text-primary hover:underline">Review excluded or incomplete rows</a> : null}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-mutedForeground">Network Design Results</h3>
              {project.latestLtlRatePreparationRun ? <LatestLtlRatePreparationRun run={project.latestLtlRatePreparationRun} /> : <EmptyState>No LTL rate requests have been prepared yet.</EmptyState>}
              {project.latestLtlRateBatch ? <LatestLtlRateBatch projectId={project.id} batch={project.latestLtlRateBatch} /> : <EmptyState>No 7L rate batch has been run yet.</EmptyState>}
            </div>
          </ModelRunLayout>
        </section>
      ) : null}
      {activeTab === "warehouse-location-strategy" ? <WarehouseLocationStrategyPanel project={project} /> : null}
      {activeTab === "warehouse-cost-comparison" ? <section className="rounded-lg border border-border bg-card p-5 shadow-sm"><h2 className="text-base font-semibold text-foreground">Warehouse Cost Comparison</h2><p className="mt-1 text-sm text-mutedForeground">Beta - totals not yet validated</p></section> : null}
      {activeTab === "run-history" ? <RunHistoryPanel project={project} /> : null}
    </div>
  );
}

function ProjectTabs({ projectId, activeTab }: { projectId: string; activeTab: string }) {
  return <nav className="flex flex-wrap gap-2 border-b border-border pb-3">{PROJECT_TABS.map((tab) => <Link key={tab.id} href={`/supply-chain-design/${projectId}?tab=${tab.id}`} className={`rounded-md px-3 py-2 text-sm font-semibold ${activeTab === tab.id ? "bg-primary text-primaryForeground" : "bg-muted text-mutedForeground hover:text-foreground"}`}>{tab.label}</Link>)}</nav>;
}

function ProjectDataPanel({ project }: { project: SupplyChainDesignProjectDetail }) {
  return <section className="rounded-lg border border-border bg-card p-5 shadow-sm"><h2 className="text-base font-semibold text-foreground">Project Data</h2><FileUploadForm projectId={project.id} /><div className="mt-5 overflow-x-auto"><table className="min-w-full divide-y divide-border text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-mutedForeground"><tr><th className="px-3 py-2">File</th><th className="px-3 py-2">Rows</th><th className="px-3 py-2">Mapping</th><th className="px-3 py-2">Actions</th></tr></thead><tbody className="divide-y divide-border">{project.files.map((file) => <tr key={file.id}><td className="px-3 py-2"><Link href={`/supply-chain-design/${project.id}/files/${file.id}`} className="font-semibold text-primary hover:underline">{file.originalFileName}</Link></td><td className="px-3 py-2 text-mutedForeground">{formatNumber(file.rowCount)}</td><td className="px-3 py-2 text-mutedForeground">{file.mappingTableType ?? "Unmapped"} - {file.mappingDisplayStatus}</td><td className="px-3 py-2"><details><summary className="cursor-pointer text-xs font-semibold text-danger">Delete file</summary><DeleteConfirmationCancelButton /></details></td></tr>)}</tbody></table></div></section>;
}

function CurrentNetworkBaselinePanel({ project }: { project: SupplyChainDesignProjectDetail }) {
  return <section className="rounded-lg border border-border bg-card p-5 shadow-sm"><ModelRunLayout><div><h2 className="text-base font-semibold text-foreground">Current Network Baseline</h2><p className="mt-1 text-sm text-mutedForeground">Review the customer&apos;s existing facilities, shipment activity, transportation costs, inventory, facility costs, service performance and capacity using the available project data.</p><div className="mt-4">{project.model01Proof.canRun && project.model01Proof.inputSelection ? <SupplyChainDesignModel01ProofRunForm projectId={project.id} inputSelection={project.model01Proof.inputSelection} /> : <EmptyState>Add the missing Current Network Baseline input before running: {project.model01Proof.missingInputs.join(" and ")}.</EmptyState>}</div></div><div><h3 className="text-sm font-semibold uppercase tracking-wide text-mutedForeground">Current Network Summary</h3>{project.latestModelRun?.resultSummary ? <div className="mt-3 grid gap-3 sm:grid-cols-2"><SummaryCard label="Facilities loaded" value={formatNumber(project.latestModelRun.resultSummary.facilityCount)} /><SummaryCard label="Shipments loaded" value={formatNumber(project.latestModelRun.resultSummary.shipmentCount)} /></div> : <EmptyState>No Current Network Baseline run has been saved yet.</EmptyState>}</div></ModelRunLayout></section>;
}

function WarehouseLocationStrategyPanel({ project }: { project: SupplyChainDesignProjectDetail }) {
  return <section className="rounded-lg border border-border bg-card p-5 shadow-sm"><ModelRunLayout><div><h2 className="text-base font-semibold text-foreground">3PL Location Screening</h2><p className="mt-1 text-sm text-mutedForeground">Warehouse Location Strategy identifies practical warehouse regions from delivery demand using the internal Newl logistics-market catalogue.</p><div className="mt-4">{project.threePlScreening.canRun && project.threePlScreening.inputSelection ? <SupplyChainDesignThreePlScreeningForm projectId={project.id} inputSelection={project.threePlScreening.inputSelection} /> : <EmptyState>Add the missing 3PL Location Screening input before running: {project.threePlScreening.missingInputs.join(" and ")}.</EmptyState>}</div></div><div><h3 className="text-sm font-semibold uppercase tracking-wide text-mutedForeground">3PL Location Screening — Recommended regions</h3>{project.latestScreeningRun?.resultSummary ? <><p className="mt-3 text-sm text-mutedForeground">Demand was excluded from this recommendation.</p><SimpleTable headers={["Region", "Weighted average distance"]} rows={[]} /></> : <EmptyState>No 3PL location-screening run has been saved yet.</EmptyState>}</div></ModelRunLayout></section>;
}

function LatestLtlRatePreparationRun({ run }: { run: SupplyChainDesignLtlRatePreparationRunSummary }) {
  const result = run.resultSummary;
  const rows = result?.sourceRowOutcomes?.filter((row) => row.status !== "Prepared").slice(0, 25) ?? [];
  return <div className="mt-3 space-y-3"><p className="text-xs text-mutedForeground">Prepared {formatDateTime(run.createdAt)}</p><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><SummaryCard label="Prepared LTL shipments" value={result ? formatNumber(result.readyRequestCount) : "-"} /><SummaryCard label="Incomplete rows" value={result ? formatNumber(result.missingDataRequestCount) : "-"} /><SummaryCard label="Excluded non-LTL rows" value={result ? formatNumber(result.excludedNonLtlRowCount) : "-"} /></div>{rows.length > 0 ? <details id="ltl-review" className="rounded-md border border-border bg-background p-3 text-sm"><summary className="cursor-pointer font-semibold text-foreground">Some LTL shipment rows are incomplete.</summary><p className="mt-2 text-mutedForeground">Continue and exclude incomplete rows, or Cancel and correct source data.</p><SimpleTable headers={["Source reference", "Destination", "Missing fields"]} rows={rows.map((row) => [row.shipmentOrderReference || row.sourceRowId, row.destination || "-", row.reason])} /></details> : null}</div>;
}

function LatestLtlRateBatch({ projectId, batch }: { projectId: string; batch: SupplyChainDesignLtlRateBatchSummary }) {
  const lanes = batch.lanes.slice(0, 25);
  return <div className="mt-4 space-y-4"><DetailPanel title="Network Comparison Summary"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><SummaryCard label="Covered historical LTL shipments" value={formatNumber(batch.coverage.coveredShipments)} /><SummaryCard label="Covered historical LTL cost" value={formatMoney(batch.coverage.coveredHistoricalTransportationCost)} /><SummaryCard label="Excluded/incomplete count" value={formatNumber(batch.coverage.excludedShipmentCount)} /><SummaryCard label="Excluded/incomplete cost" value={formatMoney(batch.coverage.excludedHistoricalTransportationCost)} /><SummaryCard label="Coverage percentage" value={formatPercent(batch.coverage.shipmentCoveragePercent)} /></div><div className="mt-3 flex flex-wrap gap-3 text-sm"><Link href={`/supply-chain-design/${projectId}/ltl-rate-batches/${batch.id}/shipment-comparison`} className="font-semibold text-primary hover:underline">Download Shipment Comparison</Link><Link href={`/supply-chain-design/${projectId}/ltl-rate-batches/${batch.id}/candidate-summary`} className="font-semibold text-primary hover:underline">Download Candidate Summary</Link></div></DetailPanel><DetailPanel title="Candidate Comparison"><SimpleTable headers={["Candidate warehouse", "Compared current facilities", "Covered shipments", "Current covered LTL cost", "Candidate LTL cost", "Transportation difference", "Current warehouse cost", "Candidate warehouse cost", "Proposed covered network cost", "Difference from current", "Percentage change", "Coverage percentage", "Warning"]} rows={batch.candidateComparisons.map((candidate) => [`${candidate.candidateFacilityId} - ${candidate.candidateFacilityName}`, candidate.scenarioType === "Replace" ? candidate.comparedCurrentFacilityIds.join(", ") : "Supplement current network", formatNumber(candidate.coveredShipments), formatMoney(candidate.currentCoveredLtlCost), formatMoney(candidate.candidateLtlCost), formatMoney(candidate.transportationDifference), formatMoney(candidate.currentWarehouseCost), formatMoney(candidate.candidateWarehouseCost), formatMoney(candidate.proposedCoveredNetworkCost), formatMoney(candidate.totalEstimatedDifference), candidate.percentageChange === null ? "Not available" : formatPercent(candidate.percentageChange), formatPercent(candidate.coveragePercentage), candidate.warning ?? ""])} /></DetailPanel><DetailPanel title="Temporary development detail - selected shipment rates"><SimpleTable headers={["Candidate warehouse", "Source reference", "Destination", "Shipments", "Current cost", "Selected 7L rate", "Candidate cost", "Status"]} rows={lanes.map((lane) => [`${lane.candidateFacilityId} - ${lane.candidateFacilityName}`, lane.sourceReference, lane.destination, formatNumber(lane.representedShipments), lane.currentTransportationCost === null ? "-" : formatMoney(lane.currentTransportationCost), lane.selectedQuote?.total === undefined ? "-" : formatMoney(lane.selectedQuote.total), lane.estimatedTotalTransportationCost === null ? "-" : formatMoney(lane.estimatedTotalTransportationCost), lane.status])} /></DetailPanel></div>;
}

function RunHistoryPanel({ project }: { project: SupplyChainDesignProjectDetail }) {
  return <section className="rounded-lg border border-border bg-card p-5 shadow-sm"><h2 className="text-base font-semibold text-foreground">Run History</h2>{project.recentModelRuns.map((run) => <p key={run.id} className="mt-2 text-sm text-mutedForeground">{formatDateTime(run.createdAt)} - Current Network Baseline - {run.status}</p>)}</section>;
}

function ModelRunLayout({ children }: { children: ReactNode }) {
  return <div className="grid gap-6 xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">{children}</div>;
}

function DetailPanel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-md border border-border bg-background p-4"><h4 className="text-sm font-semibold text-foreground">{title}</h4><div className="mt-3">{children}</div></section>;
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border bg-background p-3"><p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p><p className="mt-1 text-lg font-semibold text-foreground">{value}</p></div>;
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return <div className="overflow-x-auto"><table className="min-w-full divide-y divide-border text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-mutedForeground"><tr>{headers.map((header) => <th key={header} className="px-3 py-2 font-semibold">{header}</th>)}</tr></thead><tbody className="divide-y divide-border bg-background">{rows.length === 0 ? <tr><td className="px-3 py-2 text-mutedForeground" colSpan={headers.length}>No rows to show.</td></tr> : rows.map((row, index) => <tr key={`${row.join("|")}-${index}`}>{row.map((cell, cellIndex) => <td key={`${headers[cellIndex]}-${cellIndex}`} className="px-3 py-2 text-mutedForeground">{cell || "-"}</td>)}</tr>)}</tbody></table></div>;
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="mt-3 rounded-md border border-dashed border-border bg-background p-4 text-sm text-mutedForeground">{children}</div>;
}

function getNetworkDesignProgress(preparation: SupplyChainDesignLtlRatePreparationRunSummary | null, batch: SupplyChainDesignLtlRateBatchSummary | null) {
  if (!preparation) return { label: "Preparing shipment data", description: "Run Network Design to prepare valid LTL rows.", needsReview: false };
  if (!batch) return { label: "Requesting 7L rates", description: "Prepared rows are ready for rating.", needsReview: false };
  if (batch.status === "QUEUED" || batch.status === "RUNNING") return { label: `Rated ${formatNumber(batch.ratedSuccessfully + batch.manuallyRated)} of ${formatNumber(batch.requestsSubmitted)}`, description: "7L rating is in progress. Completed rows are saved as they finish.", needsReview: false };
  if (batch.unratedRepresentedShipments > 0 || batch.noRateReturned > 0 || batch.sevenLErrors > 0) return { label: "Some LTL shipment rows are incomplete.", description: "Incomplete, excluded or unrated rows are excluded from both current and candidate covered totals.", needsReview: true };
  return { label: "Complete", description: "Network Design comparison is available.", needsReview: false };
}

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}
