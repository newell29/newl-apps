"use client";

import { useState, type ReactNode } from "react";
import type { Table } from "@tanstack/react-table";

export function DataGridColumnMenu<TData>({
  table,
  label = "Columns",
  align = "right"
}: {
  table: Table<TData>;
  label?: ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const columns = table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide() && typeof column.columnDef.header === "string");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accentSoft"
      >
        {label}
      </button>
      {open ? (
        <div
          className={`absolute top-10 z-30 min-w-[220px] rounded-md border border-border bg-card p-3 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-mutedForeground">Visible columns</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-mutedForeground transition-colors hover:text-foreground"
            >
              Close
            </button>
          </div>
          <div className="space-y-2">
            {columns.map((column) => (
              <label key={column.id} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={column.getIsVisible()}
                  onChange={column.getToggleVisibilityHandler()}
                />
                <span>{column.columnDef.header as string}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
