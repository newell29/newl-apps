"use client";

import { useActionState } from "react";

import {
  testAssistantProviderConnectionAction,
  type AssistantProviderConnectionTestState
} from "@/modules/settings/actions";

const INITIAL_STATE: AssistantProviderConnectionTestState = {
  status: "idle",
  message: ""
};

export function AssistantProviderTest() {
  const [state, action, pending] = useActionState(
    testAssistantProviderConnectionAction,
    INITIAL_STATE
  );

  return (
    <div className="space-y-3 rounded-md border border-border bg-background p-4">
      <div>
        <p className="text-sm font-medium text-foreground">Saved-provider connection test</p>
        <p className="mt-1 text-xs leading-5 text-mutedForeground">
          Checks model discovery and runs a short grounded reply through the saved endpoint. Save changes before testing.
        </p>
      </div>
      <form action={action}>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Testing local model…" : "Test local model"}
        </button>
      </form>
      {state.status !== "idle" ? (
        <p
          className={[
            "rounded-md border px-3 py-2 text-sm",
            state.status === "success"
              ? "border-success/25 bg-success/10 text-success"
              : "border-warning/25 bg-warning/10 text-foreground"
          ].join(" ")}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
