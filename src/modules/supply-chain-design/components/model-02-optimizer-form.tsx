"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { runSupplyChainDesignModel02OptimizerAction } from "@/modules/supply-chain-design/actions";
import type { SupplyChainDesignModel02ProofInputSelection } from "@/modules/supply-chain-design/types";

const initialState = {
  ok: false,
  message: ""
};

export function SupplyChainDesignModel02OptimizerForm({
  projectId,
  inputSelection
}: {
  projectId: string;
  inputSelection: SupplyChainDesignModel02ProofInputSelection;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(runSupplyChainDesignModel02OptimizerAction, initialState);
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
  const [mandatoryExisting, setMandatoryExisting] = useState(() => new Set<string>());
  const [permittedExisting, setPermittedExisting] = useState(
    () => new Set(existingFacilityOptions.map((facility) => facility.facilityId))
  );
  const [permittedCandidates, setPermittedCandidates] = useState(
    () => new Set(candidateFacilityOptions.map((facility) => facility.facilityId))
  );
  const [prohibitedCandidates, setProhibitedCandidates] = useState(() => new Set<string>());
  const permittedCount = permittedExisting.size + permittedCandidates.size;
  const selectedFacilitiesHaveCapacity = [...existingFacilityOptions, ...candidateFacilityOptions].some(
    (facility) => typeof facility.capacity === "number"
  );
  const [enforceCapacity, setEnforceCapacity] = useState(selectedFacilitiesHaveCapacity);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
    }
  }, [router, state.ok]);

  useEffect(() => {
    setMandatoryExisting(new Set());
    setPermittedExisting(new Set(existingFacilityOptions.map((facility) => facility.facilityId)));
  }, [existingFacilityOptions]);

  useEffect(() => {
    setPermittedCandidates(new Set(candidateFacilityOptions.map((facility) => facility.facilityId)));
    setProhibitedCandidates(new Set());
  }, [candidateFacilityOptions]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="baselineRunId" value={inputSelection.baselineRunId} />
      <label className="block space-y-1">
        <span className="text-sm font-semibold text-foreground">Optimizer scenario name</span>
        <input
          name="optimizerName"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          placeholder="Optimized network"
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
        emptyLabel="Use historical fallback only"
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
        <p className="mt-1 text-xs text-mutedForeground">
          Mandatory facilities must stay open. Permitted facilities may remain open or close.
        </p>
        <div className="mt-2 space-y-2">
          {existingFacilityOptions.map((facility) => (
            <div key={facility.facilityId} className="grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <span className="text-mutedForeground">
                <span className="font-medium text-foreground">{facility.facilityId}</span> - {facility.facilityName}
                {typeof facility.capacity === "number" ? `, capacity ${formatNumber(facility.capacity)}` : ", unlimited capacity"}
              </span>
              <Checkbox
                label="Mandatory open"
                name="mandatoryExistingFacilityIds"
                value={facility.facilityId}
                checked={mandatoryExisting.has(facility.facilityId)}
                onChange={(checked) => setMandatoryExisting((current) => toggleSetValue(current, facility.facilityId, checked))}
              />
              <Checkbox
                label="May close"
                name="permittedExistingFacilityIds"
                value={facility.facilityId}
                checked={permittedExisting.has(facility.facilityId)}
                onChange={(checked) => setPermittedExisting((current) => toggleSetValue(current, facility.facilityId, checked))}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-md border border-border bg-background p-3">
        <p className="text-sm font-semibold text-foreground">Candidate facilities</p>
        <p className="mt-1 text-xs text-mutedForeground">Permitted candidates may open. Prohibited candidates stay closed.</p>
        <div className="mt-2 space-y-2">
          {candidateFacilityOptions.map((facility) => (
            <div key={facility.facilityId} className="grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <span className="text-mutedForeground">
                <span className="font-medium text-foreground">{facility.facilityId}</span> - {facility.facilityName}, fixed cost{" "}
                {formatNumber(facility.annualFixedCost)}
                {typeof facility.capacity === "number" ? `, capacity ${formatNumber(facility.capacity)}` : ", unlimited capacity"}
              </span>
              <Checkbox
                label="May open"
                name="permittedCandidateFacilityIds"
                value={facility.facilityId}
                checked={permittedCandidates.has(facility.facilityId)}
                onChange={(checked) => setPermittedCandidates((current) => toggleSetValue(current, facility.facilityId, checked))}
              />
              <Checkbox
                label="Prohibit"
                name="prohibitedCandidateFacilityIds"
                value={facility.facilityId}
                checked={prohibitedCandidates.has(facility.facilityId)}
                onChange={(checked) => setProhibitedCandidates((current) => toggleSetValue(current, facility.facilityId, checked))}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-foreground">Minimum open facilities</span>
          <input
            type="number"
            name="minimumOpenFacilities"
            min={1}
            defaultValue={1}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-foreground">Maximum open facilities</span>
          <input
            type="number"
            name="maximumOpenFacilities"
            min={1}
            defaultValue={Math.max(1, permittedCount)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
      </div>
      <label className="flex items-start gap-2 rounded-md border border-border bg-background p-3 text-sm text-mutedForeground">
        <input
          type="checkbox"
          name="optimizerEnforceCapacity"
          checked={enforceCapacity}
          onChange={(event) => setEnforceCapacity(event.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="font-semibold text-foreground">Enforce facility capacity</span>
          <span className="block text-xs">Blank capacity is unlimited. Split allocation is allowed when capacity is enforced.</span>
        </span>
      </label>
      <OptimizerButton />
      {state.message ? (
        <p className={state.ok ? "text-sm font-medium text-success" : "text-sm font-medium text-danger"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function Checkbox({
  label,
  name,
  value,
  checked,
  onChange
}: {
  label: string;
  name: string;
  value: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 whitespace-nowrap text-mutedForeground">
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
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

function OptimizerButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Optimizing..." : "Run Model 02 optimizer"}
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
