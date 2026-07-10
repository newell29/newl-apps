import { formatInvoiceEnum } from "@/modules/invoice-automation/components";

export const INVOICE_AUTOMATION_TABLE_PAGE_SIZE_OPTIONS = [25, 50, 75, 100] as const;

export type InvoiceAutomationTablePageSize = (typeof INVOICE_AUTOMATION_TABLE_PAGE_SIZE_OPTIONS)[number];

export function InvoiceAutomationTableControls({
  searchQuery,
  onSearchQueryChange,
  statusFilter,
  statusOptions,
  statusLabel = "Status",
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
  hideTypeFilter = false,
  currencyFilter,
  currencyOptions,
  onCurrencyFilterChange,
  pageSize,
  onPageSizeChange,
  filteredCount,
  totalCount
}: {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  statusFilter: string;
  statusOptions: string[];
  statusLabel?: string;
  onStatusFilterChange: (value: string) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  hideTypeFilter?: boolean;
  currencyFilter: string;
  currencyOptions: string[];
  onCurrencyFilterChange: (value: string) => void;
  pageSize: InvoiceAutomationTablePageSize;
  onPageSizeChange: (value: InvoiceAutomationTablePageSize) => void;
  filteredCount: number;
  totalCount: number;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="grid flex-1 gap-2 md:grid-cols-[minmax(220px,1fr)_auto_auto_auto]">
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-mutedForeground">
          Search
          <input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search table"
            className="min-h-10 rounded-md border border-input bg-background px-3 py-2 text-sm font-normal normal-case tracking-normal text-foreground"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-mutedForeground">
          {statusLabel}
          <select
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value)}
            className="min-h-10 rounded-md border border-input bg-background px-3 py-2 text-sm font-normal normal-case tracking-normal text-foreground"
          >
            <option value="ALL">All</option>
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {formatInvoiceEnum(option)}
              </option>
            ))}
          </select>
        </label>
        {hideTypeFilter ? null : (
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            Type
            <select
              value={typeFilter}
              onChange={(event) => onTypeFilterChange(event.target.value)}
              className="min-h-10 rounded-md border border-input bg-background px-3 py-2 text-sm font-normal normal-case tracking-normal text-foreground"
            >
              <option value="ALL">All</option>
              <option value="CUSTOMER">Customer</option>
              <option value="VENDOR">Vendor</option>
            </select>
          </label>
        )}
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-mutedForeground">
          Currency
          <select
            value={currencyFilter}
            onChange={(event) => onCurrencyFilterChange(event.target.value)}
            className="min-h-10 rounded-md border border-input bg-background px-3 py-2 text-sm font-normal normal-case tracking-normal text-foreground"
          >
            <option value="ALL">All</option>
            {currencyOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-mutedForeground">
          Rows
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value) as InvoiceAutomationTablePageSize)}
            className="min-h-10 rounded-md border border-input bg-background px-3 py-2 text-sm font-normal normal-case tracking-normal text-foreground"
          >
            {INVOICE_AUTOMATION_TABLE_PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <div className="pb-2 text-sm text-mutedForeground">
          {filteredCount.toLocaleString("en-US")} of {totalCount.toLocaleString("en-US")}
        </div>
      </div>
    </div>
  );
}

export function InvoiceAutomationTablePagination({
  page,
  totalPages,
  pageSize,
  filteredCount,
  totalCount,
  onPageChange
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  filteredCount: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}) {
  const start = filteredCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, filteredCount);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-mutedForeground">
      <div>
        Showing {start.toLocaleString("en-US")}-{end.toLocaleString("en-US")} of {filteredCount.toLocaleString("en-US")}
        {filteredCount !== totalCount ? ` filtered from ${totalCount.toLocaleString("en-US")}` : ""}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="rounded-md border border-border px-3 py-1.5 font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          Previous
        </button>
        <span>
          Page {page.toLocaleString("en-US")} of {totalPages.toLocaleString("en-US")}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="rounded-md border border-border px-3 py-1.5 font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
