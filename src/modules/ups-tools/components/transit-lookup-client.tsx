"use client";

import { useState, useTransition } from "react";
import { parseCsv, toCsv } from "@/modules/ups-tools/csv";
import { estimateQuote, inferCountryFromPostalCode } from "@/modules/ups-tools/engine";
import type { UpsAccountConfig } from "@/modules/ups-tools/types";

const SAMPLE_CSV = `DestinationZIP
10001
90210
M5H2N2
`;

type TransitResult = {
  destinationPostalCode: string;
  destinationCountryCode: "US" | "CA";
  transitDays: number;
  accountName: string;
  lane: string;
};

export function TransitLookupClient({ accounts }: { accounts: UpsAccountConfig[] }) {
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id ?? "");
  const [uploadedRows, setUploadedRows] = useState<Array<Record<string, string>>>([]);
  const [manualZips, setManualZips] = useState("");
  const [results, setResults] = useState<TransitResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? accounts[0];

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
    });
  }

  function generateResults() {
    if (!selectedAccount) {
      setError("Add or seed a UPS account before generating transit lookups.");
      return;
    }

    const uploadedZips = uploadedRows.map((row) => (row.DestinationZIP ?? "").trim()).filter(Boolean);
    const manualZipValues = manualZips
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean);

    const destinations = [...uploadedZips, ...manualZipValues];

    if (destinations.length === 0) {
      setError("Upload a CSV or enter destination ZIP values.");
      return;
    }

    startTransition(() => {
      const nextResults = destinations.map((destinationPostalCode) => {
        const destinationCountryCode = inferCountryFromPostalCode(destinationPostalCode);
        const quote = estimateQuote(selectedAccount, {
          originPostalCode: selectedAccount.originPostalCode,
          originCountryCode: selectedAccount.countryCode,
          destinationPostalCode,
          destinationCountryCode,
          weight: 1,
          length: 0,
          width: 0,
          height: 0,
          service: "Ground",
          isResidential: false
        });

        return {
          destinationPostalCode,
          destinationCountryCode,
          transitDays: quote.transitDays,
          accountName: selectedAccount.name,
          lane: `${selectedAccount.originPostalCode} -> ${destinationPostalCode}`
        };
      });

      setResults(nextResults);
      setError(null);
    });
  }

  function downloadResults() {
    const csv = toCsv(
      results.map((result) => ({
        DestinationZIP: result.destinationPostalCode,
        DestinationCountry: result.destinationCountryCode,
        TransitDays: result.transitDays,
        Account: result.accountName,
        Lane: result.lane
      }))
    );

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "transit-lookup.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[220px_1fr_220px]">
          <label className="space-y-1 text-sm font-medium text-foreground">
            <span>Account</span>
            <select
              value={selectedAccountId}
              onChange={(event) => setSelectedAccountId(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.originLabel}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm font-medium text-foreground">
            <span>Manual destination ZIPs</span>
            <textarea
              value={manualZips}
              onChange={(event) => setManualZips(event.target.value)}
              rows={3}
              placeholder="10001, 60601, M5H2N2"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>

          <div className="space-y-1 text-sm font-medium text-foreground">
            <span>Sample input</span>
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = "sample_transit_lookup.csv";
                link.click();
                URL.revokeObjectURL(url);
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Download sample CSV
            </button>
          </div>
        </div>

        <label className="mt-4 block space-y-1 text-sm font-medium text-foreground">
          <span>Upload destination CSV</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={generateResults}
            disabled={isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Calculating..." : "Get transit times"}
          </button>
          <button
            type="button"
            onClick={downloadResults}
            disabled={results.length === 0}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            Download CSV
          </button>
        </div>

        <p className="mt-4 text-sm leading-6 text-mutedForeground">
          Transit lookup currently runs on the tenant-safe dry-run engine. The route is structured so a future server-side UPS time-in-transit boundary can replace the estimator without changing the page workflow.
        </p>
      </div>

      {error ? (
        <section className="rounded-lg border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-foreground shadow-sm">
          {error}
        </section>
      ) : null}

      {results.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="border-b border-border bg-muted px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Transit results</p>
            <p className="text-xs text-mutedForeground">{results.length.toLocaleString("en-US")} destinations analyzed</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[760px] divide-y divide-border text-sm">
              <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
                <tr>
                  <th className="px-4 py-3">Lane</th>
                  <th className="px-4 py-3">Destination</th>
                  <th className="px-4 py-3">Country</th>
                  <th className="px-4 py-3">Transit</th>
                  <th className="px-4 py-3">Account</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {results.map((result) => (
                  <tr key={result.lane} className="hover:bg-muted/50">
                    <td className="px-4 py-3 text-foreground">{result.lane}</td>
                    <td className="px-4 py-3 text-foreground">{result.destinationPostalCode}</td>
                    <td className="px-4 py-3 text-mutedForeground">{result.destinationCountryCode}</td>
                    <td className="px-4 py-3 font-semibold text-foreground">{result.transitDays} days</td>
                    <td className="px-4 py-3 text-mutedForeground">{result.accountName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </section>
  );
}
