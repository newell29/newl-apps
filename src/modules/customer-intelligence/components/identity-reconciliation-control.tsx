"use client";

import { useActionState } from "react";
import { EMPTY_IDENTITY_REVIEW_ACTION_STATE } from "@/modules/customer-intelligence/identity-review-state";
import { runIdentityReconciliationAction } from "@/modules/customer-intelligence/review-actions";

/**
 * ADMIN/FINANCE control that triggers the deterministic identity
 * reconciliation (CP-PHASE-02B-3). The action re-enforces authorization and
 * tenant scoping server-side; this control is presentation only.
 */
export function IdentityReconciliationControl() {
  const [state, formAction, pending] = useActionState(
    runIdentityReconciliationAction,
    EMPTY_IDENTITY_REVIEW_ACTION_STATE
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Reconciling…" : "Run reconciliation"}
        </button>
      </div>
      {state.message ? (
        <p
          className={`max-w-xl rounded-md border px-3 py-2 text-xs leading-5 ${
            state.status === "error"
              ? "border-danger/30 bg-danger/10 text-danger"
              : "border-success/30 bg-success/10 text-foreground"
          }`}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
