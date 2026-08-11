"use server";

import { revalidatePath } from "next/cache";

import { associateQuickBooksCredential } from "@/modules/customer-intelligence/actions";
import { QuickBooksAssociationError } from "@/modules/customer-intelligence/quickbooks-association-error";
import { resolveExistingQuickBooksAssociations } from "@/modules/customer-intelligence/existing-quickbooks-association";
import {
  EXISTING_QUICKBOOKS_ASSOCIATION_CONFIRMATION,
  type ExistingQuickBooksAssociationActionState
} from "@/modules/customer-intelligence/existing-quickbooks-association-state";
import { AuthorizationError } from "@/server/auth/authorization";
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

  let ctx: Awaited<ReturnType<typeof getAuthenticatedContext>>;
  try {
    ctx = await getAuthenticatedContext();
  } catch {
    return {
      status: "error",
      code: "AUTHENTICATION_FAILED",
      message: "AUTHENTICATION_FAILED: Sign in again before retrying."
    };
  }

  let resolved: Awaited<ReturnType<typeof resolveExistingQuickBooksAssociations>>;
  try {
    resolved = await resolveExistingQuickBooksAssociations(ctx);
  } catch {
    return {
      status: "error",
      code: "LOOKUP_FAILED",
      message: "LOOKUP_FAILED: The current connection state could not be checked safely."
    };
  }

  try {
    const match = resolved.find((option) => option.operatingCompanyId === operatingCompanyId);
    if (!match || match.status !== "AVAILABLE" || !match.candidate) {
      return {
        status: "error",
        code: "STALE_MATCH",
        message: "STALE_MATCH: The connection is no longer an exact, unclaimed match. Refresh and review the status."
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
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        status: "error",
        code: "PERMISSION_DENIED",
        message: "PERMISSION_DENIED: Administrator mutation access is required."
      };
    }
    if (error instanceof QuickBooksAssociationError) {
      return {
        status: "error",
        code: error.code,
        message: `${error.code}: ${error.message}`
      };
    }
    return {
      status: "error",
      code: "UNEXPECTED_FAILURE",
      message: "UNEXPECTED_FAILURE: The connection could not be associated safely. No credential was changed."
    };
  }
}
