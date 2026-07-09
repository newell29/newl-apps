"use client";

import { useMemo, useState } from "react";
import type { InvoiceAutomationType } from "@prisma/client";
import type { InvoiceAutomationEntityOption } from "@/modules/invoice-automation/types";

const MAX_VISIBLE_OPTIONS = 75;

export function QuickBooksEntitySearchSelect({
  invoiceType,
  options,
  value,
  onChange
}: {
  invoiceType: InvoiceAutomationType;
  options: InvoiceAutomationEntityOption[];
  value: string;
  onChange: (option: InvoiceAutomationEntityOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const selectedOption = options.find((option) => option.id === value) ?? null;
  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeEntitySearch(query);
    const matches = normalizedQuery
      ? options.filter((option) => normalizeEntitySearch(`${option.displayName} ${option.currency ?? ""} ${option.normalizedName ?? ""}`).includes(normalizedQuery))
      : options;

    const limited = matches.slice(0, MAX_VISIBLE_OPTIONS);
    if (selectedOption && !limited.some((option) => option.id === selectedOption.id)) {
      return [selectedOption, ...limited];
    }

    return limited;
  }, [options, query, selectedOption]);
  const placeholder = invoiceType === "CUSTOMER" ? "Search customers" : "Search vendors";
  const emptyLabel = invoiceType === "CUSTOMER" ? "Match customer" : "Match vendor";

  return (
    <div className="grid w-56 gap-1">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
      />
      <select
        value={value}
        onChange={(event) => {
          const option = options.find((entity) => entity.id === event.target.value);
          onChange(option ?? null);
        }}
        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
      >
        <option value="">{emptyLabel}</option>
        {filteredOptions.map((entity) => (
          <option key={`${entity.entityType}-${entity.id}`} value={entity.id}>
            {entity.displayName}{entity.currency ? ` (${entity.currency})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function normalizeEntitySearch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
