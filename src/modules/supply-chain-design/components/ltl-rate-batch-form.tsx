"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { startSupplyChainDesignLtlRateBatchAction } from "@/modules/supply-chain-design/actions";

const initialState = {
  ok: false,
  message: "",
  runId: null
};

export function SupplyChainDesignLtlRateBatchForm({
  projectId,
  preparationRunId,
  readyRequestCount
}: {
  projectId: string;
  preparationRunId: string;
  readyRequestCount: number;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(startSupplyChainDesignLtlRateBatchAction, initialState);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
    }
  }, [router, state.ok, state.runId]);

  return (
    <form action={formAction} className="space-y-3 rounded-md border border-border bg-background p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="preparationRunId" value={preparationRunId} />
      <p className="text-sm text-mutedForeground">
        {readyRequestCount.toLocaleString("en-US")} prepared LTL shipment requests will be sent through the tenant 7L
        account and enabled carrier configuration.
      </p>
      <SubmitButton disabled={readyRequestCount === 0} />
      {state.message ? (
        <p className={state.ok ? "text-sm font-medium text-success" : "text-sm font-medium text-danger"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Starting..." : "Get 7L Rates"}
    </button>
  );
}
