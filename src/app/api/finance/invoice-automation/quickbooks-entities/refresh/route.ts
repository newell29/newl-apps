import { ModuleKey, PlatformRole } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  getInvoiceAutomationQuickBooksSyncSummary,
  isQuickBooksCredentialDecryptError,
  refreshInvoiceAutomationQuickBooksEntityCache
} from "@/modules/invoice-automation/quickbooks-entities";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function POST() {
  let context: Awaited<ReturnType<typeof getAuthenticatedContext>> | null = null;
  try {
    context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.INVOICE_VERIFICATION);
    await requireMutationAccess(context);
    requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.OPERATIONS, PlatformRole.FINANCE]);

    const summary = await refreshInvoiceAutomationQuickBooksEntityCache(context);
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    if (context && isQuickBooksCredentialDecryptError(error)) {
      const summary = await getInvoiceAutomationQuickBooksSyncSummary(context, [
        "QuickBooks needs to be reconnected in Settings because the saved token can no longer be decrypted."
      ]);
      return NextResponse.json({ ok: true, summary });
    }

    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to refresh QuickBooks customer/vendor names." },
      { status: 500 }
    );
  }
}
