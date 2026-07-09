"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { InvoiceAutomationType } from "@prisma/client";
import type { InvoiceAutomationEntityOption } from "@/modules/invoice-automation/types";

const MAX_VISIBLE_OPTIONS = 75;

export function QuickBooksEntitySearchSelect({
  invoiceType,
  hasError = false,
  options,
  value,
  onChange
}: {
  invoiceType: InvoiceAutomationType;
  hasError?: boolean;
  options: InvoiceAutomationEntityOption[];
  value: string;
  onChange: (option: InvoiceAutomationEntityOption | null) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
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
  const emptyLabel = hasError ? "Needs QB profile/match" : invoiceType === "CUSTOMER" ? "Match customer" : "Match vendor";
  const selectedLabel = selectedOption
    ? `${selectedOption.displayName}${selectedOption.currency ? ` (${selectedOption.currency})` : ""}`
    : emptyLabel;
  const closedButtonClassName = [
    "flex w-full items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5 text-left text-sm",
    hasError && !selectedOption
      ? "border-danger/40 text-danger"
      : "border-input text-foreground"
  ].join(" ");

  useEffect(() => {
    if (isOpen) {
      searchInputRef.current?.focus();
    }
  }, [isOpen]);

  return (
    <div
      className="relative w-56"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={closedButtonClassName}
      >
        <span className="truncate">{selectedLabel}</span>
        <span className="text-mutedForeground">v</span>
      </button>
      {isOpen ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-md border border-border bg-background p-2 shadow-lg">
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            className="mb-2 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
          <div className="max-h-64 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setQuery("");
                setIsOpen(false);
              }}
              className="w-full rounded px-2 py-1.5 text-left text-sm text-mutedForeground hover:bg-muted"
            >
              {emptyLabel}
            </button>
            {filteredOptions.map((entity) => (
              <button
                key={`${entity.entityType}-${entity.id}`}
                type="button"
                onClick={() => {
                  onChange(entity);
                  setQuery("");
                  setIsOpen(false);
                }}
                className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${
                  entity.id === value ? "bg-muted font-semibold text-foreground" : "text-foreground"
                }`}
              >
                {entity.displayName}{entity.currency ? ` (${entity.currency})` : ""}
              </button>
            ))}
            {filteredOptions.length === 0 ? (
              <div className="px-2 py-2 text-sm text-mutedForeground">No matches found.</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function normalizeEntitySearch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
