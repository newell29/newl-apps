"use client";

import { useActionState, type ReactNode } from "react";
import {
  createTradeMiningSearchProfileFormAction,
  updateTradeMiningSearchProfileFormAction,
  type SearchProfileFormState
} from "@/modules/lead-gen/actions";

const initialState: SearchProfileFormState = {
  status: "idle",
  message: null
};

export function SearchProfileMutationForm({
  mode,
  profileId,
  children
}: {
  mode: "create" | "update";
  profileId?: string;
  children: ReactNode;
}) {
  const action =
    mode === "create"
      ? createTradeMiningSearchProfileFormAction
      : updateTradeMiningSearchProfileFormAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className={mode === "create" ? "mt-4" : undefined}>
      {profileId ? <input type="hidden" name="profileId" value={profileId} /> : null}
      {children}
      {state.message ? (
        <div
          role={state.status === "error" ? "alert" : "status"}
          className={`mt-4 rounded-md border px-3 py-2 text-sm ${
            state.status === "error"
              ? "border-danger/30 bg-danger/5 text-danger"
              : "border-success/30 bg-success/5 text-success"
          }`}
        >
          {state.message}
        </div>
      ) : null}
      <div className="mt-4">
        <button
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-wait disabled:opacity-60"
        >
          {pending
            ? mode === "create"
              ? "Creating..."
              : "Saving..."
            : mode === "create"
              ? "Create search profile"
              : "Save profile"}
        </button>
      </div>
    </form>
  );
}
