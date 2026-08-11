"use client";

import { useActionState, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { runSupplyChainDesignNetworkScenarioComparisonAction } from "@/modules/supply-chain-design/actions";
import type { SupplyChainDesignModelRunState } from "@/modules/supply-chain-design/actions";
import type {
  NetworkScenarioComparisonRunListItem,
  NetworkScenarioComparisonScenarioInput
} from "@/modules/supply-chain-design/network-scenario-comparison-persistence";
import type { SupplyChainDesignNetworkScenarioComparisonReadiness } from "@/modules/supply-chain-design/types";

const initialState: SupplyChainDesignModelRunState = { ok: false, message: "" };

export function SupplyChainDesignNetworkScenarioComparisonForm({
  projectId,
  inputSelection,
  displayedRun
}: {
  projectId: string;
  inputSelection: NonNullable<SupplyChainDesignNetworkScenarioComparisonReadiness["inputSelection"]>;
  displayedRun?: NetworkScenarioComparisonRunListItem | null;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(runSupplyChainDesignNetworkScenarioComparisonAction, initialState);
  const submitted = state.submittedNetworkScenarioComparison;
  const persistedScenarios = getPersistedScenarios(displayedRun);
  const latestScenarioA = persistedScenarios.scenarioA;
  const latestScenarioB = persistedScenarios.scenarioB;
  const [facilitiesMappingId, setFacilitiesMappingId] = useState(submitted?.facilitiesMappingId ?? displayedRun?.inputReferences?.currentFacilities.mappingId ?? inputSelection.facilities.mappingId);
  const [shipmentsMappingId, setShipmentsMappingId] = useState(submitted?.shipmentsMappingId ?? displayedRun?.scenarioInputs?.historicalShipments.mappingId ?? inputSelection.shipments.mappingId);
  const [candidateFacilitiesMappingId, setCandidateFacilitiesMappingId] = useState(submitted?.candidateFacilitiesMappingId ?? displayedRun?.inputReferences?.candidateFacilities.mappingId ?? inputSelection.candidateFacilities.mappingId);
  const currentFacilityOptions = useMemo(
    () => inputSelection.currentFacilityOptionsByMappingId.find((item) => item.mappingId === facilitiesMappingId)?.options ?? [],
    [facilitiesMappingId, inputSelection.currentFacilityOptionsByMappingId]
  );
  const candidateFacilityOptions = useMemo(
    () => inputSelection.candidateFacilityOptionsByMappingId.find((item) => item.mappingId === candidateFacilitiesMappingId)?.options ?? [],
    [candidateFacilitiesMappingId, inputSelection.candidateFacilityOptionsByMappingId]
  );
  const facilityOptions = useMemo(() => [...currentFacilityOptions, ...candidateFacilityOptions], [currentFacilityOptions, candidateFacilityOptions]);
  const defaultA = latestScenarioA?.selectedFacilities.map((facility) => `${facility.sourceType}:${facility.facilityId}`) ?? [];
  const defaultB = latestScenarioB?.selectedFacilities.map((facility) => `${facility.sourceType}:${facility.facilityId}`) ?? [];
  const [scenarioAName, setScenarioAName] = useState(submitted?.scenarioAName ?? latestScenarioA?.scenarioName ?? "Scenario A");
  const [scenarioBName, setScenarioBName] = useState(submitted?.scenarioBName ?? latestScenarioB?.scenarioName ?? "Scenario B");
  const [scenarioAIds, setScenarioAIds] = useState(submitted?.scenarioAFacilityOptionIds.length ? submitted.scenarioAFacilityOptionIds : defaultA.length ? defaultA : [facilityOptions[0]?.optionId].filter(Boolean));
  const [scenarioBIds, setScenarioBIds] = useState(submitted?.scenarioBFacilityOptionIds.length ? submitted.scenarioBFacilityOptionIds : defaultB.length ? defaultB : [facilityOptions[0]?.optionId].filter(Boolean));
  const [cadToUsdRate, setCadToUsdRate] = useState(submitted?.cadToUsdRate ?? (displayedRun?.fxInput?.cadToUsdRate ? String(displayedRun.fxInput.cadToUsdRate) : ""));
  const recalculateMode = displayedRun?.status === "COMPLETE";
  const allSelectedCurrencies = useMemo(() => {
    const selected = new Set([...scenarioAIds, ...scenarioBIds]);
    return Array.from(new Set(facilityOptions.filter((facility) => selected.has(facility.optionId) && facility.currency).map((facility) => facility.currency))).sort();
  }, [facilityOptions, scenarioAIds, scenarioBIds]);
  const needsCadToUsdRate =
    displayedRun?.resultSummary?.warnings.some((warning) => warning.includes("CAD to USD rate is required")) ||
    (allSelectedCurrencies.includes("CAD") && allSelectedCurrencies.includes("USD"));

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [router, state.ok]);

  useEffect(() => {
    if (!submitted) return;
    setFacilitiesMappingId(submitted.facilitiesMappingId ?? inputSelection.facilities.mappingId);
    setShipmentsMappingId(submitted.shipmentsMappingId ?? inputSelection.shipments.mappingId);
    setCandidateFacilitiesMappingId(submitted.candidateFacilitiesMappingId ?? inputSelection.candidateFacilities.mappingId);
    setScenarioAName(submitted.scenarioAName);
    setScenarioBName(submitted.scenarioBName);
    setScenarioAIds(submitted.scenarioAFacilityOptionIds);
    setScenarioBIds(submitted.scenarioBFacilityOptionIds);
    setCadToUsdRate(submitted.cadToUsdRate ?? "");
  }, [inputSelection.candidateFacilities.mappingId, inputSelection.facilities.mappingId, inputSelection.shipments.mappingId, submitted]);

  useEffect(() => {
    const available = new Set(facilityOptions.map((facility) => facility.optionId));
    setScenarioAIds((current) => current.filter((id) => available.has(id)));
    setScenarioBIds((current) => current.filter((id) => available.has(id)));
  }, [facilityOptions]);

  function toggle(setter: Dispatch<SetStateAction<string[]>>, current: string[], optionId: string) {
    setter(current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId]);
  }

  const clientError =
    scenarioAIds.length === 0
      ? "Select at least one warehouse for Scenario A."
      : scenarioBIds.length === 0
        ? "Select at least one warehouse for Scenario B."
        : needsCadToUsdRate && cadToUsdRate && (!Number.isFinite(Number(cadToUsdRate)) || Number(cadToUsdRate) <= 0)
          ? "CAD to USD conversion rate must be greater than 0."
          : null;

  return (
    <form action={formAction} className="space-y-4 rounded-md border border-border bg-background p-3">
      <input type="hidden" name="projectId" value={projectId} />
      {recalculateMode ? <input type="hidden" name="forceNewRun" value="on" /> : null}
      <section className="space-y-2">
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-foreground">Current Facilities and Warehouse Costs</span>
          <select
            name="facilitiesMappingId"
            value={facilitiesMappingId}
            onChange={(event) => setFacilitiesMappingId(event.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {inputSelection.facilities.candidateFiles.map((file) => (
              <option key={file.mappingId} value={file.mappingId}>
                {file.fileName} - mapped
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-foreground">Historical Shipments</span>
          <select
            name="shipmentsMappingId"
            value={shipmentsMappingId}
            onChange={(event) => setShipmentsMappingId(event.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {inputSelection.shipments.candidateFiles.map((file) => (
              <option key={file.mappingId} value={file.mappingId}>
                {file.fileName} - mapped
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-foreground">Candidate Warehouses and Proposed Costs</span>
          <select
            name="candidateFacilitiesMappingId"
            value={candidateFacilitiesMappingId}
            onChange={(event) => setCandidateFacilitiesMappingId(event.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {inputSelection.candidateFacilities.candidateFiles.map((file) => (
              <option key={file.mappingId} value={file.mappingId}>
                {file.fileName} - mapped
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-mutedForeground">Both scenarios use these one shared source selections.</p>
      </section>

      <ScenarioSection
        label="Scenario A"
        nameField="scenarioAName"
        selectedField="scenarioAFacilityOptionIds"
        scenarioName={scenarioAName}
        setScenarioName={setScenarioAName}
        selectedIds={scenarioAIds}
        toggleFacility={(optionId) => toggle(setScenarioAIds, scenarioAIds, optionId)}
        facilities={facilityOptions}
      />
      <ScenarioSection
        label="Scenario B"
        nameField="scenarioBName"
        selectedField="scenarioBFacilityOptionIds"
        scenarioName={scenarioBName}
        setScenarioName={setScenarioBName}
        selectedIds={scenarioBIds}
        toggleFacility={(optionId) => toggle(setScenarioBIds, scenarioBIds, optionId)}
        facilities={facilityOptions}
      />

      {needsCadToUsdRate ? (
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-foreground">Currency Conversion</span>
          <input
            name="cadToUsdRate"
            value={cadToUsdRate}
            onChange={(event) => setCadToUsdRate(event.target.value)}
            placeholder="1 CAD = rate USD"
            inputMode="decimal"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <span className="block text-xs text-mutedForeground">Enter the number of U.S. dollars equal to 1 Canadian dollar. This is used for comparison cost normalization, not for 7L rating.</span>
        </label>
      ) : null}

      {persistedScenarios.readError ? <p className="text-sm font-medium text-danger">Saved comparison input could not be read: {persistedScenarios.readError}</p> : null}
      {clientError ? <p className="text-sm font-medium text-danger">{clientError}</p> : null}
      <RunButton disabled={Boolean(clientError)} recalculate={recalculateMode} />
      {state.message ? <p className={state.ok ? "text-sm font-medium text-success" : "text-sm font-medium text-danger"}>{state.message}</p> : null}
    </form>
  );
}

function getPersistedScenarios(run?: NetworkScenarioComparisonRunListItem | null): {
  scenarioA: NetworkScenarioComparisonScenarioInput | null;
  scenarioB: NetworkScenarioComparisonScenarioInput | null;
  readError: string | null;
} {
  const scenarios = run?.scenarioInputs?.scenarios;
  if (!run) return { scenarioA: null, scenarioB: null, readError: null };
  if (!Array.isArray(scenarios)) {
    return {
      scenarioA: null,
      scenarioB: null,
      readError: run.resultReadError ?? "Saved Network Scenario Comparison scenario inputs are unavailable."
    };
  }
  return {
    scenarioA: scenarios.find((scenario) => scenario.scenarioKey === "A") ?? null,
    scenarioB: scenarios.find((scenario) => scenario.scenarioKey === "B") ?? null,
    readError: run.resultReadError
  };
}

function ScenarioSection({
  label,
  nameField,
  selectedField,
  scenarioName,
  setScenarioName,
  selectedIds,
  toggleFacility,
  facilities
}: {
  label: string;
  nameField: string;
  selectedField: string;
  scenarioName: string;
  setScenarioName: (value: string) => void;
  selectedIds: string[];
  toggleFacility: (optionId: string) => void;
  facilities: NonNullable<SupplyChainDesignNetworkScenarioComparisonReadiness["inputSelection"]>["facilityOptions"];
}) {
  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-3">
      <label className="block space-y-1">
        <span className="text-sm font-semibold text-foreground">{label} Name</span>
        <input
          name={nameField}
          value={scenarioName}
          onChange={(event) => setScenarioName(event.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </label>
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">{label} Warehouses</p>
        {facilities.map((facility) => (
          <label key={`${label}-${facility.optionId}`} className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2">
            <input
              type="checkbox"
              name={selectedField}
              value={facility.optionId}
              checked={selectedIds.includes(facility.optionId)}
              onChange={() => toggleFacility(facility.optionId)}
              className="mt-1 h-4 w-4 rounded border-border"
            />
            <span className="text-sm text-foreground">
              <span className="font-semibold">{facility.facilityName}</span>
              <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold uppercase text-mutedForeground">{facility.facilityType === "CURRENT" ? "Current" : "Candidate"}</span>
              <span className="mt-1 block text-xs text-mutedForeground">
                {facility.facilityId} - {facility.locationLabel} - {facility.comparableAnnualWarehouseCostSource ? facility.comparableAnnualWarehouseCostSource.replaceAll("_", " ") : "warehouse cost incomplete"}
              </span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

function RunButton({ disabled, recalculate }: { disabled: boolean; recalculate: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
      {pending ? "Running..." : recalculate ? "Recalculate" : "Run Network Scenario Comparison"}
    </button>
  );
}
