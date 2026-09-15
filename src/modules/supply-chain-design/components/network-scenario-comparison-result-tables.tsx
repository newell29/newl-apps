"use client";

import { useMemo, useState } from "react";

type ScenarioOption = {
  value: string;
  label: string;
};

type ResultTableProps = {
  headers: string[];
  rows: string[][];
  scenarioOptions: ScenarioOption[];
  defaultScenario?: string;
  emptyMessage?: string;
  enableSearch?: boolean;
};

const PAGE_SIZES = [25, 50, 100] as const;

export function NetworkScenarioComparisonPagedTable({
  headers,
  rows,
  scenarioOptions,
  defaultScenario = scenarioOptions[0]?.value ?? "ALL",
  emptyMessage = "No rows to show.",
  enableSearch = false
}: ResultTableProps) {
  const [scenario, setScenario] = useState(defaultScenario);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(25);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      const scenarioMatches = scenario === "ALL" || row[0] === scenario;
      const queryMatches = !normalizedQuery || row.join(" ").toLowerCase().includes(normalizedQuery);
      return scenarioMatches && queryMatches;
    });
  }, [query, rows, scenario]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function updateScenario(value: string) {
    setScenario(value);
    setPage(1);
  }

  function updatePageSize(value: string) {
    setPageSize(Number(value) as (typeof PAGE_SIZES)[number]);
    setPage(1);
  }

  function updateQuery(value: string) {
    setQuery(value);
    setPage(1);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase text-mutedForeground">Scenario</span>
          <select
            value={scenario}
            onChange={(event) => updateScenario(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {scenarioOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase text-mutedForeground">Rows</span>
          <select
            value={pageSize}
            onChange={(event) => updatePageSize(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
        {enableSearch ? (
          <label className="block min-w-56 flex-1 space-y-1">
            <span className="text-xs font-semibold uppercase text-mutedForeground">Delivery filter</span>
            <input
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-mutedForeground">
            <tr>
              {headers.map((header) => <th key={header} className="px-3 py-2 font-semibold">{header}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {visibleRows.length === 0 ? (
              <tr><td className="px-3 py-2 text-mutedForeground" colSpan={headers.length}>{emptyMessage}</td></tr>
            ) : visibleRows.map((row, rowIndex) => (
              <tr key={`${currentPage}-${rowIndex}-${row.join("|")}`}>
                {row.slice(1).map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 text-mutedForeground">{cell || "-"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-mutedForeground">
        <span>Showing {visibleRows.length ? (currentPage - 1) * pageSize + 1 : 0}-{Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length}</span>
        <div className="flex items-center gap-2">
          <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="rounded-md border border-border px-2 py-1 disabled:opacity-50">Previous</button>
          <span>Page {currentPage} of {pageCount}</span>
          <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} className="rounded-md border border-border px-2 py-1 disabled:opacity-50">Next</button>
        </div>
      </div>
    </div>
  );
}
