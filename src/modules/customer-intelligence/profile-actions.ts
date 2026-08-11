"use server";

import { ContactStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { updateContactDetails } from "@/modules/customer-intelligence/actions";
import type { ProfileActionState } from "@/modules/customer-intelligence/profile-action-state";
import { getAuthenticatedContext } from "@/server/tenant-context";

/**
 * Server actions for the Customer Profile UI (CP-PHASE-02B-4). These are thin,
 * guarded wrappers: authorization (requireMatchApproval + requireWrite),
 * tenant validation, and audit logging all live in the core actions in
 * actions.ts. A visible edit control never substitutes for server-side
 * enforcement, and SALES / OPERATIONS / READ_ONLY remain excluded.
 */

function errorState(error: unknown): ProfileActionState {
  return {
    status: "error",
    message: error instanceof Error ? error.message : "Contact update failed."
  };
}

/**
 * Form field extraction that preserves the core action's undefined-vs-null
 * contract: a field absent from the form is `undefined` (keep the stored
 * value), a field submitted with whitespace only is `null` (clear it), and a
 * submitted value is trimmed. This prevents a partial form submission (for
 * example only a contact-status change) from silently clearing fields the
 * form did not carry.
 */
function submittedField(formData: FormData, name: string): string | null | undefined {
  const value = formData.get(name);
  if (value === null) {
    return undefined;
  }
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Manual correction of one contact's details from the company profile page.
 * Only submitted form fields are applied; the core action derives the required
 * `fullName` from first/last name and records an AuditLog entry.
 */
export async function updateContactDetailsAction(
  _previousState: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  try {
    const context = await getAuthenticatedContext();
    const contactId = String(formData.get("contactId") ?? "").trim();
    const companyId = String(formData.get("companyId") ?? "").trim();
    if (!contactId || !companyId) {
      throw new Error("Contact and company are required.");
    }

    const contactStatusRaw = String(formData.get("contactStatus") ?? "").trim();
    // A nonempty contact-status value must be a recognized status; an unknown
    // value is rejected with an error state and no writes rather than silently
    // ignored (which would report success while retaining the old status).
    let contactStatus: ContactStatus | undefined;
    if (contactStatusRaw.length > 0) {
      if (!Object.values(ContactStatus).includes(contactStatusRaw as ContactStatus)) {
        throw new Error("Unrecognized contact status value.");
      }
      contactStatus = contactStatusRaw as ContactStatus;
    }

    await updateContactDetails(context, {
      contactId,
      companyId,
      firstName: submittedField(formData, "firstName"),
      lastName: submittedField(formData, "lastName"),
      title: submittedField(formData, "title"),
      department: submittedField(formData, "department"),
      email: submittedField(formData, "email"),
      phone: submittedField(formData, "phone"),
      contactStatus
    });

    revalidatePath(`/customer-intelligence/companies/${companyId}`);
    return { status: "success", message: "Contact details updated." };
  } catch (error) {
    return errorState(error);
  }
}
