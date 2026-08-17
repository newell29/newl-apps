"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { applySupplyChainDesignAutomaticMappingAction } from "@/modules/supply-chain-design/actions";

const initialState = {
  ok: false,
  message: ""
};

export function ApplySupplyChainDesignAutomaticMappingForm({ projectId, fileId }: { projectId: string; fileId: string }) {
  const [state, formAction] = useActionState(applySupplyChainDesignAutomaticMappingAction, initialState);

  return (
    <form action={formAction} className="mt-2 space-y-1">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="fileId" value={fileId} />
      <ApplyButton />
      {state.message ? (
        <p className={state.ok ? "text-xs font-medium text-success" : "text-xs font-medium text-danger"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function ApplyButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className="text-xs font-semibold text-primary hover:underline disabled:opacity-60">
      {pending ? "Applying..." : "Apply automatic mapping"}
    </button>
  );
}
