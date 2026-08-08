"use client";

import { ContactStatus } from "@prisma/client";
import { useActionState } from "react";

import {
  EMPTY_PROFILE_ACTION_STATE,
  type ProfileActionState
} from "@/modules/customer-intelligence/profile-action-state";
import { updateContactDetailsAction } from "@/modules/customer-intelligence/profile-actions";

type ContactEditFormAction = (
  previousState: ProfileActionState,
  formData: FormData
) => Promise<ProfileActionState>;

function formatContactStatus(status: ContactStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Guarded manual contact-detail edit control for the Customer Profile UI
 * (CP-PHASE-02B-4). Presentation only: ADMIN/FINANCE authorization, tenant
 * validation, full-name derivation, and audit logging are enforced by the core
 * `updateContactDetails` action. The panel is rendered only for users that pass
 * the server-side `requireMatchApproval` check on the profile page, but that
 * visibility never substitutes for the server-side mutation guard.
 */
export function ContactEditPanel({
  contactId,
  companyId,
  firstName,
  lastName,
  title,
  department,
  email,
  phone,
  contactStatus
}: {
  contactId: string;
  companyId: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  contactStatus: ContactStatus;
}) {
  const [state, formAction, pending] = useActionState(
    updateContactDetailsAction as ContactEditFormAction,
    EMPTY_PROFILE_ACTION_STATE
  );

  return (
    <form action={formAction} className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="companyId" value={companyId} />
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
        Edit contact details
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-xs font-medium text-foreground">
          <span>First name</span>
          <input
            name="firstName"
            defaultValue={firstName ?? ""}
            maxLength={100}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="block space-y-1 text-xs font-medium text-foreground">
          <span>Last name</span>
          <input
            name="lastName"
            defaultValue={lastName ?? ""}
            maxLength={100}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="block space-y-1 text-xs font-medium text-foreground">
          <span>Job title</span>
          <input
            name="title"
            defaultValue={title ?? ""}
            maxLength={200}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="block space-y-1 text-xs font-medium text-foreground">
          <span>Department</span>
          <input
            name="department"
            defaultValue={department ?? ""}
            maxLength={200}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="block space-y-1 text-xs font-medium text-foreground">
          <span>Email</span>
          <input
            name="email"
            type="email"
            defaultValue={email ?? ""}
            maxLength={320}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="block space-y-1 text-xs font-medium text-foreground">
          <span>Phone</span>
          <input
            name="phone"
            defaultValue={phone ?? ""}
            maxLength={64}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
      </div>
      <label className="block space-y-1 text-xs font-medium text-foreground">
        <span>Contact status</span>
        <select
          name="contactStatus"
          defaultValue={contactStatus}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          {Object.values(ContactStatus).map((status) => (
            <option key={status} value={status}>
              {formatContactStatus(status)}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3">
        <button
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save contact"}
        </button>
        <p className="text-xs leading-5 text-mutedForeground">
          Every manual correction is tenant-scoped and audited.
        </p>
      </div>
      {state.message ? (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-xs leading-5 ${
            state.status === "error"
              ? "border-danger/30 bg-danger/10 text-danger"
              : "border-success/30 bg-success/10 text-foreground"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
