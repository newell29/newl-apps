"use client";

import { useActionState } from "react";

import {
  runSupplyChainDesignThreePlScreeningAction,
  type SupplyChainDesignScreeningRunState
} from "@/modules/supply-chain-design/actions";
import type { SupplyChainDesignThreePlScreeningInputSelection } from "@/modules/supply-chain-design/types";

type Props = {
  projectId: string;
  inputSelection: SupplyChainDesignThreePlScreeningInputSelection;
  mode?: "LOCATION_STRATEGY" | "WAREHOUSE_COST_COMPARISON" | "BOTH";
};

const INITIAL_STATE: SupplyChainDesignScreeningRunState = {
  ok: false,
  message: ""
};

export function SupplyChainDesignThreePlScreeningForm({ projectId, inputSelection, mode = "BOTH" }: Props) {
  const [state, formAction, pending] = useActionState(runSupplyChainDesignThreePlScreeningAction, INITIAL_STATE);
  const locationMode = mode === "LOCATION_STRATEGY";
  const costMode = mode === "WAREHOUSE_COST_COMPARISON";
  const fixedStudyType = locationMode
    ? "FIND_BEST_WAREHOUSE_REGION"
    : costMode
      ? "COMPARE_KNOWN_WAREHOUSE_OPTIONS"
      : null;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="projectId" value={projectId} />
      {fixedStudyType ? <input type="hidden" name="studyType" value={fixedStudyType} /> : null}
      <div>
        <label htmlFor="studyName" className="text-sm font-semibold text-foreground">
          Study name
        </label>
        <input
          id="studyName"
          name="studyName"
          defaultValue="Find the best warehouse region"
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {fixedStudyType ? null : (
          <Select
            label="Study path"
            name="studyType"
            options={[
              { value: "FIND_BEST_WAREHOUSE_REGION", label: "Find the best warehouse region" },
              { value: "COMPARE_KNOWN_WAREHOUSE_OPTIONS", label: "Compare known warehouse options" }
            ]}
          />
        )}
        <Select
          label="Country scope"
          name="countryScope"
          options={[
            { value: "US", label: "United States" },
            { value: "CA", label: "Canada" },
            { value: "US_CA", label: "United States and Canada" }
          ]}
        />
        <Select
          label="Weighting measure"
          name="weightingMeasure"
          options={[{ value: "annual_shipment_count", label: "Annual shipment count" }]}
        />
        <Select
          label="Maximum regions to compare"
          name="maximumRegionsToCompare"
          options={[
            { value: "2", label: "Two regions" },
            { value: "1", label: "One region only" }
          ]}
        />
      </div>
      {costMode ? null : (
        <Select
          label="Market source"
          name="marketSourceMode"
          options={[
            { value: "NEWL_REFERENCE_CATALOGUE", label: "Newl reference catalogue" },
            { value: "PROJECT_UPLOADED_MARKETS", label: "Project uploaded logistics markets" }
          ]}
        />
      )}
      <MappingSelect label="Demand file" name="demandPointsMappingId" input={inputSelection.demandPoints} />
      {locationMode ? null : <div className="rounded-md border border-border bg-muted/20 p-3">
        <p className="text-sm font-semibold text-foreground">Compare known warehouse options inputs</p>
        <p className="mt-1 text-xs text-mutedForeground">
          Required only when the study path is Compare known warehouse options. Rates are read from the uploaded cache;
          no live carrier or provider APIs are called.
        </p>
        <div className="mt-3 space-y-3">
          {inputSelection.providerOptions ? (
            <MappingSelect
              label="Provider options file"
              name="providerOptionsMappingId"
              input={inputSelection.providerOptions}
            />
          ) : (
            <MissingInput label="No PROVIDER_OPTIONS mapping is available." />
          )}
          {inputSelection.shipmentProfiles ? (
            <MappingSelect
              label="Shipment profiles file"
              name="shipmentProfilesMappingId"
              input={inputSelection.shipmentProfiles}
            />
          ) : (
            <MissingInput label="No SHIPMENT_PROFILES mapping is available." />
          )}
          {inputSelection.outboundRateCache ? (
            <MappingSelect
              label="Outbound rate cache file"
              name="outboundRateCacheMappingId"
              input={inputSelection.outboundRateCache}
            />
          ) : (
            <MissingInput label="No OUTBOUND_RATE_CACHE mapping is available." />
          )}
          {inputSelection.expectedProviderResults ? (
            <MappingSelect
              label="Expected provider results file"
              name="expectedProviderResultsMappingId"
              input={inputSelection.expectedProviderResults}
              optional
            />
          ) : (
            <MissingInput label="No EXPECTED_PROVIDER_RESULTS mapping is available. Benchmark controls will be skipped." />
          )}
        </div>
      </div>}
      {costMode ? null : (
        <>
          {inputSelection.logisticsMarkets ? (
            <MappingSelect
              label="Logistics market file"
              name="logisticsMarketsMappingId"
              input={inputSelection.logisticsMarkets}
              optional
              defaultToSelected
            />
          ) : (
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-mutedForeground">
              Normal projects use the internal Newl logistics-market catalogue. Uploaded market files are only for
              internal benchmark mode.
            </p>
          )}
          {inputSelection.canadaProvinceMarketMap ? (
            <MappingSelect
              label="Canada province-market map"
              name="canadaProvinceMarketMapMappingId"
              input={inputSelection.canadaProvinceMarketMap}
              optional
            />
          ) : null}
        </>
      )}
      {state.message ? (
        <p className={`rounded-md px-3 py-2 text-sm ${state.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {state.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground disabled:opacity-60"
      >
        {pending ? "Running 3PL study..." : "Run 3PL study"}
      </button>
    </form>
  );
}

function MissingInput({ label }: { label: string }) {
  return <p className="rounded-md border border-border bg-background px-3 py-2 text-sm text-mutedForeground">{label}</p>;
}

function MappingSelect({
  label,
  name,
  input,
  optional = false,
  defaultToSelected = false
}: {
  label: string;
  name: string;
  input: SupplyChainDesignThreePlScreeningInputSelection["demandPoints"];
  optional?: boolean;
  defaultToSelected?: boolean;
}) {
  return (
    <label className="block text-sm font-semibold text-foreground">
      {label}
      <select
        name={name}
        defaultValue={optional && !defaultToSelected ? "" : input.mappingId}
        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      >
        {optional ? <option value="">None selected</option> : null}
        {input.candidateFiles.map((candidate) => (
          <option key={candidate.mappingId} value={candidate.mappingId}>
            {candidate.fileName}
          </option>
        ))}
      </select>
    </label>
  );
}

function Select({
  label,
  name,
  options
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block text-sm font-semibold text-foreground">
      {label}
      <select name={name} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
