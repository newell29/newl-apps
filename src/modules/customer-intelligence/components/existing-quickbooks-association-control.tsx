"use client";

import { useActionState, useState } from "react";

import { associateExistingQuickBooksConnectionAction } from "@/modules/customer-intelligence/existing-quickbooks-association-actions";
import {
  EMPTY_EXISTING_QUICKBOOKS_ASSOCIATION_STATE,
  EXISTING_QUICKBOOKS_ASSOCIATION_CONFIRMATION
} from "@/modules/customer-intelligence/existing-quickbooks-association-state";

export function ExistingQuickBooksAssociationControl({
  operatingCompanyId
}: {
  operatingCompanyId: string;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [state, formAction, pending] = useActionState(
    associateExistingQuickBooksConnectionAction,
    EMPTY_EXISTING_QUICKBOOKS_ASSOCIATION_STATE
  );

  return (
    <form action={formAction} className="mt-4 space-y-3 rounded-md border border-warning/25 bg-warning/5 p-3">
      <input type="hidden" name="operatingCompanyId" value={operatingCompanyId} />
      <input
        type="hidden"
        name="confirmation"
        value={confirmed ? EXISTING_QUICKBOOKS_ASSOCIATION_CONFIRMATION : ""}
      />
      <p className="text-sm text-mutedForeground">
        An existing active connection matches this company. Association updates only the Customer
        Intelligence reference; it does not reconnect QuickBooks, replace tokens, or start sync.
      </p>
      <label className="flex items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={pending}
        />
        <span>I confirm this one-company association.</span>
      </label>
      <button
        type="submit"
        disabled={!confirmed || pending}
        className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primaryForeground disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Associating…" : "Associate existing connection"}
      </button>
      {state.message ? (
        <p className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-success"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
