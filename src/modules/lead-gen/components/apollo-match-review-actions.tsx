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
  confirmedApolloAccountUrl,
  resolvedApolloOrganizationUrl,
  status,
  retryAction,
  mapAction,
  confirmNoMatchAction,
  reopenAction,
  mappedCompanyRecheckAction
}: {
  companyId: string;
  companyName: string;
  confirmedApolloAccountUrl: string | null;
  resolvedApolloOrganizationUrl: string | null;
  status: "NEEDS_REVIEW" | "MAPPED_NO_EMPLOYEES" | "CONFIRMED_NO_MATCH";
  retryAction: ReviewAction;
  mapAction: ReviewAction;
  confirmNoMatchAction: ReviewAction;
  reopenAction: ReviewAction;
  mappedCompanyRecheckAction: (formData: FormData) => Promise<void>;
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

  if (status === "MAPPED_NO_EMPLOYEES") {
    return (
      <div className="space-y-4 rounded-md border border-success/30 bg-success/10 p-4">
        <p className="font-semibold text-foreground">Apollo company mapping is confirmed</p>
        <p className="mt-1 text-sm leading-6 text-mutedForeground">
          Recheck the confirmed company first. Newl Apps searches Apollo&apos;s complete organization roster,
          retries through the confirmed company domain, merges saved contacts, and lets Hunter select no more
          than three relevant buyers. You do not need to paste individual people.
        </p>
        <div className="flex flex-wrap gap-3 text-xs font-semibold">
          {confirmedApolloAccountUrl ? (
            <a
              href={confirmedApolloAccountUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:text-primaryHover"
            >
              Open the confirmed Apollo account
            </a>
          ) : null}
          {resolvedApolloOrganizationUrl ? (
            <a
              href={resolvedApolloOrganizationUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:text-primaryHover"
            >
              Open the resolved Apollo organization
            </a>
          ) : null}
        </div>
        <form action={mappedCompanyRecheckAction} className="mt-3 space-y-3">
          <input type="hidden" name="companyId" value={companyId} />
          <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-background px-3 py-2 text-xs leading-5 text-mutedForeground">
            <input
              type="checkbox"
              name="authorizePaidEmailEnrichment"
              value="yes"
              className="mt-1"
            />
            <span>
              Optional: if the best automatically selected employees are not already saved with email,
              authorize up to three email-only enrichments (maximum 1 Apollo credit each; no phone,
              personal email, or waterfall lookup).
            </span>
          </label>
          <button className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primaryForeground">
            Search company employees and build plans
          </button>
        </form>
        <details className="rounded-md border border-border bg-background p-3">
          <summary className="cursor-pointer text-xs font-semibold text-foreground">
            Last-resort person URL recovery
          </summary>
          <p className="mt-2 text-xs leading-5 text-mutedForeground">
            Use this only if the automatic company search still reports zero employees. Apollo may put
            either a saved-contact ID or a person ID in this URL; Newl Apps checks both safely.
          </p>
          <form action={mappedCompanyRecheckAction} className="mt-3 space-y-3">
            <input type="hidden" name="companyId" value={companyId} />
            <label className="block space-y-1 text-xs font-medium text-foreground">
              <span>Apollo person URLs (one per line, maximum 3)</span>
              <textarea
                name="apolloPersonUrls"
                required
                rows={4}
                placeholder="https://app.apollo.io/#/people/<person-or-contact-id>"
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground"
              />
            </label>
            <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-card px-3 py-2 text-xs leading-5 text-mutedForeground">
              <input
                type="checkbox"
                name="authorizePaidEmailEnrichment"
                value="yes"
                required
                className="mt-1"
              />
              <span>
                I authorize email-only enrichment only when the pasted ID is not an existing saved
                Apollo contact (maximum 1 credit per person).
              </span>
            </label>
            <button className="rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground">
              Verify pasted people
            </button>
          </form>
        </details>
        <details className="rounded-md border border-border bg-background p-3">
          <summary className="cursor-pointer text-xs font-semibold text-foreground">
            Replace an empty or incorrect Apollo company mapping
          </summary>
          <p className="mt-2 text-xs leading-5 text-mutedForeground">
            Use this when the confirmed account is an empty Apollo shell but a canonical parent or
            brand account has the complete employee roster. The replacement remains reviewer-confirmed
            and auditable.
          </p>
          <form action={mapFormAction} className="mt-3 space-y-3">
            <input type="hidden" name="companyId" value={companyId} />
            <label className="block space-y-1 text-xs font-medium text-foreground">
              <span>Replacement Apollo company URL</span>
              <input
                name="apolloCompanyUrl"
                required
                placeholder="https://app.apollo.io/#/accounts/<account-id>"
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground"
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
              <span>
                I confirm this is the correct Apollo parent or brand account and authorize the
                one-credit company validation.
              </span>
            </label>
            <button
              disabled={mapPending}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {mapPending ? "Replacing mapping…" : "Replace mapping and find contacts"}
            </button>
          </form>
          <ActionMessage state={mapState} />
        </details>
        <details className="rounded-md border border-border bg-background p-3">
          <summary className="cursor-pointer text-xs font-semibold text-foreground">
            Archive this exception
          </summary>
          <p className="mt-2 text-xs leading-5 text-mutedForeground">
            Use this when the company has no usable employees, is a duplicate, or should not remain
            in your active exception queue. The company and Apollo mapping are preserved for audit
            and deduplication, and you can reopen it later.
          </p>
          <form action={confirmFormAction} className="mt-3 space-y-3">
            <input type="hidden" name="companyId" value={companyId} />
            <label className="block space-y-1 text-xs font-medium text-foreground">
              <span>Archive reason</span>
              <select
                name="archiveReason"
                required
                defaultValue=""
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground"
              >
                <option value="" disabled>Select a reason</option>
                <option value="No usable Apollo employees">No usable employees</option>
                <option value="Duplicate company">Duplicate company</option>
                <option value="Incorrect or irrelevant company">Incorrect or irrelevant company</option>
                <option value="Other reviewer decision">Other</option>
              </select>
            </label>
            <button
              disabled={confirmPending}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirmPending ? "Archiving…" : "Archive exception"}
            </button>
          </form>
          <ActionMessage state={confirmState} />
        </details>
      </div>
    );
  }

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
          <span>
            I confirm this Apollo account is the correct company or canonical parent/brand for {companyName},
            understand this overrides automated name-similarity warnings, and authorize the 1-credit validation.
          </span>
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
        <label className="block space-y-1 text-xs font-medium text-foreground">
          <span>Optional Apollo person URLs (one per line, maximum 3)</span>
          <textarea
            name="apolloPersonUrls"
            rows={3}
            placeholder="Use only when Apollo shows Suggested leads that automatic employee search cannot retrieve."
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground"
          />
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
          <input type="hidden" name="archiveReason" value="No usable Apollo company match" />
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
