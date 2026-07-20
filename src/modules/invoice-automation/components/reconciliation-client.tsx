"use client";

import { useMemo, useState } from "react";
import { formatInvoiceMoney } from "@/modules/invoice-automation/components";
import {
  InvoiceAutomationTableControls,
  InvoiceAutomationTablePagination,
  type InvoiceAutomationTablePageSize
} from "@/modules/invoice-automation/components/table-controls";
import type {
  InvoiceAutomationReconciliationRisk,
  InvoiceAutomationReconciliationRow
} from "@/modules/invoice-automation/queries";

const RISK_OPTIONS: InvoiceAutomationReconciliationRisk[] = [
  "MISSING_CUSTOMER_INVOICE",
  "MISSING_VENDOR_INVOICE",
  "HIGH_MARGIN",
  "ELEVATED_MARGIN",
  "NEGATIVE_MARGIN",
  "FX_MISSING"
];

export function InvoiceReconciliationClient({ rows }: { rows: InvoiceAutomationReconciliationRow[] }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState("ALL");
  const [pageSize, setPageSize] = useState<InvoiceAutomationTablePageSize>(25);
  const [page, setPage] = useState(1);

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesRisk = riskFilter === "ALL" || row.risks.includes(riskFilter as InvoiceAutomationReconciliationRisk);
      const matchesSearch = !normalizedSearch || [
        row.shipmentFileNumber,
        row.shipmentType,
        row.customerNames.join(" "),
        row.customerInvoiceNumbers.join(" "),
        row.vendorInvoiceNumbers.join(" "),
        row.risks.join(" ")
      ].filter(Boolean).join(" ").toLowerCase().includes(normalizedSearch);
      return matchesRisk && matchesSearch;
    });
  }, [rows, searchQuery, riskFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setPage(1);
  }

  function handleRiskFilterChange(value: string) {
    setRiskFilter(value);
    setPage(1);
  }

  function handlePageSizeChange(value: InvoiceAutomationTablePageSize) {
    setPageSize(value);
    setPage(1);
  }

  return (
    <div className="space-y-4 p-4">
      <InvoiceAutomationTableControls
        searchQuery={searchQuery}
        onSearchQueryChange={handleSearchChange}
        statusFilter={riskFilter}
        statusOptions={RISK_OPTIONS}
        statusLabel="Risk"
        onStatusFilterChange={handleRiskFilterChange}
        typeFilter="ALL"
        onTypeFilterChange={() => undefined}
        hideTypeFilter
        currencyFilter="ALL"
        currencyOptions={[]}
        onCurrencyFilterChange={() => undefined}
        hideCurrencyFilter
        pageSize={pageSize}
        onPageSizeChange={handlePageSizeChange}
        filteredCount={filteredRows.length}
        totalCount={rows.length}
      />

      <div className="overflow-x-auto">
        <table className="min-w-[1500px] divide-y divide-border text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-mutedForeground">
            <tr>
              <th className="px-3 py-3">Risk</th>
              <th className="px-3 py-3">File #</th>
              <th className="px-3 py-3">Service</th>
              <th className="px-3 py-3">Customer</th>
              <th className="px-3 py-3 text-right">Customer invoices</th>
              <th className="px-3 py-3 text-right">Vendor invoices</th>
              <th className="px-3 py-3 text-right">Revenue CAD</th>
              <th className="px-3 py-3 text-right">Cost CAD</th>
              <th className="px-3 py-3 text-right">Profit CAD</th>
              <th className="px-3 py-3 text-right">Margin</th>
              <th className="px-3 py-3">Customer invoice #</th>
              <th className="px-3 py-3">Vendor invoice #</th>
              <th className="px-3 py-3">Latest date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleRows.map((row) => (
              <tr key={row.shipmentFileNumber}>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {row.risks.length > 0 ? row.risks.map((risk) => <RiskBadge key={risk} risk={risk} />) : <span className="text-mutedForeground">Clear</span>}
                  </div>
                </td>
                <td className="px-3 py-3 font-semibold text-foreground">{row.shipmentFileNumber}</td>
                <td className="px-3 py-3">{row.shipmentType ?? "n/a"}</td>
                <td className="px-3 py-3">{row.customerNames.length > 0 ? row.customerNames.join(", ") : "No customer invoice"}</td>
                <td className="px-3 py-3 text-right">{formatCount(row.customerInvoiceCount, row.unknownCustomerRevenueCount)}</td>
                <td className="px-3 py-3 text-right">{formatCount(row.vendorInvoiceCount, row.unknownVendorCostCount)}</td>
                <td className="px-3 py-3 text-right font-medium">{formatInvoiceMoney(row.customerRevenueCad, "CAD")}</td>
                <td className="px-3 py-3 text-right font-medium">{formatInvoiceMoney(row.vendorCostCad, "CAD")}</td>
                <td className={`px-3 py-3 text-right font-semibold ${row.grossProfitCad !== null && row.grossProfitCad < 0 ? "text-danger" : "text-foreground"}`}>
                  {formatInvoiceMoney(row.grossProfitCad, "CAD")}
                </td>
                <td className="px-3 py-3 text-right font-medium">{row.grossMarginPercent === null ? "n/a" : `${row.grossMarginPercent.toFixed(1)}%`}</td>
                <td className="px-3 py-3">{row.customerInvoiceNumbers.join(", ") || "n/a"}</td>
                <td className="px-3 py-3">{row.vendorInvoiceNumbers.join(", ") || "n/a"}</td>
                <td className="px-3 py-3">{row.latestInvoiceDate ?? "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <InvoiceAutomationTablePagination
        page={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        filteredCount={filteredRows.length}
        totalCount={rows.length}
        onPageChange={setPage}
      />
    </div>
  );
}

function RiskBadge({ risk }: { risk: InvoiceAutomationReconciliationRisk }) {
  const className = {
    MISSING_CUSTOMER_INVOICE: "border-danger/25 bg-danger/10 text-danger",
    MISSING_VENDOR_INVOICE: "border-warning/25 bg-warning/10 text-warning",
    HIGH_MARGIN: "border-danger/25 bg-danger/10 text-danger",
    ELEVATED_MARGIN: "border-warning/25 bg-warning/10 text-warning",
    NEGATIVE_MARGIN: "border-danger/25 bg-danger/10 text-danger",
    FX_MISSING: "border-border bg-muted text-mutedForeground"
  }[risk];

  return <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${className}`}>{formatRiskLabel(risk)}</span>;
}

function formatRiskLabel(value: InvoiceAutomationReconciliationRisk) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatCount(count: number, unknownCount: number) {
  return unknownCount > 0 ? `${count.toLocaleString("en-US")} (${unknownCount.toLocaleString("en-US")} FX missing)` : count.toLocaleString("en-US");
}
