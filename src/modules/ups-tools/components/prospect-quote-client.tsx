"use client";

import { useState, useTransition } from "react";
import { POPULAR_CA_DESTINATIONS, POPULAR_US_DESTINATIONS, UPS_SERVICE_OPTIONS } from "@/modules/ups-tools/constants";
import { toCsv } from "@/modules/ups-tools/csv";
import { estimateQuote, inferCountryFromPostalCode } from "@/modules/ups-tools/engine";
import type { ProspectItem, QuoteResult, UpsAccountConfig, UpsServiceName } from "@/modules/ups-tools/types";
import type { ManagedQuoteSource } from "@/modules/settings/types";

const INITIAL_ITEM: ProspectItem = {
  length: 0,
  width: 0,
  height: 0,
  weight: 0
};

export function ProspectQuoteClient({
  accounts,
  plannedSources
}: {
  accounts: UpsAccountConfig[];
  plannedSources: ManagedQuoteSource[];
}) {
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id ?? "");
  const [selectedServices, setSelectedServices] = useState<UpsServiceName[]>(["Ground"]);
  const [destinationCountry, setDestinationCountry] = useState<"US" | "CA">("US");
  const [zipMode, setZipMode] = useState<"popular" | "manual">("popular");
  const [manualZips, setManualZips] = useState("");
  const [isResidential, setIsResidential] = useState(false);
  const [items, setItems] = useState<ProspectItem[]>([{ ...INITIAL_ITEM }]);
  const [results, setResults] = useState<QuoteResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? accounts[0];

  function updateItem(index: number, field: keyof ProspectItem, value: number) {
    setItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item))
    );
  }

  function addItem() {
    setItems((current) => [...current, { ...INITIAL_ITEM }]);
  }

  function removeItem(index: number) {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function generateQuotes() {
    if (!selectedAccount) {
      setError("Add or seed a UPS account before generating prospect quotes.");
      return;
    }

    const destinationRows =
      zipMode === "popular"
        ? (destinationCountry === "US" ? POPULAR_US_DESTINATIONS : POPULAR_CA_DESTINATIONS).map((entry) => entry.postalCode)
        : manualZips
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);

    if (destinationRows.length === 0) {
      setError("Add at least one destination ZIP or postal code.");
      return;
    }

    startTransition(() => {
      const nextResults: QuoteResult[] = [];

      for (const destinationPostalCode of destinationRows) {
        for (const item of items) {
          if (item.weight <= 0) {
            continue;
          }

          for (const service of selectedServices) {
            nextResults.push(
              estimateQuote(selectedAccount, {
                originPostalCode: selectedAccount.originPostalCode,
                originCountryCode: selectedAccount.countryCode,
                destinationPostalCode,
                destinationCountryCode: inferCountryFromPostalCode(destinationPostalCode),
                weight: item.weight,
                length: item.length,
                width: item.width,
                height: item.height,
                service,
                isResidential
              })
            );
          }
        }
      }

      setResults(nextResults);
      setError(nextResults.length > 0 ? null : "Enter at least one valid item weight to generate quotes.");
    });
  }

  function downloadResults() {
    const csv = toCsv(
      results.map((result) => ({
        DestinationZIP: result.destinationPostalCode,
        Service: result.service,
        Weight: result.weight,
        Dims: result.dims,
        Residential: result.isResidential ? "Yes" : "No",
        StandardRate: result.standardRate,
        NegotiatedRate: result.negotiatedRate,
        TotalWithTax: result.totalWithTax,
        TransitDays: result.transitDays
      }))
    );

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "prospect-quote.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-4">
          <label className="space-y-1 text-sm font-medium text-foreground">
            <span>Ship from account</span>
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
            <span>Destination country</span>
            <select
              value={destinationCountry}
              onChange={(event) => setDestinationCountry(event.target.value === "CA" ? "CA" : "US")}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="US">United States</option>
              <option value="CA">Canada</option>
            </select>
          </label>

          <label className="space-y-1 text-sm font-medium text-foreground">
            <span>Destination set</span>
            <select
              value={zipMode}
              onChange={(event) => setZipMode(event.target.value === "manual" ? "manual" : "popular")}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="popular">Popular destination list</option>
              <option value="manual">Manual ZIP entry</option>
            </select>
          </label>

          <label className="flex items-end gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={isResidential}
              onChange={(event) => setIsResidential(event.target.checked)}
            />
            Residential delivery
          </label>
        </div>

        {zipMode === "manual" ? (
          <label className="mt-4 block space-y-1 text-sm font-medium text-foreground">
            <span>ZIP / postal codes</span>
            <textarea
              value={manualZips}
              onChange={(event) => setManualZips(event.target.value)}
              rows={3}
              placeholder="10001, 30301, M5H2N2"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
        ) : (
          <p className="mt-4 text-sm leading-6 text-mutedForeground">
            Using the built-in top destination list for {destinationCountry === "US" ? "United States" : "Canada"}.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {UPS_SERVICE_OPTIONS.map((service) => (
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
                selectedServices.includes(service)
                  ? "border-primary bg-accentSoft text-primary"
                  : "border-border bg-background text-foreground hover:bg-muted"
              ].join(" ")}
            >
              {service}
            </button>
          ))}
        </div>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Prospect items</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Enter one or more package profiles. The tool fans them across the selected destination set and service levels.
            </p>
          </div>
          <button
            type="button"
            onClick={addItem}
            className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            Add item
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {items.map((item, index) => (
            <div key={index} className="grid gap-3 rounded-md border border-border bg-muted/40 p-3 md:grid-cols-5">
              <NumberField label="Length" value={item.length} onChange={(value) => updateItem(index, "length", value)} />
              <NumberField label="Width" value={item.width} onChange={(value) => updateItem(index, "width", value)} />
              <NumberField label="Height" value={item.height} onChange={(value) => updateItem(index, "height", value)} />
              <NumberField label="Weight" value={item.weight} onChange={(value) => updateItem(index, "weight", value)} />
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  disabled={items.length === 1}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={generateQuotes}
            disabled={isPending || selectedServices.length === 0}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Calculating..." : "Generate quote grid"}
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
      </section>

      {error ? (
        <section className="rounded-lg border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-foreground shadow-sm">
          {error}
        </section>
      ) : null}

      {plannedSources.filter((source) => source.toolTargets.includes("PROSPECT_QUOTE")).length > 0 ? (
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Planned carrier sources</h2>
              <p className="mt-1 text-sm leading-6 text-mutedForeground">
                These carriers are staged in settings and will show up here as quotable options once their rating logic is connected.
              </p>
            </div>
            <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold text-mutedForeground">
              {plannedSources.filter((source) => source.toolTargets.includes("PROSPECT_QUOTE")).length.toLocaleString("en-US")} staged
            </span>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {plannedSources
              .filter((source) => source.toolTargets.includes("PROSPECT_QUOTE"))
              .map((source) => (
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
      ) : null}

      {results.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Prospect quote results</p>
              <p className="text-xs text-mutedForeground">{results.length.toLocaleString("en-US")} combinations generated</p>
            </div>
            <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
              {results.length.toLocaleString("en-US")} results
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[980px] divide-y divide-border text-sm">
              <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
                <tr>
                  <th className="px-4 py-3">Destination</th>
                  <th className="px-4 py-3">Service</th>
                  <th className="px-4 py-3">Weight</th>
                  <th className="px-4 py-3">Dims</th>
                  <th className="px-4 py-3">Standard</th>
                  <th className="px-4 py-3">Negotiated</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Transit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {results.map((result, index) => (
                  <tr
                    key={`${result.destinationPostalCode}-${result.service}-${index}`}
                    className="transition-colors hover:bg-muted/50"
                  >
                    <td className="px-4 py-3 text-foreground">{result.destinationPostalCode}</td>
                    <td className="px-4 py-3 text-foreground">{result.service}</td>
                    <td className="px-4 py-3 text-mutedForeground">{result.billableWeight.toFixed(2)} lb</td>
                    <td className="px-4 py-3 text-mutedForeground">{result.dims}</td>
                    <td className="px-4 py-3 text-foreground">${result.standardRate.toFixed(2)}</td>
                    <td className="px-4 py-3 text-foreground">${result.negotiatedRate.toFixed(2)}</td>
                    <td className="px-4 py-3 font-semibold text-foreground">${result.totalWithTax.toFixed(2)}</td>
                    <td className="px-4 py-3 text-mutedForeground">{result.transitDays} days</td>
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

function NumberField({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number.parseFloat(event.target.value) || 0)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
    </label>
  );
}
