"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { generateSupplyChainDesignCandidateLtlRatePreparationAction } from "@/modules/supply-chain-design/actions";
import type { SupplyChainDesignLtlRatePreparationInputSelection } from "@/modules/supply-chain-design/types";

const initialState = {
  ok: false,
  message: "",
  runId: null
};

export function SupplyChainDesignCandidateLtlRatePreparationForm({
  projectId,
  inputSelection
}: {
  projectId: string;
  inputSelection: SupplyChainDesignLtlRatePreparationInputSelection;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(generateSupplyChainDesignCandidateLtlRatePreparationAction, initialState);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
    }
  }, [router, state.ok, state.runId]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <MappingSelect
        label="Historical Shipments"
        name="shipmentsMappingId"
        options={inputSelection.shipments.candidateFiles}
        defaultValue={inputSelection.shipments.mappingId}
      />
      <MappingSelect
        label="Candidate Warehouses and Proposed Costs"
        name="candidateFacilitiesMappingId"
        options={inputSelection.candidateFacilities.candidateFiles}
        defaultValue={inputSelection.candidateFacilities.mappingId}
      />
      <p className="rounded-md border border-border bg-background p-3 text-xs text-mutedForeground">
        This step reviews and prepares the shipment data before rates are requested from 7L.
      </p>
      <SubmitButton />
      {state.message ? (
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
            {option.fileName} - saved {formatMappingDate(option.mappingUpdatedAt)}
          </option>
        ))}
      </select>
    </label>
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
    timeZone: "America/Toronto"
  }).format(date);
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Preparing..." : "Prepare LTL Shipments"}
    </button>
  );
}
