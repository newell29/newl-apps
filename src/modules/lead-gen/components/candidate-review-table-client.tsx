"use client";

import {
  getFilteredRowModel,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef
} from "@tanstack/react-table";
import { CandidateStatus } from "@prisma/client";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { DataGridColumnMenu } from "@/components/data-grid-column-menu";
import { IndustryBadge } from "@/components/industry-badge";
import { usePersistedTableState } from "@/components/use-persisted-table-state";
import { StageBadge } from "@/components/stage-badge";

type Candidate = {
  id: string;
  companyName: string;
  normalizedName: string;
  domain: string | null;
  source: string | null;
  candidateStatus: CandidateStatus;
  candidateStatusReason: string | null;
  candidateScore: number;
  scoreReasoning: string;
  importedScoreReasoning: string | null;
  shipmentCount: number;
  latestShipmentDate: Date | null;
  matchedSearchProfileId: string | null;
  matchedSearchProfileName: string;
  primaryIndustry: string | null;
  secondaryIndustry: string | null;
  industryConfidence: number | null;
  destinationMarket: string | null;
  destinationPort: string | null;
  originCountry: string | null;
  originPort: string | null;
  shipFromPort: string | null;
  productDescription: string | null;
  hsCode: string | null;
  assignedRep: string;
  currentPipelineStage: string | null;
};

export function CandidateReviewTableClient({
  companies,
  bulkUpdateAction
}: {
  companies: Candidate[];
  bulkUpdateAction: (formData: FormData) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedScoreIds, setExpandedScoreIds] = useState<string[]>([]);
  const [expandedProductIds, setExpandedProductIds] = useState<string[]>([]);
  const {
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    columnVisibility,
    setColumnVisibility,
    columnSizing,
    setColumnSizing
  } = usePersistedTableState("newl-apps:lead-gen:candidates-grid");

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const expandedScoreSet = useMemo(() => new Set(expandedScoreIds), [expandedScoreIds]);
  const expandedProductSet = useMemo(() => new Set(expandedProductIds), [expandedProductIds]);

  function toggleSelection(companyId: string) {
    setSelectedIds((current) =>
      current.includes(companyId) ? current.filter((id) => id !== companyId) : [...current, companyId]
    );
  }

  function toggleScoreExpanded(companyId: string) {
    setExpandedScoreIds((current) =>
      current.includes(companyId) ? current.filter((id) => id !== companyId) : [...current, companyId]
    );
  }

  function toggleProductExpanded(companyId: string) {
    setExpandedProductIds((current) =>
      current.includes(companyId) ? current.filter((id) => id !== companyId) : [...current, companyId]
    );
  }

  function selectAllVisible() {
    setSelectedIds(
      table
        .getRowModel()
        .rows.map((row) => row.original)
        .filter((company) => !company.currentPipelineStage)
        .map((company) => company.id)
    );
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function confirmBulkDisqualify() {
    if (selectedIds.length === 0) {
      return true;
    }

    return window.confirm(
      `Disqualify ${selectedIds.length} compan${selectedIds.length === 1 ? "y" : "ies"}? Disqualified companies will stay out of future TradeMining review pulls unless you manually change their status later.`
    );
  }

  const columns = useMemo<ColumnDef<Candidate>[]>(
    () => [
      {
        id: "select",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const company = row.original;
          const canSelect = !company.currentPipelineStage;

          if (!canSelect) {
            return <span className="text-xs text-mutedForeground">-</span>;
          }

          return (
            <input
              type="checkbox"
              checked={selectedSet.has(company.id)}
              onChange={() => toggleSelection(company.id)}
              aria-label={`Select ${company.companyName}`}
            />
          );
        }
      },
      {
        accessorKey: "companyName",
        header: "Company",
        filterFn: "includesString",
        size: 260,
        cell: ({ row }) => {
          const company = row.original;

          return (
            <div className="max-w-[240px]">
              <p className="font-semibold text-foreground">{company.companyName}</p>
              <p className="mt-1 text-xs text-mutedForeground">{company.normalizedName}</p>
              <p className="mt-1 text-xs text-mutedForeground">{company.domain ?? company.source ?? "TradeMining"}</p>
            </div>
          );
        }
      },
      {
        id: "industry",
        header: "Industry",
        accessorFn: (company) => company.primaryIndustry ?? company.secondaryIndustry ?? "",
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
        accessorKey: "candidateScore",
        header: "Score",
        filterFn: minimumNumberFilter,
        size: 360,
        cell: ({ row }) => {
          const company = row.original;
          const isScoreExpanded = expandedScoreSet.has(company.id);
          const shortReason =
            company.scoreReasoning.length > 88 ? `${company.scoreReasoning.slice(0, 88).trimEnd()}...` : company.scoreReasoning;

          return (
            <div className="w-[320px]">
              <span className="text-xl font-bold text-primary">{company.candidateScore}</span>
              <p className="mt-2 max-w-[320px] text-xs leading-5 text-mutedForeground">
                {isScoreExpanded ? company.scoreReasoning : shortReason}
              </p>
              {company.scoreReasoning.length > 88 ? (
                <button
                  type="button"
                  onClick={() => toggleScoreExpanded(company.id)}
                  className="mt-2 text-xs font-semibold text-primary transition-colors hover:text-primaryHover"
                >
                  {isScoreExpanded ? "Show less" : "Show more"}
                </button>
              ) : null}
              {company.importedScoreReasoning ? (
                <p className="mt-2 max-w-[320px] rounded-md border border-border bg-background px-2 py-1 text-xs text-mutedForeground">
                  Ingested note: {company.importedScoreReasoning}
                </p>
              ) : null}
            </div>
          );
        }
      },
      {
        accessorKey: "candidateStatus",
        header: "Status",
        filterFn: statusEqualsFilter,
        size: 180,
        cell: ({ row }) => {
          const company = row.original;

          return (
            <div>
              <CandidateStatusBadge status={company.candidateStatus} />
              {company.candidateStatusReason ? (
                <p className="mt-2 max-w-[170px] text-xs text-mutedForeground">{company.candidateStatusReason}</p>
              ) : null}
            </div>
          );
        }
      },
      {
        accessorKey: "matchedSearchProfileName",
        header: "Matched profile",
        filterFn: "includesString",
        size: 200,
        cell: ({ row }) => {
          const company = row.original;

          return (
            <div className="max-w-[180px] text-mutedForeground">
              <p className="font-medium text-foreground">{company.matchedSearchProfileName}</p>
              <p className="text-xs">{company.matchedSearchProfileId ?? "No profile id"}</p>
            </div>
          );
        }
      },
      {
        accessorKey: "shipmentCount",
        header: "Shipments",
        filterFn: minimumNumberFilter,
        size: 140,
        cell: ({ row }) => {
          const company = row.original;

          return (
            <div className="text-mutedForeground">
              <p className="font-semibold text-foreground">{company.shipmentCount}</p>
              <p className="text-xs">Latest {formatDate(company.latestShipmentDate)}</p>
            </div>
          );
        }
      },
      {
        id: "destination",
        header: "Destination",
        accessorFn: (company) => company.destinationMarket ?? company.destinationPort ?? "",
        filterFn: "includesString",
        size: 180,
        cell: ({ row }) => (
          <div className="max-w-[170px] text-mutedForeground">
            {row.original.destinationMarket ?? row.original.destinationPort ?? "Unknown"}
          </div>
        )
      },
      {
        id: "origin",
        header: "Origin",
        accessorFn: (company) => [company.originCountry, company.originPort, company.shipFromPort].filter(Boolean).join(" / "),
        filterFn: "includesString",
        size: 210,
        cell: ({ row }) => (
          <div className="max-w-[190px] text-mutedForeground">
            {[row.original.originCountry, row.original.originPort, row.original.shipFromPort].filter(Boolean).join(" / ") ||
              "Unknown"}
          </div>
        )
      },
      {
        id: "product",
        header: "Product / HS",
        accessorFn: (company) => `${company.productDescription ?? ""} ${company.hsCode ?? ""}`.trim(),
        filterFn: "includesString",
        size: 270,
        cell: ({ row }) => {
          const company = row.original;
          const isProductExpanded = expandedProductSet.has(company.id);
          const productSummary = company.productDescription ?? "Unknown product";
          const hsSummary = company.hsCode ? `HS: ${company.hsCode}` : "HS: Unknown";
          const combinedProductText = `${productSummary} ${hsSummary}`;
          const showProductToggle = combinedProductText.length > 72;

          return (
            <div className="w-[250px] text-mutedForeground">
              {isProductExpanded ? (
                <>
                  <p>{productSummary}</p>
                  <p className="mt-1 break-all text-xs">{hsSummary}</p>
                </>
              ) : (
                <>
                  <p className="line-clamp-2">{productSummary}</p>
                  <p className="mt-1 line-clamp-1 break-all text-xs">{hsSummary}</p>
                </>
              )}
              {showProductToggle ? (
                <button
                  type="button"
                  onClick={() => toggleProductExpanded(company.id)}
                  className="mt-2 text-xs font-semibold text-primary transition-colors hover:text-primaryHover"
                >
                  {isProductExpanded ? "Show less" : "Show more"}
                </button>
              ) : null}
            </div>
          );
        }
      },
      {
        accessorKey: "assignedRep",
        header: "Rep",
        filterFn: "includesString",
        size: 150
      },
      {
        accessorKey: "currentPipelineStage",
        header: "Pipeline",
        filterFn: "includesString",
        size: 150,
        cell: ({ row }) => {
          const company = row.original;

          return company.currentPipelineStage ? (
            <div className="space-y-2">
              <StageBadge stage={company.currentPipelineStage} />
              <Link className="block text-xs font-semibold text-primary hover:text-primaryHover" href="/lead-gen/pipeline">
                In Pipeline
              </Link>
            </div>
          ) : (
            <span className="text-xs font-medium text-mutedForeground">Not approved</span>
          );
        }
      }
    ],
    [expandedProductSet, expandedScoreSet, selectedSet]
  );

  const table = useReactTable({
    data: companies,
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

  return (
    <form action={bulkUpdateAction}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/60 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={selectAllVisible}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft"
          >
            Select all visible
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
          <DataGridColumnMenu table={table} />
          <BulkStatusButton status={CandidateStatus.REVIEWING} disabled={selectedIds.length === 0}>
            Mark reviewing
          </BulkStatusButton>
          <BulkStatusButton status={CandidateStatus.APPROVED_FOR_PIPELINE} disabled={selectedIds.length === 0} primary>
            Approve selected
          </BulkStatusButton>
          <BulkStatusButton status={CandidateStatus.REJECTED} disabled={selectedIds.length === 0}>
            Reject selected
          </BulkStatusButton>
          <BulkStatusButton
            status={CandidateStatus.DISQUALIFIED}
            disabled={selectedIds.length === 0}
            onBeforeSubmit={confirmBulkDisqualify}
          >
            Disqualify selected
          </BulkStatusButton>
        </div>
      </div>

      {selectedIds.map((companyId) => (
        <input key={companyId} type="hidden" name="companyId" value={companyId} />
      ))}

      <div className="overflow-x-auto">
        <table className="min-w-[1500px] divide-y divide-border text-sm">
          <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortDirection = header.column.getIsSorted();

                  return (
                    <th
                      key={header.id}
                      className="relative px-4 py-3"
                      style={{ width: header.getSize() }}
                    >
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
                  <ColumnFilterControl column={column} />
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
    </form>
  );
}

function BulkStatusButton({
  status,
  disabled,
  primary,
  children,
  onBeforeSubmit
}: {
  status: CandidateStatus;
  disabled: boolean;
  primary?: boolean;
  children: ReactNode;
  onBeforeSubmit?: () => boolean;
}) {
  return (
    <button
      type="submit"
      name="status"
      value={status}
      onClick={(event) => {
        if (onBeforeSubmit && !onBeforeSubmit()) {
          event.preventDefault();
        }
      }}
      disabled={disabled}
      className={
        primary
          ? "rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-50"
          : "rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {children}
    </button>
  );
}

function CandidateStatusBadge({ status }: { status: CandidateStatus }) {
  const className =
    status === CandidateStatus.APPROVED_FOR_PIPELINE
      ? "border-success/30 bg-success/10 text-success"
      : status === CandidateStatus.REJECTED || status === CandidateStatus.DISQUALIFIED
        ? "border-danger/30 bg-danger/10 text-danger"
        : status === CandidateStatus.REVIEWING
          ? "border-warning/30 bg-warning/10 text-warning"
          : "border-accentBorder bg-accentSoft text-primary";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {status.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}

function formatDate(value: Date | null) {
  if (!value) {
    return "Unknown";
  }

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

function ColumnFilterControl({
  column
}: {
  column: ReturnType<ReturnType<typeof useReactTable<Candidate>>["getVisibleLeafColumns"]>[number];
}) {
  const value = column.getFilterValue();

  if (column.id === "select") {
    return null;
  }

  if (column.id === "candidateStatus") {
    return (
      <HeaderFilterSelect
        value={typeof value === "string" ? value : ""}
        onChange={(nextValue) => column.setFilterValue(nextValue || undefined)}
        options={[
          { value: "", label: "Any status" },
          { value: "new", label: "New" },
          { value: "reviewing", label: "Reviewing" },
          { value: "approved for pipeline", label: "Approved" },
          { value: "rejected", label: "Rejected" },
          { value: "disqualified", label: "Disqualified" }
        ]}
      />
    );
  }

  if (column.id === "candidateScore" || column.id === "shipmentCount") {
    return (
      <HeaderFilterNumber
        value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
        onChange={(nextValue) => column.setFilterValue(nextValue)}
        placeholder={column.id === "candidateScore" ? "Min score" : "Min shipments"}
      />
    );
  }

  const textPlaceholders: Record<string, string> = {
    companyName: "Search company",
    industry: "Filter industry",
    matchedSearchProfileName: "Filter profile",
    destination: "Filter destination",
    origin: "Filter origin",
    product: "Filter product / HS",
    assignedRep: "Filter rep",
    currentPipelineStage: "Filter pipeline"
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

function statusEqualsFilter(row: { getValue: (columnId: string) => unknown }, columnId: string, filterValue: unknown) {
  if (!filterValue || typeof filterValue !== "string") {
    return true;
  }

  const value = String(row.getValue(columnId) ?? "")
    .replaceAll("_", " ")
    .toLowerCase();

  return value.includes(filterValue.toLowerCase());
}
