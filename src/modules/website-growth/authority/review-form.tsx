"use client";
import { useState, useTransition, type ReactNode } from "react";
import { reviewAuthorityPlanAction, saveAuthorityCampaignAction } from "./actions";
export function AuthorityCampaignForm({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false), [pending, start] = useTransition();
  return <form action={form => start(async () => { const result = await saveAuthorityCampaignAction(form); setError(result.error); setSaved(!result.error); })}>
    <fieldset disabled={pending} className="mt-4 grid gap-4 md:grid-cols-2">{children}</fieldset>
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    {saved && <p role="status" className="mt-3 text-sm">Campaign settings saved. External actions still require individual approval.</p>}
  </form>;
}
export function AuthorityReviewForm({ id, revision, state, manual }: { id: string; revision: number; state: string; manual: boolean }) {
  const [error, setError] = useState<string | null>(null), [pending, start] = useTransition();
  return <form className="mt-4 space-y-3" action={form => start(async () => { const result = await reviewAuthorityPlanAction(form); setError(result.error); })}>
    <input type="hidden" name="id" value={id} /><input type="hidden" name="revision" value={revision} />
    <label className="block text-sm">{manual && state === "REVIEW" ? "Submission receipt or decision evidence" : "Decision or reconciliation evidence"}<textarea name="feedback" required maxLength={2000} className="mt-1 block w-full rounded border border-border bg-background p-2" defaultValue={state === "REVIEW" && !manual ? "Reviewed the exact route, copy, terms and feasibility evidence." : ""} /></label>
    {state === "REVIEW" && !manual && <label className="flex gap-2 text-sm"><input type="checkbox" name="confirm" />I approve executing this exact free action once. Email includes the standard business identity and opt-out footer.</label>}
    {state === "REVIEW" && manual && <><p className="text-sm text-mutedForeground">Complete the publisher step yourself, then record the receipt or decision shown. This marks the action submitted, not live; Scout must still verify a public link separately.</p>
      <label className="flex gap-2 text-sm"><input type="checkbox" name="confirm" />I confirm I completed this publisher action manually and the evidence above records the result shown after submission.</label></>}
    <div className="flex flex-wrap gap-3">
      {state === "REVIEW" && !manual && <button disabled={pending} name="decision" value="APPROVE" className="rounded bg-primary px-4 py-2 text-sm text-primaryForeground">Approve exact action</button>}
      {state === "REVIEW" && manual && <button disabled={pending} name="decision" value="RECORD_SUBMISSION" className="rounded bg-primary px-4 py-2 text-sm text-primaryForeground">Record manual submission</button>}
      <button disabled={pending} name="decision" value={state === "UNCERTAIN" ? "RESOLVE" : "REVISE"} className="rounded border border-border px-4 py-2 text-sm">{state === "UNCERTAIN" ? "Record reconciliation and close" : "Return to Scout with feedback"}</button>
      {state !== "UNCERTAIN" && <button disabled={pending} name="decision" value="CLOSE" className="rounded border border-border px-4 py-2 text-sm">{manual ? "Decline and close" : "Close action"}</button>}
    </div>{error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </form>;
}
