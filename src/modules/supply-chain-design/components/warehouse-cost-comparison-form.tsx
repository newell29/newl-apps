"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { runSupplyChainDesignWarehouseCostComparisonAction } from "@/modules/supply-chain-design/actions";
import type { SupplyChainDesignWarehouseCostComparisonReadiness } from "@/modules/supply-chain-design/types";

const initialState = { ok: false, message: "" };

export function SupplyChainDesignWarehouseCostComparisonForm({
  projectId,
  inputSelection,
  initialSelectedFacilityOptionIds,
  initialCadToUsdRate
}: {
  projectId: string;
  inputSelection: NonNullable<SupplyChainDesignWarehouseCostComparisonReadiness["inputSelection"]>;
  initialSelectedFacilityOptionIds?: string[] | null;
  initialCadToUsdRate?: number | null;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(runSupplyChainDesignWarehouseCostComparisonAction, initialState);
  const [selectedIds, setSelectedIds] = useState(
    initialSelectedFacilityOptionIds?.length ? initialSelectedFacilityOptionIds : inputSelection.facilityOptions.slice(0, 2).map((facility) => facility.optionId)
  );
  const [cadToUsdRate, setCadToUsdRate] = useState(initialCadToUsdRate === null || initialCadToUsdRate === undefined ? "" : String(initialCadToUsdRate));
  const selectedCurrencies = useMemo(() => {
    const selected = new Set(selectedIds);
    return Array.from(new Set(inputSelection.facilityOptions.filter((facility) => selected.has(facility.optionId) && facility.comparableAnnualWarehouseCost !== null).map((facility) => facility.currency).filter(Boolean))).sort();
  }, [inputSelection.facilityOptions, selectedIds]);
  const needsCadToUsdRate = selectedCurrencies.length === 2 && selectedCurrencies.includes("USD") && selectedCurrencies.includes("CAD");

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [router, state.ok]);

  useEffect(() => {
    setSelectedIds(initialSelectedFacilityOptionIds?.length ? initialSelectedFacilityOptionIds : inputSelection.facilityOptions.slice(0, 2).map((facility) => facility.optionId));
    setCadToUsdRate(initialCadToUsdRate === null || initialCadToUsdRate === undefined ? "" : String(initialCadToUsdRate));
  }, [initialCadToUsdRate, initialSelectedFacilityOptionIds, inputSelection.facilityOptions]);

  function toggle(optionId: string) {
    setSelectedIds((current) => current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId]);
  }

  return (
    <form action={formAction} className="space-y-3 rounded-md border border-border bg-background p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="facilitiesMappingId" value={inputSelection.facilities.mappingId} />
      <input type="hidden" name="candidateFacilitiesMappingId" value={inputSelection.candidateFacilities.mappingId} />
      <p className="text-xs text-mutedForeground">Select any two or more current and candidate facilities to compare warehouse operating costs only.</p>
      <div className="space-y-2">
        {inputSelection.facilityOptions.map((facility) => (
          <label key={facility.optionId} className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2">
            <input
              type="checkbox"
              name="facilityOptionIds"
              value={facility.optionId}
              checked={selectedIds.includes(facility.optionId)}
              onChange={() => toggle(facility.optionId)}
              className="mt-1 h-4 w-4 rounded border-border"
            />
            <span className="text-sm text-foreground">
              <span className="font-semibold">{facility.facilityName}</span>
              <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold uppercase text-mutedForeground">{facility.facilityType === "CURRENT" ? "Current facility" : "Candidate facility"}</span>
              <span className="mt-1 block text-xs text-mutedForeground">{facility.facilityId} - {facility.locationLabel}</span>
            </span>
          </label>
        ))}
      </div>
      {needsCadToUsdRate ? (
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-foreground">CAD to USD conversion rate</span>
          <input
            name="cadToUsdRate"
            value={cadToUsdRate}
            onChange={(event) => setCadToUsdRate(event.target.value)}
            placeholder="0.73"
            inputMode="decimal"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <span className="block text-xs text-mutedForeground">Enter the number of U.S. dollars equal to 1 Canadian dollar. Mixed USD/CAD warehouse costs are reported in USD.</span>
        </label>
      ) : null}
      <RunButton />
      {state.message ? <p className={state.ok ? "text-sm font-medium text-success" : "text-sm font-medium text-danger"}>{state.message}</p> : null}
    </form>
  );
}

function RunButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
      {pending ? "Running..." : "Run Warehouse Cost Comparison"}
    </button>
  );
}
