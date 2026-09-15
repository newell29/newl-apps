"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { saveSupplyChainDesignFileMappingAction } from "@/modules/supply-chain-design/actions";
import {
  SUPPLY_CHAIN_DESIGN_MAPPING_DEFINITIONS,
  SUPPLY_CHAIN_DESIGN_NORMAL_TABLE_TYPES,
  SUPPLY_CHAIN_DESIGN_TABLE_TYPES,
  getSupplyChainDesignFieldLabel,
  getSupplyChainDesignFieldHelp,
  getSupplyChainDesignTableLabel,
  isSupplyChainDesignHiddenNormalMappingField,
  isSupplyChainDesignInternalTableType,
  type SupplyChainDesignTableTypeValue
} from "@/modules/supply-chain-design/mapping-definitions";
import type { SupplyChainDesignFileMappingDetail } from "@/modules/supply-chain-design/types";

const initialState = {
  ok: false,
  message: ""
};

type Props = {
  projectId: string;
  fileId: string;
  detectedHeaders: string[];
  mapping: SupplyChainDesignFileMappingDetail | null;
};

export function SupplyChainDesignFileMappingForm({ projectId, fileId, detectedHeaders, mapping }: Props) {
  const [state, formAction] = useActionState(saveSupplyChainDesignFileMappingAction, initialState);
  const initialTableType = isTableType(mapping?.tableType) ? mapping.tableType : "FACILITIES";
  const [selectedTableType, setSelectedTableType] = useState<SupplyChainDesignTableTypeValue>(initialTableType);
  const savedColumns = new Map(mapping?.fieldMappings.map((field) => [field.standardField, field.sourceColumn]) ?? []);
  const fields = SUPPLY_CHAIN_DESIGN_MAPPING_DEFINITIONS[selectedTableType];
  const normalFields = fields.filter((field) => !isSupplyChainDesignHiddenNormalMappingField(field.field));
  const visibleTableTypes = isSupplyChainDesignInternalTableType(initialTableType)
    ? [initialTableType, ...SUPPLY_CHAIN_DESIGN_NORMAL_TABLE_TYPES.filter((tableType) => tableType !== initialTableType)]
    : SUPPLY_CHAIN_DESIGN_NORMAL_TABLE_TYPES;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="fileId" value={fileId} />

      <div>
        <label className="block text-sm font-semibold text-foreground" htmlFor="tableType">
          Table type
        </label>
        <select
          id="tableType"
          name="tableType"
          value={selectedTableType}
          onChange={(event) => setSelectedTableType(event.target.value as SupplyChainDesignTableTypeValue)}
          className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          {visibleTableTypes.map((tableType) => (
            <option key={tableType} value={tableType}>
              {getSupplyChainDesignTableLabel(tableType)}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-mutedForeground">
          Internal benchmark and expected-result tables are hidden from normal project mapping.
        </p>
      </div>

      <fieldset key={selectedTableType} className="space-y-3 rounded-md border border-border bg-background p-4">
        <legend className="px-1 text-sm font-semibold text-foreground">{getSupplyChainDesignTableLabel(selectedTableType)}</legend>
        <div className="grid gap-3 lg:grid-cols-2">
          {normalFields.map((field) => (
            <MappingField
              key={field.field}
              field={field}
              detectedHeaders={detectedHeaders}
              defaultValue={initialTableType === selectedTableType ? savedColumns.get(field.field) ?? "" : ""}
            />
          ))}
        </div>
      </fieldset>

      <SaveButton />
      {state.message ? (
        <p className={state.ok ? "text-sm font-medium text-success" : "text-sm font-medium text-danger"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function MappingField({
  field,
  detectedHeaders,
  defaultValue
}: {
  field: { field: string; requirement: "REQUIRED" | "OPTIONAL" };
  detectedHeaders: string[];
  defaultValue: string;
}) {
  const help = getSupplyChainDesignFieldHelp(field.field);
  return (
    <label className="block">
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        {getSupplyChainDesignFieldLabel(field.field)}
        <span className="text-xs uppercase tracking-wide text-mutedForeground">{field.requirement}</span>
      </span>
      <span className="mt-1 block text-xs text-mutedForeground">
        {help.description}
        {help.unit ? ` Unit: ${help.unit}.` : ""}
        {help.example ? ` Example: ${help.example}.` : ""}
      </span>
      <select
        name={`field:${field.field}`}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
      >
        <option value="">Not mapped</option>
        {detectedHeaders.map((header, index) => (
          <option key={`${header}-${index}`} value={header}>
            {header || `Column ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving..." : "Save mapping"}
    </button>
  );
}

function isTableType(value: string | null | undefined): value is SupplyChainDesignTableTypeValue {
  return SUPPLY_CHAIN_DESIGN_TABLE_TYPES.includes(value as SupplyChainDesignTableTypeValue);
}
