/**
 * Shared action-state contract for the Customer Intelligence identity review
 * queue (CP-PHASE-02B-3). Kept in a plain module so both the "use server"
 * action wrappers and the client review controls can import it without
 * violating the server-action export rules.
 */
export type IdentityReviewActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

export const EMPTY_IDENTITY_REVIEW_ACTION_STATE: IdentityReviewActionState = { status: "idle" };
