"use client";

import {
  getFilteredRowModel,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef
} from "@tanstack/react-table";
import { CandidateStatus, LeadPipelineStage } from "@prisma/client";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { DataGridColumnMenu } from "@/components/data-grid-column-menu";
import { IndustryBadge } from "@/components/industry-badge";
import { InfoHint } from "@/components/info-hint";
import { usePersistedTableState } from "@/components/use-persisted-table-state";
import { StageBadge } from "@/components/stage-badge";

type PipelineLead = {
  id: string;
  companyId: string;
  companyName: string;
  normalizedName: string;
  companyDomain?: string | null;
  companyWebsiteUrl?: string | null;
  companyLinkedinUrl?: string | null;
  primaryIndustry?: string | null;
  secondaryIndustry?: string | null;
  industryConfidence?: number | null;
  destinationPort?: string | null;
  originPort?: string | null;
  shipFromPort?: string | null;
  contactName?: string | null;
  stage: LeadPipelineStage;
  candidateStatus: CandidateStatus;
  score: number;
  companyScore: number;
  scoreBreakdown: {
    total: number;
    matchedSearchProfileName: string;
    sourceRole: string;
    importedScoreReasoning: string | null;
    components: Array<{
      key: string;
      label: string;
      points: number;
      maxPoints: number;
      detail: string;
    }>;
    settingsSnapshot: {
      recentWindowDays: number;
      comparisonWindowDays: number;
      momentumWeight: number;
      marketFitWeight: number;
      industryFitWeight: number;
      companySizeWeight: number;
      roleWeight: number;
      confidenceWeight: number;
      workflowWeight: number;
    };
  };
  shipmentCount30d: number;
  shipmentCount90d: number;
  assignedRepValue?: string | null;
  assignedRep: string;
  contactStatus: string;
  apolloStatus: string;
  sequenceStatus: string;
  sequenceReadiness: string;
  nextStep: string;
  notes?: string | null;
  approvedAt: Date;
  updatedAt: Date;
};

type RepOption = {
  value: string;
  label: string;
};

export function PipelineTableClient({
  leads,
  stageOptions,
  repOptions,
  bulkUpdateLeadStageAction,
  bulkQueueApolloEnrichmentAction,
  bulkAssignLeadOwnerAction,
  bulkUnassignLeadOwnerAction,
  updateLeadStageAction
}: {
  leads: PipelineLead[];
  stageOptions: LeadPipelineStage[];
  repOptions: RepOption[];
  bulkUpdateLeadStageAction: (formData: FormData) => Promise<void>;
  bulkQueueApolloEnrichmentAction: (formData: FormData) => Promise<void>;
  bulkAssignLeadOwnerAction: (formData: FormData) => Promise<void>;
  bulkUnassignLeadOwnerAction: (formData: FormData) => Promise<void>;
  updateLeadStageAction: (formData: FormData) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const {
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    columnVisibility,
    setColumnVisibility,
    columnSizing,
    setColumnSizing
  } = usePersistedTableState("newl-apps:lead-gen:pipeline-grid");

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedLeads = useMemo(
    () => leads.filter((lead) => selectedSet.has(lead.id)),
    [leads, selectedSet]
  );
  const hasUnassignedSelection = selectedLeads.some((lead) => !lead.assignedRepValue);

  function toggleSelection(leadId: string) {
    setSelectedIds((current) => (current.includes(leadId) ? current.filter((id) => id !== leadId) : [...current, leadId]));
  }

  function toggleAllVisible() {
    const visibleLeadIds = table.getRowModel().rows.map((row) => row.original.id);
    const allVisibleCurrentlySelected =
      visibleLeadIds.length > 0 && visibleLeadIds.every((leadId) => selectedSet.has(leadId));
    setSelectedIds(allVisibleCurrentlySelected ? [] : visibleLeadIds);
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function confirmBulkDisqualify() {
    if (selectedIds.length === 0) {
      return true;
    }

    return window.confirm(
      `Disqualify ${selectedIds.length} account${selectedIds.length === 1 ? "" : "s"}? Disqualified companies will stay out of future TradeMining review pulls unless you manually change their status later.`
    );
  }

  function confirmSingleDisqualify(companyName: string) {
    return window.confirm(
      `Disqualify ${companyName}? This company will stay out of future TradeMining review pulls unless you manually change its status later.`
    );
  }

  const columns = useMemo<ColumnDef<PipelineLead>[]>(
    () => [
      {
        id: "select",
        header: "",
        enableSorting: false,
        enableHiding: false,
        enableColumnFilter: false,
        size: 52,
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selectedSet.has(row.original.id)}
            onChange={() => toggleSelection(row.original.id)}
            aria-label={`Select ${row.original.companyName}`}
          />
        )
      },
      {
        accessorKey: "companyName",
        header: "Company",
        filterFn: "includesString",
        size: 280,
        cell: ({ row }) => {
          const lead = row.original;

          return (
            <div className="max-w-[240px]">
              <p className="font-semibold text-foreground">{lead.companyName}</p>
              <p className="mt-1 text-xs text-mutedForeground">{lead.normalizedName}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {lead.companyWebsiteUrl ? (
                  <a
                    href={lead.companyWebsiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-primary transition-colors hover:text-primaryHover"
                  >
                    Website
                  </a>
                ) : null}
                {lead.companyLinkedinUrl ? (
                  <a
                    href={lead.companyLinkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-primary transition-colors hover:text-primaryHover"
                  >
                    LinkedIn
                  </a>
                ) : null}
              </div>
              {lead.notes ? <PipelineActivityNotes notes={lead.notes} /> : null}
            </div>
          );
        }
      },
      {
        id: "industry",
        header: "Industry",
        accessorFn: (lead) => lead.primaryIndustry ?? lead.secondaryIndustry ?? "",
        filterFn: "includesString",
        size: 190,
        cell: ({ row }) => (
          <IndustryBadge
            primaryIndustry={row.original.primaryIndustry}
            secondaryIndustry={row.original.secondaryIndustry}
            confidence={row.original.industryConfidence}
          />
        )
      },
      {
        accessorKey: "destinationPort",
        header: "Destination port",
        filterFn: "includesString",
        size: 170,
        cell: ({ row }) => (
          <div className="max-w-[170px] text-mutedForeground">{row.original.destinationPort ?? "Unknown"}</div>
        )
      },
      {
        id: "originPorts",
        header: "Origin / ship-from",
        accessorFn: (lead) => [lead.originPort, lead.shipFromPort].filter(Boolean).join(" / "),
        filterFn: "includesString",
        size: 190,
        cell: ({ row }) => {
          const lead = row.original;
          const originSummary = [lead.originPort, lead.shipFromPort].filter(Boolean).join(" / ");
          return <div className="max-w-[190px] text-mutedForeground">{originSummary || "Unknown"}</div>;
        }
      },
      {
        accessorKey: "stage",
        header: "Pipeline stage",
        filterFn: "includesString",
        size: 160,
        cell: ({ row }) => <StageBadge stage={row.original.stage} />
      },
      {
        accessorKey: "score",
        header: () => (
          <span className="flex items-center gap-2">
            <span>Score</span>
            <InfoHint
              text="The large score is the live pipeline account score used to rank approved companies. It recalculates from current shipment evidence, fit rules, and workflow scoring. The smaller company score below it is the stored base company signal from TradeMining ingestion that helps feed the live account score."
              widthClassName="w-80"
            />
          </span>
        ),
        filterFn: minimumNumberFilter,
        size: 340,
        cell: ({ row }) => {
          const lead = row.original;

          return (
            <div className="w-[320px]">
              <span className="text-lg font-bold text-primary">{lead.score}</span>
              <p className="mt-1 text-xs text-mutedForeground">Base company signal {lead.companyScore}</p>
              <details className="mt-2 rounded-md border border-border bg-background p-2 text-xs text-mutedForeground">
                <summary className="cursor-pointer list-none font-semibold text-foreground">Show calculation</summary>
                <div className="mt-2 space-y-2">
                  <div className="rounded-md bg-muted/60 p-2">
                    <p className="font-medium text-foreground">{lead.scoreBreakdown.matchedSearchProfileName}</p>
                    <p className="mt-1">{lead.scoreBreakdown.sourceRole}</p>
                    {lead.scoreBreakdown.importedScoreReasoning ? (
                      <p className="mt-1">{lead.scoreBreakdown.importedScoreReasoning}</p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    {lead.scoreBreakdown.components.map((component) => (
                      <div key={component.key} className="rounded-md border border-border p-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-foreground">{component.label}</span>
                          <span className="font-semibold text-foreground">
                            {component.points >= 0 ? "+" : ""}
                            {component.points} / {component.maxPoints}
                          </span>
                        </div>
                        <p className="mt-1 leading-5">{component.detail}</p>
                      </div>
                    ))}
                  </div>
                  <p>
                    Windows: {lead.scoreBreakdown.settingsSnapshot.recentWindowDays}d recent vs{" "}
                    {lead.scoreBreakdown.settingsSnapshot.comparisonWindowDays}d prior. Weights update from current settings
                    automatically.
                  </p>
                </div>
              </details>
            </div>
          );
        }
      },
      {
        accessorKey: "candidateStatus",
        header: "Candidate status",
        filterFn: "includesString",
        size: 170,
        cell: ({ row }) => <CandidateStatusBadge status={row.original.candidateStatus} />
      },
      {
        accessorKey: "shipmentCount30d",
        header: "Shipments (30d)",
        filterFn: minimumNumberFilter,
        size: 150,
        cell: ({ row }) => (
          <div className="text-mutedForeground">
            <p className="font-semibold text-foreground">{row.original.shipmentCount30d}</p>
            <p className="mt-1 text-xs">Recent 30 days</p>
          </div>
        )
      },
      {
        accessorKey: "shipmentCount90d",
        header: "Shipments (90d)",
        filterFn: minimumNumberFilter,
        size: 150,
        cell: ({ row }) => (
          <div className="text-mutedForeground">
            <p className="font-semibold text-foreground">{row.original.shipmentCount90d}</p>
            <p className="mt-1 text-xs">Recent 90 days</p>
          </div>
        )
      },
      {
        accessorKey: "assignedRep",
        header: "Assigned rep",
        filterFn: "includesString",
        size: 170,
        cell: ({ row }) => {
          const lead = row.original;

          return (
            <div className="text-mutedForeground">
              <p className="font-medium text-foreground">{lead.assignedRep}</p>
              <p className="mt-1 text-xs">{lead.assignedRepValue ? "Assigned" : "Unassigned"}</p>
            </div>
          );
        }
      },
      {
        accessorKey: "contactStatus",
        header: "Contact status",
        filterFn: "includesString",
        size: 180,
        cell: ({ row }) => {
          const lead = row.original;

          return (
            <div className="max-w-[180px] text-mutedForeground">
              <p className="font-medium text-foreground">{lead.contactStatus}</p>
              <p className="mt-1 text-xs">{lead.contactName ?? "No primary contact"}</p>
            </div>
          );
        }
      },
      {
        accessorKey: "apolloStatus",
        header: "Apollo",
        filterFn: "includesString",
        size: 140
      },
      {
        accessorKey: "sequenceStatus",
        header: "Sequence",
        filterFn: "includesString",
        size: 220,
        cell: ({ row }) => {
          const lead = row.original;

          return (
            <div className="max-w-[220px] text-mutedForeground">
              <p>{lead.sequenceStatus}</p>
              <p className="mt-1 text-xs">{lead.sequenceReadiness}</p>
            </div>
          );
        }
      },
      {
        accessorKey: "updatedAt",
        header: "Last activity",
        size: 150,
        cell: ({ row }) => {
          const lead = row.original;

          return (
            <div className="text-mutedForeground">
              <p>{formatDate(lead.updatedAt)}</p>
              <p className="mt-1 text-xs">Approved {formatDate(lead.approvedAt)}</p>
            </div>
          );
        }
      },
      {
        accessorKey: "nextStep",
        header: "Next step",
        filterFn: "includesString",
        size: 220,
        cell: ({ row }) => <div className="max-w-[200px] font-medium text-foreground">{row.original.nextStep}</div>
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        enableColumnFilter: false,
        size: 320,
        cell: ({ row }) => {
          const lead = row.original;

          return (
            <div className="flex min-w-[260px] flex-wrap gap-2">
              <form action={updateLeadStageAction} className="flex gap-2">
                <input type="hidden" name="leadId" value={lead.id} />
                <select
                  name="stage"
                  defaultValue={lead.stage}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                >
                  {stageOptions.map((stageOption) => (
                    <option key={stageOption} value={stageOption}>
                      {formatStage(stageOption)}
                    </option>
                  ))}
                </select>
                <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
                  Move
                </button>
              </form>
              <form action={updateLeadStageAction}>
                <input type="hidden" name="leadId" value={lead.id} />
                <input type="hidden" name="stage" value={LeadPipelineStage.DISQUALIFIED} />
                <button
                  onClick={(event) => {
                    if (!confirmSingleDisqualify(lead.companyName)) {
                      event.preventDefault();
                    }
                  }}
                  className="rounded-md border border-danger/30 bg-card px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10"
                >
                  Disqualify
                </button>
              </form>
              <Link
                href="/lead-gen/contacts"
                className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft"
              >
                View contacts
              </Link>
            </div>
          );
        }
      }
    ],
    [selectedSet, stageOptions, updateLeadStageAction]
  );

  const table = useReactTable({
    data: leads,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      columnSizing
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: "onChange"
  });

  const allVisibleSelected =
    table.getRowModel().rows.length > 0 &&
    table.getRowModel().rows.every((row) => selectedSet.has(row.original.id));

  return (
    <div>
      <form action={bulkUpdateLeadStageAction}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/60 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={toggleAllVisible}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft"
            >
              {allVisibleSelected ? "Deselect all visible" : "Select all visible"}
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft"
            >
              Clear selection
            </button>
            <span className="text-xs text-mutedForeground">{selectedIds.length} selected</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedIds.map((leadId) => (
              <input key={leadId} type="hidden" name="leadId" value={leadId} />
            ))}
            <DataGridColumnMenu table={table} />
            <select
              name="stage"
              defaultValue={LeadPipelineStage.RESEARCHING}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground"
            >
              {stageOptions.map((stageOption) => (
                <option key={stageOption} value={stageOption}>
                  {formatStage(stageOption)}
                </option>
              ))}
            </select>
            <BulkActionButton disabled={selectedIds.length === 0}>Move selected</BulkActionButton>
            <button
              type="submit"
              name="stage"
              value={LeadPipelineStage.DISQUALIFIED}
              onClick={(event) => {
                if (!confirmBulkDisqualify()) {
                  event.preventDefault();
                }
              }}
              disabled={selectedIds.length === 0}
              className="rounded-md border border-danger/30 bg-card px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Disqualify selected
            </button>
            <button
              type="submit"
              formAction={bulkQueueApolloEnrichmentAction}
              disabled={selectedIds.length === 0 || hasUnassignedSelection}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft disabled:cursor-not-allowed disabled:opacity-50"
              title={hasUnassignedSelection ? "Assign a sales rep before queueing Apollo enrichment." : undefined}
            >
              Queue Apollo
            </button>
            <select
              name="ownerUserId"
              defaultValue={repOptions[0]?.value ?? ""}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground"
            >
              {repOptions.length > 0 ? (
                repOptions.map((owner) => (
                  <option key={owner.value} value={owner.value}>
                    {owner.label}
                  </option>
                ))
              ) : (
                <option value="">No Apollo reps configured</option>
              )}
            </select>
            <button
              type="submit"
              formAction={bulkAssignLeadOwnerAction}
              disabled={selectedIds.length === 0 || repOptions.length === 0}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft disabled:cursor-not-allowed disabled:opacity-50"
            >
              Assign selected
            </button>
            <button
              type="submit"
              formAction={bulkUnassignLeadOwnerAction}
              disabled={selectedIds.length === 0}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft disabled:cursor-not-allowed disabled:opacity-50"
            >
              Unassign selected
            </button>
          </div>
        </div>
      </form>
      <div className="overflow-x-auto">
        <table className="min-w-[1900px] divide-y divide-border text-sm">
          <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortDirection = header.column.getIsSorted();

                  return (
                    <th key={header.id} className="relative px-4 py-3" style={{ width: header.getSize() }}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-2 transition-colors hover:text-foreground"
                        >
                          <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                          <SortIndicator direction={sortDirection} />
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                      {header.column.getCanResize() ? (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none bg-transparent transition-colors hover:bg-primary/20"
                        />
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            ))}
            <tr>
              {table.getVisibleLeafColumns().map((column) => (
                <th key={`${column.id}-filter`} className="border-t border-border px-4 py-2 align-top normal-case">
                  <PipelineColumnFilterControl column={column} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="align-top transition-colors hover:bg-muted/60">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-4 align-top" style={{ width: cell.column.getSize() }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PipelineActivityNotes({ notes }: { notes: string }) {
  const items = notes
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (items.length === 0) {
    return null;
  }

  const latestItem = items[items.length - 1];

  return (
    <details className="mt-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-mutedForeground">
      <summary className="cursor-pointer list-none font-medium text-foreground">
        Apollo activity
        <span className="ml-2 text-mutedForeground">
          {items.length} update{items.length === 1 ? "" : "s"}
        </span>
      </summary>
      <p className="mt-1 leading-5">{latestItem}</p>
      {items.length > 1 ? (
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          {items.map((item, index) => (
            <p key={`${index}-${item}`} className="leading-5">
              {item}
            </p>
          ))}
        </div>
      ) : null}
    </details>
  );
}

function BulkActionButton({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function CandidateStatusBadge({ status }: { status: CandidateStatus }) {
  const className =
    status === CandidateStatus.APPROVED_FOR_PIPELINE
      ? "border-success/30 bg-success/10 text-success"
      : status === CandidateStatus.DISQUALIFIED
        ? "border-danger/30 bg-danger/10 text-danger"
        : "border-accentBorder bg-accentSoft text-primary";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {status.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}

function formatStage(stage: LeadPipelineStage) {
  return stage
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function SortIndicator({ direction }: { direction: false | "asc" | "desc" }) {
  if (!direction) {
    return <span className="text-[10px] text-mutedForeground">-</span>;
  }

  return <span className="text-[10px] text-foreground">{direction === "asc" ? "▲" : "▼"}</span>;
}

function PipelineColumnFilterControl({
  column
}: {
  column: ReturnType<ReturnType<typeof useReactTable<PipelineLead>>["getVisibleLeafColumns"]>[number];
}) {
  const value = column.getFilterValue();

  if (column.id === "select" || column.id === "actions") {
    return null;
  }

  if (["score", "shipmentCount30d", "shipmentCount90d"].includes(column.id)) {
    return (
      <HeaderFilterNumber
        value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
        onChange={(nextValue) => column.setFilterValue(nextValue)}
        placeholder={
          column.id === "score"
            ? "Min score"
            : column.id === "shipmentCount30d"
              ? "30d min"
              : "90d min"
        }
      />
    );
  }

  if (column.id === "stage") {
    return (
      <HeaderFilterSelect
        value={typeof value === "string" ? value : ""}
        onChange={(nextValue) => column.setFilterValue(nextValue)}
        options={[
          { value: "", label: "Any stage" },
          { value: LeadPipelineStage.NEW, label: "New" },
          { value: LeadPipelineStage.RESEARCHING, label: "Researching" },
          { value: LeadPipelineStage.ENRICHED, label: "Enriched" },
          { value: LeadPipelineStage.QUALIFIED, label: "Qualified" },
          { value: LeadPipelineStage.CONTACTED, label: "Contacted" },
          { value: LeadPipelineStage.REPLIED, label: "Replied" },
          { value: LeadPipelineStage.MEETING_BOOKED, label: "Meeting booked" },
          { value: LeadPipelineStage.QUOTED, label: "Quoted" },
          { value: LeadPipelineStage.WON, label: "Won" },
          { value: LeadPipelineStage.LOST, label: "Lost" },
          { value: LeadPipelineStage.DISQUALIFIED, label: "Disqualified" }
        ]}
      />
    );
  }

  if (column.id === "candidateStatus") {
    return (
      <HeaderFilterSelect
        value={typeof value === "string" ? value : ""}
        onChange={(nextValue) => column.setFilterValue(nextValue)}
        options={[
          { value: "", label: "Any candidate" },
          { value: "NEW", label: "New" },
          { value: "REVIEWING", label: "Reviewing" },
          { value: "APPROVED_FOR_PIPELINE", label: "Approved" },
          { value: "REJECTED", label: "Rejected" },
          { value: "DISQUALIFIED", label: "Disqualified" }
        ]}
      />
    );
  }

  if (column.id === "contactStatus") {
    return (
      <HeaderFilterSelect
        value={typeof value === "string" ? value : ""}
        onChange={(nextValue) => column.setFilterValue(nextValue)}
        options={[
          { value: "", label: "Any contact status" },
          { value: "Not enriched", label: "Not enriched" },
          { value: "Approved", label: "Approved" },
          { value: "Reviewing", label: "Reviewing" }
        ]}
      />
    );
  }

  if (column.id === "apolloStatus") {
    return (
      <HeaderFilterSelect
        value={typeof value === "string" ? value : ""}
        onChange={(nextValue) => column.setFilterValue(nextValue)}
        options={[
          { value: "", label: "Any Apollo state" },
          { value: "NOT_STARTED", label: "Not started" },
          { value: "QUEUED", label: "Queued" },
          { value: "ENRICHED", label: "Enriched" },
          { value: "NOT_FOUND", label: "Not found" },
          { value: "NEEDS_REVIEW", label: "Needs review" }
        ]}
      />
    );
  }

  if (column.id === "sequenceStatus") {
    return (
      <HeaderFilterSelect
        value={typeof value === "string" ? value : ""}
        onChange={(nextValue) => column.setFilterValue(nextValue)}
        options={[
          { value: "", label: "Any sequence state" },
          { value: "NOT_STARTED", label: "Not started" },
          { value: "READY", label: "Ready" },
          { value: "ENROLLED", label: "Enrolled" },
          { value: "REPLIED", label: "Replied" }
        ]}
      />
    );
  }

  const textPlaceholders: Record<string, string> = {
    companyName: "Search company",
    industry: "Filter industry",
    destinationPort: "Filter destination port",
    originPorts: "Filter origin / ship-from",
    assignedRep: "Filter rep",
    nextStep: "Filter next step"
  };

  return <HeaderFilterText value={typeof value === "string" ? value : ""} onChange={(nextValue) => column.setFilterValue(nextValue)} placeholder={textPlaceholders[column.id] ?? "Filter"} />;
}

function HeaderFilterText({
  value,
  onChange,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-mutedForeground"
    />
  );
}

function HeaderFilterNumber({
  value,
  onChange,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="number"
      min="0"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-mutedForeground"
    />
  );
}

function HeaderFilterSelect({
  value,
  onChange,
  options
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
    >
      {options.map((option) => (
        <option key={`${option.value}-${option.label}`} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function minimumNumberFilter(row: { getValue: (columnId: string) => unknown }, columnId: string, filterValue: unknown) {
  if (filterValue === undefined || filterValue === null || filterValue === "") {
    return true;
  }

  const numericFilter = Number(filterValue);
  if (Number.isNaN(numericFilter)) {
    return true;
  }

  const value = Number(row.getValue(columnId));
  return !Number.isNaN(value) && value >= numericFilter;
}
