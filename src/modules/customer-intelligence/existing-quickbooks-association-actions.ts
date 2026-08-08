"use server";

import { revalidatePath } from "next/cache";

import { associateQuickBooksCredential } from "@/modules/customer-intelligence/actions";
import { resolveExistingQuickBooksAssociations } from "@/modules/customer-intelligence/existing-quickbooks-association";
import {
  EXISTING_QUICKBOOKS_ASSOCIATION_CONFIRMATION,
  type ExistingQuickBooksAssociationActionState
} from "@/modules/customer-intelligence/existing-quickbooks-association-state";
import { getAuthenticatedContext } from "@/server/tenant-context";

export async function associateExistingQuickBooksConnectionAction(
  _previousState: ExistingQuickBooksAssociationActionState,
  formData: FormData
): Promise<ExistingQuickBooksAssociationActionState> {
  const operatingCompanyId = String(formData.get("operatingCompanyId") ?? "").trim();
  const confirmation = String(formData.get("confirmation") ?? "");
  if (!operatingCompanyId || confirmation !== EXISTING_QUICKBOOKS_ASSOCIATION_CONFIRMATION) {
    return { status: "error", message: "Explicit confirmation is required." };
  }

  try {
    const ctx = await getAuthenticatedContext();
    const resolved = await resolveExistingQuickBooksAssociations(ctx);
    const match = resolved.find((option) => option.operatingCompanyId === operatingCompanyId);
    if (!match || match.status !== "AVAILABLE" || !match.candidate) {
      return {
        status: "error",
        message: "The existing connection is no longer an exact, unclaimed match. Refresh and review the status."
      };
    }

    await associateQuickBooksCredential(ctx, {
      operatingCompanyId,
      quickBooksCredentialId: match.candidate.id,
      quickBooksRealmId: match.candidate.realmId
    });
    revalidatePath("/settings");
    revalidatePath("/customer-intelligence/review");
    return {
      status: "success",
      message: "Existing QuickBooks connection associated. Tokens and synchronization settings were not changed."
    };
  } catch {
    return {
      status: "error",
      message: "The connection could not be associated safely. No credential was changed."
    };
  }
}
