"use client";

import type { FocusEvent, KeyboardEvent } from "react";
import { useMemo, useState } from "react";
import type {
  SearchProfileSuggestionField,
  SearchProfileSuggestionOption
} from "@/modules/lead-gen/search-profile-suggestions";

export function MultiValueSuggestField({
  label,
  name,
  defaultValue,
  suggestionField,
  description,
  minQueryLength = 3
}: {
  label: string;
  name: string;
  defaultValue?: string;
  suggestionField: SearchProfileSuggestionField;
  description?: string;
  minQueryLength?: number;
}) {
  const [items, setItems] = useState(() => parseInitialItems(defaultValue));
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchProfileSuggestionOption[]>([]);
  const [isFocused, setIsFocused] = useState(false);

  const filteredSuggestions = useMemo(
    () =>
      suggestions.filter((suggestion) => !items.some((item) => item.toLowerCase() === suggestion.value.toLowerCase())),
    [items, suggestions]
  );

  function addItem(value: string | SearchProfileSuggestionOption) {
    const normalized = (typeof value === "string" ? value : value.value).trim();
    if (!normalized) {
      return;
    }

    setItems((current) =>
      current.some((item) => item.toLowerCase() === normalized.toLowerCase()) ? current : [...current, normalized]
    );
    setQuery("");
    setSuggestions([]);
  }

  function removeItem(value: string) {
    setItems((current) => current.filter((item) => item !== value));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addItem(query);
    }
  }

  async function loadSuggestions(nextQuery: string) {
    const normalizedQuery = nextQuery.trim();
    if (normalizedQuery.length < minQueryLength) {
      setSuggestions([]);
      return;
    }

    const response = await fetch(
      `/api/lead-gen/search-profile-suggestions?field=${suggestionField}&q=${encodeURIComponent(normalizedQuery)}`,
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

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    setIsFocused(false);
  }

  const shouldShowSuggestions =
    isFocused && query.trim().length >= minQueryLength && filteredSuggestions.length > 0;

  const helperText =
    query.trim().length > 0 && query.trim().length < minQueryLength
      ? `Type ${minQueryLength - query.trim().length} more letter${minQueryLength - query.trim().length === 1 ? "" : "s"} for canonical suggestions.`
      : description;

  const placeholder = `Type ${minQueryLength}+ letters to search canonical options`;

  function renderSuggestionLabel(option: SearchProfileSuggestionOption) {
    return option.label;
  }

  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      <input type="hidden" name={name} value={items.join("\n")} />
      <div
        className="rounded-md border border-border bg-background p-2"
        onFocus={() => setIsFocused(true)}
        onBlur={handleBlur}
      >
        <div className="flex min-h-10 flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-2 rounded-md border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary"
            >
              {item}
              <button
                type="button"
                onClick={() => removeItem(item)}
                className="text-primary transition-colors hover:text-primaryHover"
                aria-label={`Remove ${item}`}
              >
                x
              </button>
            </span>
          ))}
          <input
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              void loadSuggestions(nextQuery);
            }}
            onFocus={() => {
              setIsFocused(true);
              if (query.trim().length >= minQueryLength) {
                void loadSuggestions(query);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="min-w-[220px] flex-1 border-0 bg-transparent px-1 py-1 text-sm text-foreground outline-none placeholder:text-mutedForeground"
          />
        </div>

        {shouldShowSuggestions ? (
          <div className="mt-2 rounded-md border border-border bg-card shadow-sm">
            {filteredSuggestions.map((suggestion) => (
              <button
                key={`${suggestion.value}-${suggestion.label}`}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  addItem(suggestion);
                }}
                className="block w-full border-b border-border px-3 py-2 text-left text-sm text-foreground transition-colors last:border-b-0 hover:bg-muted"
              >
                {renderSuggestionLabel(suggestion)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {helperText ? <span className="block text-xs font-normal text-mutedForeground">{helperText}</span> : null}
    </label>
  );
}

function parseInitialItems(value?: string) {
  if (!value) {
    return [];
  }

  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);
}
