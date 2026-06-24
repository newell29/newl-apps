"use client";

import { useEffect, useState } from "react";
import type { ColumnFiltersState, ColumnSizingState, SortingState, VisibilityState } from "@tanstack/react-table";

type PersistedTableState = {
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  columnVisibility: VisibilityState;
  columnSizing: ColumnSizingState;
};

const DEFAULT_STATE: PersistedTableState = {
  sorting: [],
  columnFilters: [],
  columnVisibility: {},
  columnSizing: {}
};

export function usePersistedTableState(storageKey: string) {
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_STATE.sorting);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(DEFAULT_STATE.columnFilters);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(DEFAULT_STATE.columnVisibility);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(DEFAULT_STATE.columnSizing);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setHydrated(true);
        return;
      }

      const parsed = JSON.parse(raw) as Partial<PersistedTableState>;
      setSorting(Array.isArray(parsed.sorting) ? parsed.sorting : DEFAULT_STATE.sorting);
      setColumnFilters(Array.isArray(parsed.columnFilters) ? parsed.columnFilters : DEFAULT_STATE.columnFilters);
      setColumnVisibility(isPlainObject(parsed.columnVisibility) ? parsed.columnVisibility : DEFAULT_STATE.columnVisibility);
      setColumnSizing(isPlainObject(parsed.columnSizing) ? parsed.columnSizing : DEFAULT_STATE.columnSizing);
    } catch {
      window.localStorage.removeItem(storageKey);
    } finally {
      setHydrated(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    const nextState: PersistedTableState = {
      sorting,
      columnFilters,
      columnVisibility,
      columnSizing
    };

    window.localStorage.setItem(storageKey, JSON.stringify(nextState));
  }, [columnFilters, columnSizing, columnVisibility, hydrated, sorting, storageKey]);

  return {
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    columnVisibility,
    setColumnVisibility,
    columnSizing,
    setColumnSizing,
    hydrated
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
