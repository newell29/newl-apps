"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { runSupplyChainDesignNetworkDesignAction } from "@/modules/supply-chain-design/actions";
import type { SupplyChainDesignLtlRatePreparationInputSelection } from "@/modules/supply-chain-design/types";

const initialState = {
  ok: false,
  message: "",
  runId: null,
  runStatus: null,
  requestTotal: null
};

export function SupplyChainDesignNetworkDesignRunForm({
  projectId,
  inputSelection,
  preparationRunId,
  initialSelectedCandidateFacilityIds
}: {
  projectId: string;
  inputSelection: SupplyChainDesignLtlRatePreparationInputSelection;
  preparationRunId: string | null;
  initialSelectedCandidateFacilityIds?: string[] | null;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(runSupplyChainDesignNetworkDesignAction, initialState);

  useEffect(() => {
    if (state.ok && state.runId) {
      router.replace(`/supply-chain-design/${projectId}?tab=network-design&networkDesignBatchId=${state.runId}`);
      router.refresh();
    }
  }, [projectId, router, state.ok, state.runId]);

  return (
    <form action={formAction} className="space-y-3 rounded-md border border-border bg-background p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="candidateSelectionSubmitted" value="1" />
      {preparationRunId ? <input type="hidden" name="preparationRunId" value={preparationRunId} /> : null}
      <MappingSelect
        label="Historical Shipments"
        name="shipmentsMappingId"
        options={inputSelection.shipments.candidateFiles}
        defaultValue={inputSelection.shipments.mappingId}
      />
      <MappingSelect
        label="Current Facilities and Warehouse Costs"
        name="facilitiesMappingId"
        options={inputSelection.facilities.candidateFiles}
        defaultValue={inputSelection.facilities.mappingId}
      />
      <MappingSelect
        label="Candidate Warehouses and Proposed Costs"
        name="candidateFacilitiesMappingId"
        options={inputSelection.candidateFacilities.candidateFiles}
        defaultValue={inputSelection.candidateFacilities.mappingId}
      />
      <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
        <p className="text-sm font-semibold text-foreground">Candidate warehouses to evaluate</p>
        {inputSelection.candidateFacilityOptions.map((candidate) => (
          <label key={candidate.facilityId} className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2">
            <input
              type="checkbox"
              name="candidateFacilityIds"
              value={candidate.facilityId}
              defaultChecked={initialSelectedCandidateFacilityIds?.length ? initialSelectedCandidateFacilityIds.includes(candidate.facilityId) : true}
              className="mt-1 h-4 w-4 rounded border-border"
            />
            <span className="text-sm text-foreground">
              <span className="font-semibold">{candidate.facilityName}</span>
              <span className="mx-2 text-mutedForeground">-</span>
              <span className="text-xs text-mutedForeground">{candidate.facilityId}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs text-mutedForeground">
        The analysis will rate valid LTL shipments from each selected candidate warehouse.
      </p>
      <SubmitButton />
      {state.message && (!state.ok || !state.runId) ? (
        <p className={state.ok ? "text-sm font-medium text-success" : "text-sm font-medium text-danger"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function MappingSelect({
  label,
  name,
  options,
  defaultValue
}: {
  label: string;
  name: string;
  options: Array<{
    mappingId: string;
    fileName: string;
    mappingUpdatedAt: string;
  }>;
  defaultValue: string;
}) {
  if (options.length === 0) {
    return (
      <div className="block space-y-1">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-mutedForeground">
          No eligible saved mapping is available.
        </p>
      </div>
    );
  }

  if (options.length === 1) {
    const [option] = options;
    return (
      <div className="block space-y-1">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <input type="hidden" name={name} value={option.mappingId} />
        <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm font-medium text-foreground">
          {option.fileName}
        </p>
      </div>
    );
  }

  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      >
        {options.map((option) => (
          <option key={option.mappingId} value={option.mappingId}>
            {option.fileName}
          </option>
        ))}
      </select>
    </label>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Starting..." : "Run Network Design"}
    </button>
  );
}
