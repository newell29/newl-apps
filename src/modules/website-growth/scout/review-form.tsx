"use client";

import { useActionState, useState } from "react";
import { reviewScoutWorkAction } from "./actions";

export function ScoutReviewForm({ id, revision, hasDraft }: { id: string; revision: number; hasDraft: boolean }) {
  const [feedback, setFeedback] = useState("");
  const [state, action, pending] = useActionState(
    (_state: { error: string | null }, form: FormData) => reviewScoutWorkAction(form), { error: null }
  );
  const field = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
  return <form action={action} className="mt-4 space-y-2">
    <input type="hidden" name="id" value={id} /><input type="hidden" name="revision" value={revision} />
    <label className="block text-xs">Decision<select name="decision" defaultValue="REVISE" required className={field} disabled={pending}>
      <option value="REVISE">Return to Scout</option>{!hasDraft && <option value="ACCEPT">Mark reviewed</option>}<option value="DISMISS">Dismiss</option>
    </select></label>
    <label className="block text-xs">Feedback / next action<textarea name="feedback" required maxLength={2000} value={feedback} onChange={event => setFeedback(event.target.value)} className={field} readOnly={pending} /></label>
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    <button type="submit" disabled={pending} className="rounded-md border border-border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50">{pending ? "Saving…" : "Save decision"}</button>
  </form>;
}
