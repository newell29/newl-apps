"use client";

import { useFormStatus } from "react-dom";

export function OceanFreightIngestionSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? "Running ingestion..." : "Run Microsoft 365 email ingestion"}
    </button>
  );
}
