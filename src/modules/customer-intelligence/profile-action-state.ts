/**
 * Shared action-state contract for the Customer Profile UI server actions
 * (CP-PHASE-02B-4). Kept in a plain module so both the "use server" action
 * wrappers and the client contact-edit controls can import it without
 * violating the server-action export rules.
 */
export type ProfileActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

export const EMPTY_PROFILE_ACTION_STATE: ProfileActionState = { status: "idle" };
