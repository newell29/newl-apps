"use client";

import { useActionState } from "react";
import {
  EMPTY_APOLLO_MATCH_REVIEW_ACTION_STATE,
  type ApolloMatchReviewActionState
} from "@/modules/lead-gen/apollo-match-review-state";

type ReviewAction = (
  previousState: ApolloMatchReviewActionState,
  formData: FormData
) => Promise<ApolloMatchReviewActionState>;

export function ApolloMatchReviewActions({
  companyId,
  companyName,
  status,
  retryAction,
  mapAction,
  confirmNoMatchAction,
  reopenAction
}: {
  companyId: string;
  companyName: string;
  status: "NEEDS_REVIEW" | "CONFIRMED_NO_MATCH";
  retryAction: ReviewAction;
  mapAction: ReviewAction;
  confirmNoMatchAction: ReviewAction;
  reopenAction: ReviewAction;
}) {
  const [retryState, retryFormAction, retryPending] = useActionState(
    retryAction,
    EMPTY_APOLLO_MATCH_REVIEW_ACTION_STATE
  );
  const [mapState, mapFormAction, mapPending] = useActionState(
    mapAction,
    EMPTY_APOLLO_MATCH_REVIEW_ACTION_STATE
  );
  const [confirmState, confirmFormAction, confirmPending] = useActionState(
    confirmNoMatchAction,
    EMPTY_APOLLO_MATCH_REVIEW_ACTION_STATE
  );
  const [reopenState, reopenFormAction, reopenPending] = useActionState(
    reopenAction,
    EMPTY_APOLLO_MATCH_REVIEW_ACTION_STATE
  );

  if (status === "CONFIRMED_NO_MATCH") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-mutedForeground">
          Bulk and automatic Apollo searches are blocked for this company.
        </p>
        <form action={reopenFormAction}>
          <input type="hidden" name="companyId" value={companyId} />
          <button
            disabled={reopenPending}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {reopenPending ? "Reopening…" : "Reopen match review"}
          </button>
        </form>
        <ActionMessage state={reopenState} />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form action={mapFormAction} className="space-y-3 rounded-md border border-border bg-background p-4">
        <div>
          <p className="font-semibold text-foreground">Map the Apollo company URL</p>
          <p className="mt-1 text-xs leading-5 text-mutedForeground">
            Open the company in Apollo and paste its Overview or People page URL. Newl Apps resolves Apollo account
            links to the exact global organization, records who mapped it, and searches contacts only inside that company.
          </p>
        </div>
        <input type="hidden" name="companyId" value={companyId} />
        <label className="block space-y-1 text-sm font-medium text-foreground">
          <span>Apollo company URL</span>
          <input
            name="apolloCompanyUrl"
            required
            placeholder="https://app.apollo.io/#/accounts/<account-id>"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="flex items-start gap-2 text-xs leading-5 text-mutedForeground">
          <input
            type="checkbox"
            name="confirmApolloCredit"
            value="yes"
            required
            className="mt-1"
          />
          <span>I confirm this is the Apollo company for {companyName} and authorize the 1-credit validation.</span>
        </label>
        <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-mutedForeground">
          <input
            type="checkbox"
            name="authorizePaidEmailEnrichment"
            value="yes"
            className="mt-1"
          />
          <span>
            Optional: if no saved Apollo contact has a usable email, authorize up to 3 email-only person
            enrichments (maximum 1 credit each; no phone or waterfall lookup).
          </span>
        </label>
        <button
          disabled={mapPending}
          className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {mapPending ? "Validating and mapping…" : "Map company and find contacts"}
        </button>
        <ActionMessage state={mapState} />
      </form>

      <div className="space-y-4 rounded-md border border-border bg-background p-4">
        <form action={retryFormAction} className="space-y-3">
          <input type="hidden" name="companyId" value={companyId} />
          <div>
            <p className="font-semibold text-foreground">Retry automatic matching</p>
            <p className="mt-1 text-xs leading-5 text-mutedForeground">
              Use this only after correcting the company name or domain. The retry uses Apollo&apos;s documented
              filters and is capped at two returned search pages.
            </p>
          </div>
          <label className="flex items-start gap-2 text-xs leading-5 text-mutedForeground">
            <input
              type="checkbox"
              name="confirmAutomaticCredits"
              value="yes"
              required
              className="mt-1"
            />
            <span>I authorize up to 2 Apollo organization-search credits for this retry.</span>
          </label>
          <button
            disabled={retryPending}
            className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-warning/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {retryPending ? "Searching…" : "Retry automatic match"}
          </button>
          <ActionMessage state={retryState} />
        </form>

        <form action={confirmFormAction} className="space-y-2 border-t border-border pt-4">
          <input type="hidden" name="companyId" value={companyId} />
          <p className="text-xs leading-5 text-mutedForeground">
            If Apollo truly has no usable company, archive it as Confirmed no match. It can be reopened later.
          </p>
          <button
            disabled={confirmPending}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {confirmPending ? "Confirming…" : "Confirm no Apollo match"}
          </button>
          <ActionMessage state={confirmState} />
        </form>
      </div>
    </div>
  );
}

function ActionMessage({ state }: { state: ApolloMatchReviewActionState }) {
  if (!state.message) {
    return null;
  }

  return (
    <p
      className={`rounded-md border px-3 py-2 text-xs leading-5 ${
        state.status === "error"
          ? "border-danger/30 bg-danger/10 text-danger"
          : "border-success/30 bg-success/10 text-foreground"
      }`}
      role="status"
    >
      {state.message}
    </p>
  );
}
