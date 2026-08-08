"use client";

import { useActionState } from "react";
import {
  EMPTY_IDENTITY_REVIEW_ACTION_STATE,
  type IdentityReviewActionState
} from "@/modules/customer-intelligence/identity-review-state";
import {
  createAndApproveIdentityCompanyAction,
  reviewIdentityMatchAction
} from "@/modules/customer-intelligence/review-actions";

type ReviewAction = (
  previousState: IdentityReviewActionState,
  formData: FormData
) => Promise<IdentityReviewActionState>;

/**
 * Approve / reject / defer controls for one identity-review queue record
 * (CP-PHASE-02B-3). The forms are presentation only: authorization, tenant
 * validation, one-approved-per-source, and audit logging are enforced by the
 * core `reviewIdentityMatch` action. Approve requires selecting an existing
 * tenant company — a QuickBooks customer name alone never approves or creates
 * a canonical Company (CP-02B-3-Q1).
 */
export function IdentityReviewActions({
  matchId,
  sourceLabel,
  defaultCompanyId,
  companies,
  operatingCompanyId,
  operatingCompanies,
  canApprove
}: {
  matchId: string;
  sourceLabel: string;
  defaultCompanyId: string | null;
  companies: Array<{ id: string; name: string; domain: string | null }>;
  operatingCompanyId: string | null;
  operatingCompanies: Array<{ id: string; displayName: string }>;
  canApprove: boolean;
}) {
  const [approveState, approveFormAction, approvePending] = useActionState(
    reviewIdentityMatchAction as ReviewAction,
    EMPTY_IDENTITY_REVIEW_ACTION_STATE
  );
  const [rejectState, rejectFormAction, rejectPending] = useActionState(
    reviewIdentityMatchAction as ReviewAction,
    EMPTY_IDENTITY_REVIEW_ACTION_STATE
  );
  const [deferState, deferFormAction, deferPending] = useActionState(
    reviewIdentityMatchAction as ReviewAction,
    EMPTY_IDENTITY_REVIEW_ACTION_STATE
  );
  const [createState, createFormAction, createPending] = useActionState(
    createAndApproveIdentityCompanyAction as ReviewAction,
    EMPTY_IDENTITY_REVIEW_ACTION_STATE
  );

  return (
    <div className="space-y-4 border-t border-border pt-4">
      {!canApprove ? (
        <p className="rounded-md border border-border bg-background px-3 py-2 text-xs leading-5 text-mutedForeground">
          Approve, reject, and defer require an ADMIN or FINANCE role. This record stays in the
          review queue.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <form action={approveFormAction} className="space-y-3">
            <input type="hidden" name="matchId" value={matchId} />
            <input type="hidden" name="decision" value="APPROVE" />
            <div>
              <p className="text-sm font-semibold text-foreground">Approve to a canonical company</p>
              <p className="mt-1 text-xs leading-5 text-mutedForeground">
                Select an existing tenant company. A QuickBooks customer name alone never
                approves or creates a canonical company.
              </p>
            </div>
            <label className="block space-y-1 text-xs font-medium text-foreground">
              <span>Canonical company</span>
              <select
                name="companyId"
                required
                defaultValue={defaultCompanyId ?? ""}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground"
              >
                <option value="" disabled>
                  Select a company
                </option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                    {company.domain ? ` · ${company.domain}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-xs font-medium text-foreground">
              <span>Note (optional)</span>
              <textarea
                name="note"
                rows={2}
                placeholder="Why this target is correct"
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground"
              />
            </label>
            <button
              disabled={approvePending}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {approvePending ? "Approving…" : "Approve"}
            </button>
            <ActionMessage state={approveState} />
          </form>

          <form action={createFormAction} className="space-y-3">
            <input type="hidden" name="matchId" value={matchId} />
            <div>
              <p className="text-sm font-semibold text-foreground">Create and approve a new company</p>
              <p className="mt-1 text-xs leading-5 text-mutedForeground">
                Enter the canonical identity yourself. Source name evidence is never copied automatically.
              </p>
            </div>
            <label className="block space-y-1 text-xs font-medium text-foreground">
              <span>Canonical company name</span>
              <input
                name="companyName"
                required
                maxLength={200}
                autoComplete="organization"
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground"
              />
            </label>
            <label className="block space-y-1 text-xs font-medium text-foreground">
              <span>Domain (optional)</span>
              <input
                name="domain"
                placeholder="example.com"
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground"
              />
            </label>
            <label className="block space-y-1 text-xs font-medium text-foreground">
              <span>Operating company</span>
              <select
                name="operatingCompanyId"
                required
                defaultValue={operatingCompanyId ?? ""}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground"
              >
                <option value="" disabled>Select an operating company</option>
                {operatingCompanies.map((company) => (
                  <option key={company.id} value={company.id}>{company.displayName}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-xs font-medium text-foreground">
              <span>Approval note (optional)</span>
              <textarea name="note" rows={2} className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground" />
            </label>
            <label className="flex gap-2 text-xs leading-5 text-foreground">
              <input
                type="checkbox"
                name="approvalConfirmation"
                value="CREATE_AND_APPROVE"
                required
              />
              <span>I explicitly approve creating this canonical Company and linking this QuickBooks customer.</span>
            </label>
            <button
              disabled={createPending}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createPending ? "Creating and approving…" : "Create company and approve"}
            </button>
            <ActionMessage state={createState} />
          </form>

          <form action={rejectFormAction} className="space-y-3">
            <input type="hidden" name="matchId" value={matchId} />
            <input type="hidden" name="decision" value="REJECT" />
            <div>
              <p className="text-sm font-semibold text-foreground">Reject the suggestion</p>
              <p className="mt-1 text-xs leading-5 text-mutedForeground">
                Records a reviewed rejection; re-runs never overwrite it.
              </p>
            </div>
            <label className="block space-y-1 text-xs font-medium text-foreground">
              <span>Note (optional)</span>
              <textarea
                name="note"
                rows={2}
                placeholder="Why this candidate is wrong"
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground"
              />
            </label>
            <button
              disabled={rejectPending}
              className="w-full rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-semibold text-danger transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {rejectPending ? "Rejecting…" : "Reject"}
            </button>
            <ActionMessage state={rejectState} />
          </form>

          <form action={deferFormAction} className="space-y-3">
            <input type="hidden" name="matchId" value={matchId} />
            <input type="hidden" name="decision" value="DEFER" />
            <div>
              <p className="text-sm font-semibold text-foreground">Defer (keep proposed)</p>
              <p className="mt-1 text-xs leading-5 text-mutedForeground">
                Leaves the record in this review queue for a later decision.
              </p>
            </div>
            <label className="block space-y-1 text-xs font-medium text-foreground">
              <span>Note (optional)</span>
              <textarea
                name="note"
                rows={2}
                placeholder="What is still missing"
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground"
              />
            </label>
            <button
              disabled={deferPending}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deferPending ? "Deferring…" : "Defer"}
            </button>
            <ActionMessage state={deferState} />
          </form>
        </div>
      )}
      <p className="text-xs text-mutedForeground">
        Every approval, rejection, and deferral writes an AuditLog entry for {sourceLabel}.
      </p>
    </div>
  );
}

function ActionMessage({ state }: { state: IdentityReviewActionState }) {
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
