"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { runSupplyChainDesignWarehouseLocationStrategyAction } from "@/modules/supply-chain-design/actions";
import type { SupplyChainDesignWarehouseLocationStrategyReadiness } from "@/modules/supply-chain-design/types";

const initialState = { ok: false, message: "" };

export function SupplyChainDesignWarehouseLocationStrategyForm({
  projectId,
  inputSelection,
  initialSettings
}: {
  projectId: string;
  inputSelection: NonNullable<SupplyChainDesignWarehouseLocationStrategyReadiness["inputSelection"]>;
  initialSettings?: {
    shipmentsMappingId?: string;
    maxRegions?: 1 | 2 | 3;
    weightingMethod?: string;
    countryScope?: string;
    cadToUsdRate?: number | null;
  } | null;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(runSupplyChainDesignWarehouseLocationStrategyAction, initialState);
  const [shipmentsMappingId, setShipmentsMappingId] = useState(initialSettings?.shipmentsMappingId ?? inputSelection.shipments.mappingId);
  const [maxRegions, setMaxRegions] = useState(String(initialSettings?.maxRegions ?? 2));
  const [weightingMethod, setWeightingMethod] = useState(initialSettings?.weightingMethod ?? "SHIPMENTS_REPRESENTED");
  const [countryScope, setCountryScope] = useState(initialSettings?.countryScope ?? "ALL");
  const [cadToUsdRate, setCadToUsdRate] = useState(initialSettings?.cadToUsdRate === null || initialSettings?.cadToUsdRate === undefined ? "" : String(initialSettings.cadToUsdRate));

  useEffect(() => {
    setShipmentsMappingId(initialSettings?.shipmentsMappingId ?? inputSelection.shipments.mappingId);
    setMaxRegions(String(initialSettings?.maxRegions ?? 2));
    setWeightingMethod(initialSettings?.weightingMethod ?? "SHIPMENTS_REPRESENTED");
    setCountryScope(initialSettings?.countryScope ?? "ALL");
    setCadToUsdRate(initialSettings?.cadToUsdRate === null || initialSettings?.cadToUsdRate === undefined ? "" : String(initialSettings.cadToUsdRate));
  }, [initialSettings?.shipmentsMappingId, initialSettings?.maxRegions, initialSettings?.weightingMethod, initialSettings?.countryScope, initialSettings?.cadToUsdRate, inputSelection.shipments.mappingId]);

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [router, state.ok]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <p className="text-xs text-mutedForeground">Location Strategy includes all valid delivery activity because every shipment contributes to warehouse demand.</p>
      {inputSelection.shipments.candidateFiles.length === 1 ? (
        <div className="space-y-1">
          <span className="block text-sm font-semibold text-foreground">Historical Shipments</span>
          <input type="hidden" name="shipmentsMappingId" value={shipmentsMappingId} />
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">{inputSelection.shipments.fileName}</p>
        </div>
      ) : (
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-foreground">Historical Shipments</span>
          <select name="shipmentsMappingId" value={shipmentsMappingId} onChange={(event) => setShipmentsMappingId(event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
            {inputSelection.shipments.candidateFiles.map((option) => (
              <option key={option.mappingId} value={option.mappingId}>{option.fileName}</option>
            ))}
          </select>
        </label>
      )}
      <label className="block space-y-1">
        <span className="text-sm font-semibold text-foreground">Maximum regions to evaluate</span>
        <select name="maxRegions" value={maxRegions} onChange={(event) => setMaxRegions(event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
        </select>
        <span className="block text-xs text-mutedForeground">Calculate and compare up to this many warehouse search regions.</span>
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-semibold text-foreground">Weight demand by</span>
        <select name="weightingMethod" value={weightingMethod} onChange={(event) => setWeightingMethod(event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
          <option value="SHIPMENTS_REPRESENTED">Shipments represented</option>
          <option value="PALLETS">Pallets</option>
          <option value="WEIGHT">Weight</option>
          <option value="UNITS">Units</option>
          <option value="CURRENT_TRANSPORTATION_COST">Historical transportation spend</option>
        </select>
        <span className="block text-xs text-mutedForeground">Historical transportation spend gives greater influence to destinations responsible for more historical transportation spending. This does not estimate transportation costs from the recommended regions.</span>
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-semibold text-foreground">Warehouse network country option</span>
        <select name="countryScope" value={countryScope} onChange={(event) => setCountryScope(event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
          <option value="ALL">Combined U.S. and Canada network</option>
          <option value="SEPARATE_BY_COUNTRY">Separate U.S. and Canada strategies</option>
          <option value="CA">Canada-only warehouse markets</option>
          <option value="US">U.S.-only warehouse markets</option>
        </select>
        <span className="block text-xs text-mutedForeground">Controls where warehouse markets may be recommended. Together uses one cross-border network. Separate creates independent U.S. and Canadian networks. U.S.-only and Canada-only still use all uploaded delivery demand but restrict warehouse recommendations to the selected country.</span>
      </label>
      {weightingMethod === "CURRENT_TRANSPORTATION_COST" ? (
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
          <span className="block text-xs text-mutedForeground">Enter the number of U.S. dollars equal to 1 Canadian dollar. All historical transportation spend will be analyzed in USD.</span>
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
      {pending ? "Running..." : "Run Location Strategy"}
    </button>
  );
}
