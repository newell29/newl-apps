"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { runSupplyChainDesignModel02ProofAction } from "@/modules/supply-chain-design/actions";
import type { SupplyChainDesignModel02ProofInputSelection } from "@/modules/supply-chain-design/types";

const initialState = {
  ok: false,
  message: ""
};

export function SupplyChainDesignModel02ProofRunForm({
  projectId,
  inputSelection
}: {
  projectId: string;
  inputSelection: SupplyChainDesignModel02ProofInputSelection;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(runSupplyChainDesignModel02ProofAction, initialState);
  const [facilitiesMappingId, setFacilitiesMappingId] = useState(inputSelection.facilities.mappingId);
  const [candidateFacilitiesMappingId, setCandidateFacilitiesMappingId] = useState(
    inputSelection.candidateFacilities.mappingId
  );
  const existingFacilityOptions =
    inputSelection.existingFacilityOptionsByMappingId.find((item) => item.mappingId === facilitiesMappingId)?.options ??
    inputSelection.existingFacilityOptions;
  const candidateFacilityOptions =
    inputSelection.candidateFacilityOptionsByMappingId.find((item) => item.mappingId === candidateFacilitiesMappingId)
      ?.options ?? inputSelection.candidateFacilityOptions;
  const [selectedExisting, setSelectedExisting] = useState(
    () => new Set(existingFacilityOptions.map((facility) => facility.facilityId))
  );
  const [selectedCandidates, setSelectedCandidates] = useState(() => new Set<string>());
  const closedExisting = useMemo(
    () => existingFacilityOptions.filter((facility) => !selectedExisting.has(facility.facilityId)),
    [existingFacilityOptions, selectedExisting]
  );
  const openExisting = useMemo(
    () => existingFacilityOptions.filter((facility) => selectedExisting.has(facility.facilityId)),
    [existingFacilityOptions, selectedExisting]
  );
  const openCandidates = useMemo(
    () => candidateFacilityOptions.filter((facility) => selectedCandidates.has(facility.facilityId)),
    [candidateFacilityOptions, selectedCandidates]
  );
  const unopenedCandidates = useMemo(
    () => candidateFacilityOptions.filter((facility) => !selectedCandidates.has(facility.facilityId)),
    [candidateFacilityOptions, selectedCandidates]
  );
  const selectedOpenFacilitiesHaveCapacity = [...openExisting, ...openCandidates].some(
    (facility) => typeof facility.capacity === "number"
  );
  const [enforceCapacity, setEnforceCapacity] = useState(selectedOpenFacilitiesHaveCapacity);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
    }
  }, [router, state.ok]);

  useEffect(() => {
    setSelectedExisting(new Set(existingFacilityOptions.map((facility) => facility.facilityId)));
  }, [existingFacilityOptions]);

  useEffect(() => {
    setSelectedCandidates(new Set());
  }, [candidateFacilityOptions]);

  useEffect(() => {
    setEnforceCapacity(selectedOpenFacilitiesHaveCapacity);
  }, [selectedOpenFacilitiesHaveCapacity]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="baselineRunId" value={inputSelection.baselineRunId} />
      <label className="block space-y-1">
        <span className="text-sm font-semibold text-foreground">Scenario name</span>
        <input
          name="scenarioName"
          required
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          placeholder="Candidate network proof"
        />
      </label>
      <MappingSelect
        label="FACILITIES mapping"
        name="facilitiesMappingId"
        options={inputSelection.facilities.candidateFiles}
        defaultValue={facilitiesMappingId}
        onChange={setFacilitiesMappingId}
      />
      <MappingSelect label="CUSTOMERS mapping" name="customersMappingId" options={inputSelection.customers.candidateFiles} defaultValue={inputSelection.customers.mappingId} />
      <MappingSelect label="SHIPMENTS mapping" name="shipmentsMappingId" options={inputSelection.shipments.candidateFiles} defaultValue={inputSelection.shipments.mappingId} />
      <MappingSelect
        label="CANDIDATE_FACILITIES mapping"
        name="candidateFacilitiesMappingId"
        options={inputSelection.candidateFacilities.candidateFiles}
        defaultValue={candidateFacilitiesMappingId}
        onChange={setCandidateFacilitiesMappingId}
      />
      <MappingSelect
        label="SCENARIO_LANE_COSTS mapping"
        name="scenarioLaneCostsMappingId"
        options={inputSelection.scenarioLaneCosts?.candidateFiles ?? []}
        defaultValue={inputSelection.scenarioLaneCosts?.mappingId ?? ""}
        optional
        emptyLabel="No scenario lane-cost file"
      />
      <MappingSelect
        label="FACILITY_COSTS mapping"
        name="facilityCostsMappingId"
        options={inputSelection.facilityCosts?.candidateFiles ?? []}
        defaultValue={inputSelection.facilityCosts?.mappingId ?? ""}
        optional
        emptyLabel="No retained operating-cost file"
      />
      <div className="rounded-md border border-border bg-background p-3">
        <p className="text-sm font-semibold text-foreground">Existing facilities</p>
        <p className="mt-1 text-xs text-mutedForeground">Checked facilities stay open. Unchecked facilities are closed in this scenario.</p>
        <div className="mt-2 space-y-2">
          {existingFacilityOptions.map((facility) => (
            <label key={facility.facilityId} className="flex items-start gap-2 text-sm text-mutedForeground">
              <input
                type="checkbox"
                name="selectedExistingFacilityIds"
                value={facility.facilityId}
                checked={selectedExisting.has(facility.facilityId)}
                onChange={(event) =>
                  setSelectedExisting((current) => toggleSetValue(current, facility.facilityId, event.target.checked))
                }
                className="mt-1"
              />
              <span>
                <span className="font-medium text-foreground">{facility.facilityId}</span> - {facility.facilityName}
                {typeof facility.capacity === "number"
                  ? `, capacity ${formatNumber(facility.capacity)} annual shipments`
                  : ", unlimited capacity"}
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="rounded-md border border-border bg-background p-3">
        <p className="text-sm font-semibold text-foreground">Candidate facilities</p>
        <p className="mt-1 text-xs text-mutedForeground">Checked candidates open in the proposed network.</p>
        <div className="mt-2 space-y-2">
          {candidateFacilityOptions.map((facility) => (
            <label key={facility.facilityId} className="flex items-start gap-2 text-sm text-mutedForeground">
              <input
                type="checkbox"
                name="selectedCandidateFacilityIds"
                value={facility.facilityId}
                checked={selectedCandidates.has(facility.facilityId)}
                onChange={(event) =>
                  setSelectedCandidates((current) => toggleSetValue(current, facility.facilityId, event.target.checked))
                }
                className="mt-1"
              />
              <span>
                <span className="font-medium text-foreground">{facility.facilityId}</span> - {facility.facilityName} fixed cost{" "}
                {formatNumber(facility.annualFixedCost)}
                {typeof facility.capacity === "number"
                  ? `, capacity ${formatNumber(facility.capacity)} annual shipments`
                  : ", unlimited capacity"}
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm md:grid-cols-2">
        <ScenarioList title="Existing kept open" rows={openExisting.map((facility) => `${facility.facilityId} - ${facility.facilityName}`)} emptyText="No existing facilities kept open." />
        <ScenarioList title="Existing closing" rows={closedExisting.map((facility) => `${facility.facilityId} - ${facility.facilityName}`)} emptyText="No existing facilities closing." />
        <ScenarioList title="Candidates opening" rows={openCandidates.map((facility) => `${facility.facilityId} - ${facility.facilityName}`)} emptyText="No candidate facilities opening." />
        <ScenarioList title="Candidates not selected" rows={unopenedCandidates.map((facility) => `${facility.facilityId} - ${facility.facilityName}`)} emptyText="All candidates selected." />
      </div>
      <label className="flex items-start gap-2 rounded-md border border-border bg-background p-3 text-sm text-mutedForeground">
        <input
          type="checkbox"
          name="enforceCapacity"
          checked={enforceCapacity}
          onChange={(event) => setEnforceCapacity(event.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="font-semibold text-foreground">Enforce facility capacity</span>
          <span className="block text-xs">
            Capacity is treated as maximum annual shipment count. Blank capacity is unlimited for this proof.
          </span>
        </span>
      </label>
      <RunButton />
      {state.message ? (
        <p className={state.ok ? "text-sm font-medium text-success" : "text-sm font-medium text-danger"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function toggleSetValue(current: Set<string>, value: string, checked: boolean) {
  const next = new Set(current);
  if (checked) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return next;
}

function ScenarioList({ title, rows, emptyText }: { title: string; rows: string[]; emptyText: string }) {
  return (
    <div>
      <p className="font-semibold text-foreground">{title}</p>
      {rows.length > 0 ? (
        <ul className="mt-1 space-y-1 text-mutedForeground">
          {rows.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-mutedForeground">{emptyText}</p>
      )}
    </div>
  );
}

function MappingSelect({
  label,
  name,
  options,
  defaultValue,
  optional = false,
  emptyLabel = "No file",
  onChange
}: {
  label: string;
  name: string;
  options: Array<{
    mappingId: string;
    fileName: string;
    mappingUpdatedAt: string;
  }>;
  defaultValue: string;
  optional?: boolean;
  emptyLabel?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        onChange={(event) => onChange?.(event.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      >
        {optional ? <option value="">{emptyLabel}</option> : null}
        {options.map((option) => (
          <option key={option.mappingId} value={option.mappingId}>
            {option.fileName} - saved {formatMappingDate(option.mappingUpdatedAt)}
          </option>
        ))}
      </select>
    </label>
  );
}

function RunButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Running..." : "Run Model 02 proof"}
    </button>
  );
}

function formatMappingDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown date";
  }
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(date);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 2
  }).format(value);
}
