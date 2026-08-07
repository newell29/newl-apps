"use server";

import { revalidatePath } from "next/cache";

import {
  approveIdentityMatchWithNewCompany,
  runIdentityReconciliation,
  reviewIdentityMatch
} from "@/modules/customer-intelligence/actions";
import type { IdentityReviewActionState } from "@/modules/customer-intelligence/identity-review-state";
import { getAuthenticatedContext } from "@/server/tenant-context";

/**
 * Server actions for the Customer Intelligence identity review queue
 * (CP-PHASE-02B-3). These are thin, guarded wrappers: authorization, tenant
 * validation, review invariants, and audit logging all live in the core
 * actions; a visible review control never substitutes for server-side
 * enforcement.
 */

const REVIEW_PATH = "/customer-intelligence/review";

function errorState(error: unknown): IdentityReviewActionState {
  return {
    status: "error",
    message: error instanceof Error ? error.message : "Identity review failed."
  };
}

/** Explicit human-approved Company creation; never called by reconciliation. */
export async function createAndApproveIdentityCompanyAction(
  _previousState: IdentityReviewActionState,
  formData: FormData
): Promise<IdentityReviewActionState> {
  try {
    const context = await getAuthenticatedContext();
    const matchId = String(formData.get("matchId") ?? "").trim();
    const companyName = String(formData.get("companyName") ?? "").trim();
    const domain = String(formData.get("domain") ?? "").trim() || undefined;
    const operatingCompanyId =
      String(formData.get("operatingCompanyId") ?? "").trim() || undefined;
    const note = String(formData.get("note") ?? "").trim().slice(0, 500) || undefined;
    const confirmation = String(formData.get("approvalConfirmation") ?? "");
    if (!matchId) {
      throw new Error("Identity match is required.");
    }
    if (confirmation !== "CREATE_AND_APPROVE") {
      throw new Error("Confirm canonical Company creation before approving.");
    }
    await approveIdentityMatchWithNewCompany(context, matchId, {
      companyName,
      domain,
      operatingCompanyId,
      note,
      confirmation: "CREATE_AND_APPROVE"
    });
    revalidatePath(REVIEW_PATH);
    return { status: "success", message: "Canonical company created and identity match approved." };
  } catch (error) {
    return errorState(error);
  }
}

/**
 * Approve, reject, or defer one identity match. The decision is read from the
 * submitted form; a canonical target may accompany APPROVE (and optionally
 * REJECT) and is tenant-validated before any status update.
 */
export async function reviewIdentityMatchAction(
  _previousState: IdentityReviewActionState,
  formData: FormData
): Promise<IdentityReviewActionState> {
  try {
    const context = await getAuthenticatedContext();
    const matchId = String(formData.get("matchId") ?? "").trim();
    const decision = String(formData.get("decision") ?? "").trim();
    const companyId = String(formData.get("companyId") ?? "").trim() || undefined;
    const note = String(formData.get("note") ?? "").trim().slice(0, 500) || undefined;

    if (!matchId) {
      throw new Error("Identity match is required.");
    }
    if (decision !== "APPROVE" && decision !== "REJECT" && decision !== "DEFER") {
      throw new Error("Review decision must be APPROVE, REJECT, or DEFER.");
    }

    await reviewIdentityMatch(context, matchId, decision, {
      companyId,
      note
    });

    revalidatePath(REVIEW_PATH);
    const message =
      decision === "APPROVE"
        ? "Identity match approved."
        : decision === "REJECT"
          ? "Identity match rejected."
          : "Identity match deferred back to proposed.";
    return { status: "success", message };
  } catch (error) {
    return errorState(error);
  }
}

/**
 * Trigger the deterministic identity reconciliation over the tenant's PROPOSED
 * QuickBooks matches (optionally for one operating company). ADMIN and FINANCE
 * roles are enforced by the core action.
 */
export async function runIdentityReconciliationAction(
  _previousState: IdentityReviewActionState,
  formData: FormData
): Promise<IdentityReviewActionState> {
  try {
    const context = await getAuthenticatedContext();
    const operatingCompanyId =
      String(formData.get("operatingCompanyId") ?? "").trim() || undefined;

    const report = await runIdentityReconciliation(context, { operatingCompanyId });

    revalidatePath(REVIEW_PATH);
    return {
      status: "success",
      message: `Reconciliation finished: ${report.totals.autoLinked} auto-linked, ${report.totals.routedToReview} routed to review, ${report.totals.reviewedPreserved} reviewed decisions preserved.`
    };
  } catch (error) {
    return errorState(error);
  }
}
