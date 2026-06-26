"use client";

import { useFormStatus } from "react-dom";

export function AssistantAskPendingBar() {
  const { pending } = useFormStatus();

  if (!pending) {
    return null;
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">Working on your request</p>
        <span className="text-xs font-medium text-primary">Running</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-border">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
      </div>
    </div>
  );
}

export function AssistantAskSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Asking..." : "Ask"}
    </button>
  );
}
