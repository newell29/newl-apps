import { ModuleKey, PlatformRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { refreshInvoiceAutomationQuickBooksEntityCache } from "@/modules/invoice-automation/quickbooks-entities";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.INVOICE_VERIFICATION);
    await requireMutationAccess(context);
    requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.OPERATIONS, PlatformRole.FINANCE]);

    const summary = await refreshInvoiceAutomationQuickBooksEntityCache(context);
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to refresh QuickBooks customer/vendor names." },
      { status: 500 }
    );
  }
}
