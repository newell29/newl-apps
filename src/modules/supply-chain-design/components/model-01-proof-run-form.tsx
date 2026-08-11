"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { runSupplyChainDesignModel01ProofAction } from "@/modules/supply-chain-design/actions";
import type { SupplyChainDesignModel01ProofInputSelection } from "@/modules/supply-chain-design/types";

const initialState = {
  ok: false,
  message: ""
};

export function SupplyChainDesignModel01ProofRunForm({
  projectId,
  inputSelection
}: {
  projectId: string;
  inputSelection: SupplyChainDesignModel01ProofInputSelection;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(runSupplyChainDesignModel01ProofAction, initialState);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
    }
  }, [router, state.ok]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <MappingSelect
        label="Historical Shipments"
        name="shipmentsMappingId"
        options={inputSelection.shipments?.candidateFiles ?? []}
        defaultValue={inputSelection.shipments?.mappingId ?? ""}
        emptyLabel="Select Historical Shipments"
      />
      <MappingSelect
        label="Current Facilities and Warehouse Costs"
        name="facilitiesMappingId"
        options={inputSelection.facilities?.candidateFiles ?? []}
        defaultValue={inputSelection.facilities?.mappingId ?? ""}
        emptyLabel="Select Current Facilities and Warehouse Costs"
      />
      <RunButton />
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
  defaultValue,
  optional = false,
  emptyLabel = "No file"
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
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
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

function RunButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Running..." : "Run Current Network Baseline"}
    </button>
  );
}
