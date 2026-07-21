import { ModuleKey, PlatformRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  backfillQuickBooksReconciliationTransactions
} from "@/modules/invoice-automation/quickbooks-reconciliation-backfill";
import { QuickBooksPostingMappingError } from "@/modules/invoice-automation/quickbooks-posting";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type BackfillRequestBody = {
  monthsBack?: unknown;
  maxTransactionsPerType?: unknown;
};

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.QUICKBOOKS_POSTING);
    await requireMutationAccess(context);
    requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.FINANCE]);

    const body = (await request.json().catch(() => null)) as BackfillRequestBody | null;
    const summary = await backfillQuickBooksReconciliationTransactions({
      tenantId: context.tenantId,
      monthsBack: readPositiveInteger(body?.monthsBack),
      maxTransactionsPerType: readPositiveInteger(body?.maxTransactionsPerType)
    });

    await prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "invoice-automation.quickbooks-reconciliation-backfill",
        entityType: "InvoiceAutomationQuickBooksTransaction",
        after: summary
      }
    });

    revalidatePath("/finance/invoice-automation/reconciliation");
    return NextResponse.json(summary);
  } catch (error) {
    console.error(error);
    if (error instanceof QuickBooksPostingMappingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to refresh QuickBooks reconciliation records." },
      { status: 500 }
    );
  }
}

function readPositiveInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}
