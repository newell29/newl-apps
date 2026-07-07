"use client";

import type { FocusEvent, KeyboardEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
import type { SearchProfileSuggestionOption } from "@/modules/lead-gen/search-profile-suggestions";

export type OceanFreightSuggestionField = "ports" | "countries";

export function OceanFreightSuggestInput({
  label,
  name,
  defaultValue,
  suggestionField,
  placeholder,
  required,
  className,
  minQueryLength = 2
}: {
  label?: string;
  name: string;
  defaultValue?: string | null;
  suggestionField: OceanFreightSuggestionField;
  placeholder?: string;
  required?: boolean;
  className?: string;
  minQueryLength?: number;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [suggestions, setSuggestions] = useState<SearchProfileSuggestionOption[]>([]);
  const [isFocused, setIsFocused] = useState(false);

  const filteredSuggestions = useMemo(
    () => suggestions.filter((suggestion) => suggestion.value.toLowerCase() !== value.trim().toLowerCase()),
    [suggestions, value]
  );

  async function loadSuggestions(nextValue: string) {
    const query = nextValue.trim();
    if (query.length < minQueryLength) {
      setSuggestions([]);
      return;
    }

    const response = await fetch(
      `/api/ocean-freight-pricing/suggestions?field=${suggestionField}&q=${encodeURIComponent(query)}`,
      {
        method: "GET",
        cache: "no-store"
      }
    );

    if (!response.ok) {
      setSuggestions([]);
      return;
    }

    const payload = (await response.json()) as { suggestions?: SearchProfileSuggestionOption[] };
    setSuggestions(Array.isArray(payload.suggestions) ? payload.suggestions : []);
  }

  function selectSuggestion(option: SearchProfileSuggestionOption) {
    setValue(option.value);
    setSuggestions([]);
    setIsFocused(false);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    setIsFocused(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && filteredSuggestions[0]) {
      event.preventDefault();
      selectSuggestion(filteredSuggestions[0]);
    }
  }

  const shouldShowSuggestions =
    isFocused && value.trim().length >= minQueryLength && filteredSuggestions.length > 0;
  const input = (
    <SuggestShell onBlur={handleBlur}>
      <input
        name={name}
        value={value}
        required={required}
        placeholder={placeholder ?? `Type ${minQueryLength}+ letters`}
        onChange={(event) => {
          const nextValue = event.target.value;
          setValue(nextValue);
          void loadSuggestions(nextValue);
        }}
        onFocus={() => {
          setIsFocused(true);
          if (value.trim().length >= minQueryLength) {
            void loadSuggestions(value);
          }
        }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        className={className ?? "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"}
      />

      {shouldShowSuggestions ? (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-card shadow-lg">
          {filteredSuggestions.map((suggestion) => (
            <button
              key={`${suggestion.value}-${suggestion.label}`}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                selectSuggestion(suggestion);
              }}
              className="block w-full border-b border-border px-3 py-2 text-left text-sm text-foreground transition-colors last:border-b-0 hover:bg-muted"
            >
              <span className="font-medium">{suggestion.value}</span>
              {suggestion.label !== suggestion.value ? (
                <span className="ml-2 text-xs text-mutedForeground">{suggestion.label}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </SuggestShell>
  );

  if (!label) {
    return input;
  }

  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      {input}
    </label>
  );
}

function SuggestShell({
  children,
  onBlur
}: {
  children: ReactNode;
  onBlur: (event: FocusEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className="relative" onBlur={onBlur}>
      {children}
    </div>
  );
}
