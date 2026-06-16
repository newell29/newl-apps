"use client";

import { Fragment, useState, useTransition } from "react";
import { UPS_SERVICE_OPTIONS } from "@/modules/ups-tools/constants";
import { parseCsv, toCsv } from "@/modules/ups-tools/csv";
import { roundMoney } from "@/modules/ups-tools/engine";
import type { QuoteResult, UpsAccountConfig, UpsServiceName } from "@/modules/ups-tools/types";
import type { ManagedQuoteSource } from "@/modules/settings/types";

const SAMPLE_CSV = `OriginZIP,DestinationZIP,Weight,Length,Width,Height
28273,10001,10,12,8,4
L5T1Z3,M5H2N2,5,10,6,4
`;

const SAMPLE_TEMPLATE_CSV = `OriginZIP,DestinationZIP,Weight,Length,Width,Height
28273,10001,10,12,8,4
28273,30301,8,10,8,6
L5T1Z3,M5H2N2,5,10,6,4
`;

export function ShipmentRateQuoteClient({
  accounts,
  liveBridgeEnabled,
  plannedSources
}: {
  accounts: UpsAccountConfig[];
  liveBridgeEnabled: boolean;
  plannedSources: ManagedQuoteSource[];
}) {
  const [uploadedRows, setUploadedRows] = useState<Array<Record<string, string>>>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(
    accounts.slice(0, 1).map((account) => account.id)
  );
  const [selectedServices, setSelectedServices] = useState<UpsServiceName[]>(["Ground"]);
  const [isResidential, setIsResidential] = useState(false);
  const [results, setResults] = useState<QuoteResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedAccounts = accounts.filter((account) => selectedAccountIds.includes(account.id));

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setUploadedRows([]);
      return;
    }

    startTransition(async () => {
      const text = await file.text();
      const rows = parseCsv(text);
      setUploadedRows(rows);
      setError(rows.length > 0 ? null : "The uploaded CSV did not contain any shipment rows.");
    });
  }

  function loadSampleRows() {
    const rows = parseCsv(SAMPLE_CSV);
    setUploadedRows(rows);
    setError(null);
  }

  function generateQuotes() {
    if (selectedAccounts.length === 0) {
      setError("Select at least one account before generating quotes.");
      return;
    }

    if (uploadedRows.length === 0) {
      setError("Upload a CSV before generating quotes.");
      return;
    }

    startTransition(() => {
      void fetch("/api/ups/rate-quote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          accountIds: selectedAccounts.map((account) => account.id),
          services: selectedServices,
          isResidential,
          rows: uploadedRows
        })
      })
        .then(async (response) => {
          const json = (await response.json().catch(() => null)) as { data?: QuoteResult[]; error?: string } | null;
          if (!response.ok) {
            throw new Error(json?.error ?? "UPS quote request failed.");
          }

          const nextResults = json?.data ?? [];
          setResults(nextResults);
          setError(nextResults.length > 0 ? null : "No valid shipment rows were found in the upload.");
        })
        .catch((fetchError: unknown) => {
          setResults([]);
          setError(fetchError instanceof Error ? fetchError.message : "UPS quote request failed.");
        });
    });
  }

  function downloadResults() {
    const csv = toCsv(
      results.map((result) => ({
        AccountNumber: result.accountShipperNumber,
        OriginZIP: result.originPostalCode,
        DestinationZIP: result.destinationPostalCode,
        Service: result.service,
        Weight: result.weight,
        BillableWeight: result.billableWeight,
        Dims: result.dims,
        StandardRate: result.standardRate,
        NegotiatedRate: result.negotiatedRate,
        TaxAmount: result.taxAmount,
        TotalWithTax: result.totalWithTax,
        TransitDays: result.transitDays,
        Account: result.accountName,
        Mode: result.mode
      }))
    );

    triggerTextDownload(csv, "shipment-rate-quote.csv", "text/csv;charset=utf-8");
  }

  function downloadExcelResults() {
    const workbook = buildExcelWorkbook(groupResultsByLane(results), selectedAccounts);
    triggerTextDownload(workbook, "shipment-rate-quote.xls", "application/vnd.ms-excel");
  }

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_280px_220px]">
          <label className="space-y-1 text-sm font-medium text-foreground">
            <span>Upload shipments CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>

          <div className="space-y-1 text-sm font-medium text-foreground">
            <span>Accounts to compare</span>
            <div className="rounded-md border border-border bg-background p-2">
              <div className="space-y-2">
                {accounts.map((account) => {
                  const checked = selectedAccountIds.includes(account.id);

                  return (
                    <label key={account.id} className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/50">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          setSelectedAccountIds((current) => {
                            if (event.target.checked) {
                              return current.includes(account.id) ? current : [...current, account.id];
                            }

                            return current.filter((id) => id !== account.id);
                          });
                        }}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">{account.name}</span>
                        <span className="block text-xs text-mutedForeground">
                          {account.originLabel} • {account.countryCode}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-1 text-sm font-medium text-foreground">
            <span>Sample input</span>
            <div className="space-y-2">
              <button
                type="button"
                onClick={loadSampleRows}
                className="w-full rounded-md border border-accentBorder bg-accentSoft px-3 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-accentSoft/80"
              >
                Load sample rows
              </button>
              <button
                type="button"
                onClick={() => triggerCsvDownload(SAMPLE_TEMPLATE_CSV, "sample_shipments.csv")}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Download CSV template
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {UPS_SERVICE_OPTIONS.map((service) => {
            const selected = selectedServices.includes(service);

            return (
              <button
                key={service}
                type="button"
                onClick={() =>
                  setSelectedServices((current) =>
                    current.includes(service)
                      ? current.filter((value) => value !== service)
                      : [...current, service]
                  )
                }
                className={[
                  "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  selected
                    ? "border-primary bg-accentSoft text-primary"
                    : "border-border bg-background text-foreground hover:bg-muted"
                ].join(" ")}
              >
                {service}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={isResidential}
              onChange={(event) => setIsResidential(event.target.checked)}
            />
            Residential delivery
          </label>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={generateQuotes}
              disabled={isPending || selectedServices.length === 0}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Calculating..." : "Generate quote"}
            </button>
            <button
              type="button"
              onClick={downloadResults}
              disabled={results.length === 0}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              Download CSV
            </button>
            <button
              type="button"
              onClick={downloadExcelResults}
              disabled={results.length === 0}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              Export Excel
            </button>
          </div>
        </div>

        <p className="mt-4 text-sm leading-6 text-mutedForeground">
          {liveBridgeEnabled
            ? "Live UPS bridge is enabled for locally configured accounts: upload a CSV, choose service levels, and compare real carrier responses without exposing secrets in the browser."
            : "Dry-run mode mirrors the old bulk quote workflow: upload a CSV, choose service levels, and compare one or more tenant-scoped accounts without exposing live UPS secrets in the browser."}
        </p>
        <p className="mt-2 text-xs font-medium text-mutedForeground">
          {uploadedRows.length > 0
            ? `${uploadedRows.length.toLocaleString("en-US")} shipment rows ready`
            : "No shipment rows loaded yet"}
        </p>
      </div>

      {selectedAccounts.length > 0 ? <UpsAccountBanner accounts={selectedAccounts} liveBridgeEnabled={liveBridgeEnabled} /> : null}
      {plannedSources.length > 0 ? <PlannedSourceBanner sources={plannedSources.filter((source) => source.toolTargets.includes("SHIPMENT_RATE_QUOTE"))} /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      {results.length > 0 ? <QuoteResultsTable results={results} accounts={selectedAccounts} /> : null}
    </section>
  );
}

function PlannedSourceBanner({ sources }: { sources: ManagedQuoteSource[] }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Planned carrier sources</h2>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">
            These carriers are now part of the quote-source directory and will show here while we wire their pricing integrations.
          </p>
        </div>
        <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold text-mutedForeground">
          {sources.length.toLocaleString("en-US")} staged
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {sources.map((source) => (
          <div key={source.id} className="rounded-md border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-foreground">{source.displayName}</p>
                <p className="mt-1 text-sm text-mutedForeground">
                  {source.carrierName} • {source.carrierCode}
                </p>
              </div>
              <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                Planned
              </span>
            </div>
            {source.notes ? <p className="mt-2 text-sm leading-6 text-mutedForeground">{source.notes}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function UpsAccountBanner({
  accounts,
  liveBridgeEnabled
}: {
  accounts: UpsAccountConfig[];
  liveBridgeEnabled: boolean;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Comparison set</h2>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">
            {liveBridgeEnabled
              ? "Selected accounts are matched to your local UPS credentials file at runtime, so this comparison can use real carrier responses."
              : "Select multiple accounts now, and this surface can later widen into carrier-level comparisons without changing the quoting workflow."}
          </p>
        </div>
        <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
          {accounts.length.toLocaleString("en-US")} selected
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {accounts.map((account) => (
          <div key={account.id} className="rounded-md border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium text-foreground">{account.name}</p>
              <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                {liveBridgeEnabled ? "Live bridge" : account.dryRun ? "Dry run" : "Live-ready"}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-mutedForeground">
              Origin {account.originLabel} ({account.originPostalCode}) with shipper number {account.shipperNumber}.
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function QuoteResultsTable({
  results,
  accounts
}: {
  results: QuoteResult[];
  accounts: UpsAccountConfig[];
}) {
  const totalStandard = roundMoney(results.reduce((sum, result) => sum + result.standardRate, 0));
  const totalNegotiated = roundMoney(results.reduce((sum, result) => sum + result.negotiatedRate, 0));
  const rows = groupResultsByLane(results);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Quote results</p>
          <p className="text-xs text-mutedForeground">
            {results.length.toLocaleString("en-US")} quote combinations across selected accounts and services
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full border border-border bg-card px-2.5 py-1 text-foreground">
            Standard ${totalStandard.toFixed(2)}
          </span>
          <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-primary">
            Negotiated ${totalNegotiated.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1280px] divide-y divide-border text-sm">
          <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
            <tr>
              <th className="px-4 py-3" rowSpan={2}>Origin</th>
              <th className="px-4 py-3" rowSpan={2}>Destination</th>
              <th className="px-4 py-3" rowSpan={2}>Service</th>
              <th className="px-4 py-3" rowSpan={2}>Weight</th>
              <th className="px-4 py-3" rowSpan={2}>Dims</th>
              {accounts.map((account) => (
                <th key={account.id} className="px-4 py-3 text-center" colSpan={2}>
                  <div className="text-foreground">{account.shipperNumber}</div>
                  <div className="mt-1 text-[11px] normal-case text-mutedForeground">{account.name}</div>
                </th>
              ))}
            </tr>
            <tr>
              {accounts.map((account) => (
                <Fragment key={`${account.id}-subcols`}>
                  <th className="px-4 py-3">Rate</th>
                  <th className="px-4 py-3">Transit</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.key} className="hover:bg-muted/50">
                <td className="px-4 py-3 text-foreground">{row.originPostalCode}</td>
                <td className="px-4 py-3 text-foreground">{row.destinationPostalCode}</td>
                <td className="px-4 py-3 text-foreground">{row.service}</td>
                <td className="px-4 py-3 text-mutedForeground">{row.billableWeight.toFixed(2)} lb</td>
                <td className="px-4 py-3 text-mutedForeground">{row.dims}</td>
                {accounts.map((account) => {
                  const quote = row.byAccountId[account.id];

                  return (
                    <Fragment key={`${row.key}-${account.id}`}>
                      <td className="px-4 py-3 font-semibold text-foreground">
                        {quote ? `$${quote.totalWithTax.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-mutedForeground">
                        {quote ? `${quote.transitDays}d` : "—"}
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type ComparisonRow = {
  key: string;
  originPostalCode: string;
  destinationPostalCode: string;
  service: UpsServiceName;
  billableWeight: number;
  dims: string;
  byAccountId: Record<string, QuoteResult>;
};

function groupResultsByLane(results: QuoteResult[]): ComparisonRow[] {
  const rows = new Map<string, ComparisonRow>();

  for (const result of results) {
    const key = [
      result.originPostalCode,
      result.destinationPostalCode,
      result.service,
      result.billableWeight.toFixed(2),
      result.dims
    ].join("|");

    const existing = rows.get(key);
    if (existing) {
      existing.byAccountId[result.accountId] = result;
      continue;
    }

    rows.set(key, {
      key,
      originPostalCode: result.originPostalCode,
      destinationPostalCode: result.destinationPostalCode,
      service: result.service,
      billableWeight: result.billableWeight,
      dims: result.dims,
      byAccountId: {
        [result.accountId]: result
      }
    });
  }

  return Array.from(rows.values());
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <section className="rounded-lg border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-foreground shadow-sm">
      {message}
    </section>
  );
}

function triggerCsvDownload(contents: string, fileName: string) {
  triggerTextDownload(contents, fileName, "text/csv;charset=utf-8");
}

function triggerTextDownload(contents: string, fileName: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildExcelWorkbook(rows: ComparisonRow[], accounts: UpsAccountConfig[]) {
  const comparisonHeaderTop = [
    ["Origin", "Destination", "Service", "Weight", "Dims"],
    accounts.flatMap((account) => [
      `${account.shipperNumber} - ${account.name}`,
      ""
    ])
  ].flat();

  const comparisonHeaderBottom = [
    "",
    "",
    "",
    "",
    "",
    ...accounts.flatMap(() => ["Rate", "Transit"])
  ];

  const comparisonRows = rows.map((row) => [
    row.originPostalCode,
    row.destinationPostalCode,
    row.service,
    row.billableWeight.toFixed(2),
    row.dims,
    ...accounts.flatMap((account) => {
      const quote = row.byAccountId[account.id];
      return quote ? [quote.totalWithTax.toFixed(2), String(quote.transitDays)] : ["", ""];
    })
  ]);

  const rawRows = resultsToRawRows(rows);

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Comparison Grid">
    <Table>
      ${worksheetRow(comparisonHeaderTop, true)}
      ${worksheetRow(comparisonHeaderBottom, true)}
      ${comparisonRows.map((row) => worksheetRow(row)).join("")}
    </Table>
  </Worksheet>
  <Worksheet ss:Name="Raw Quotes">
    <Table>
      ${worksheetRow([
        "Account Number",
        "Account Name",
        "Origin ZIP",
        "Destination ZIP",
        "Service",
        "Weight",
        "Billable Weight",
        "Dims",
        "Standard Rate",
        "Negotiated Rate",
        "Tax Amount",
        "Total With Tax",
        "Transit Days",
        "Mode"
      ], true)}
      ${rawRows.map((row) => worksheetRow(row)).join("")}
    </Table>
  </Worksheet>
</Workbook>`;
}

function worksheetRow(values: string[], header = false) {
  return `<Row>${values
    .map((value) => {
      const style = header ? ' ss:StyleID="Header"' : "";
      return `<Cell${style}><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
    })
    .join("")}</Row>`;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function resultsToRawRows(rows: ComparisonRow[]) {
  const flattened: string[][] = [];

  for (const row of rows) {
    for (const quote of Object.values(row.byAccountId)) {
      flattened.push([
        quote.accountShipperNumber,
        quote.accountName,
        quote.originPostalCode,
        quote.destinationPostalCode,
        quote.service,
        quote.weight.toFixed(2),
        quote.billableWeight.toFixed(2),
        quote.dims,
        quote.standardRate.toFixed(2),
        quote.negotiatedRate.toFixed(2),
        quote.taxAmount.toFixed(2),
        quote.totalWithTax.toFixed(2),
        String(quote.transitDays),
        quote.mode
      ]);
    }
  }

  return flattened;
}
