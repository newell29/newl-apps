import { NextResponse } from "next/server";
import { ModuleKey } from "@prisma/client";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
import { getLtlRatePortalShell } from "@/modules/ltl-rate-portal/queries";
import { getLtlQuotes } from "@/server/integrations/seven-l";
import type { LtlRateQuoteRequestPayload } from "@/modules/ltl-rate-portal/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.LTL_RATE_PORTAL);
    await requireMutationAccess(context);

    const shell = await getLtlRatePortalShell(context);
    const body = (await request.json()) as Partial<LtlRateQuoteRequestPayload>;
    const accountId = typeof body.accountId === "string" ? body.accountId : "";
    const carrierHashes = Array.isArray(body.carrierHashes)
      ? body.carrierHashes.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (!accountId) {
      return NextResponse.json({ error: "Select a 7L account." }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "Upload at least one valid lane." }, { status: 400 });
    }

    if (carrierHashes.length === 0) {
      return NextResponse.json({ error: "Select at least one carrier for this pull." }, { status: 400 });
    }

    const account = shell.accounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      return NextResponse.json({ error: "The selected 7L account is not available for this tenant." }, { status: 404 });
    }

    const response = await getLtlQuotes(account, rows, carrierHashes);
    return NextResponse.json(response);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected 7L quote error."
      },
      { status: 500 }
    );
  }
}
