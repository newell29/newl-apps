import { NextResponse } from "next/server";
import { ModuleKey } from "@prisma/client";
import { getUpsQuote } from "@/server/integrations/ups";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
import { getUpsToolsShell } from "@/modules/ups-tools/queries";
import { inferCountryFromPostalCode } from "@/modules/ups-tools/engine";
import type { QuoteRequest, UpsServiceName } from "@/modules/ups-tools/types";

export const dynamic = "force-dynamic";

type InputRow = {
  OriginZIP?: string;
  DestinationZIP?: string;
  Weight?: string;
  Length?: string;
  Width?: string;
  Height?: string;
};

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.UPS_TOOLS);
    const shell = await getUpsToolsShell(context);
    const body = (await request.json()) as {
      accountIds?: string[];
      services?: UpsServiceName[];
      isResidential?: boolean;
      rows?: InputRow[];
    };

    const accountIds = body.accountIds ?? [];
    const services = body.services ?? [];
    const rows = body.rows ?? [];
    const selectedAccounts = shell.accounts.filter((account) => accountIds.includes(account.id));

    if (selectedAccounts.length === 0) {
      return NextResponse.json({ error: "Select at least one account." }, { status: 400 });
    }

    if (services.length === 0) {
      return NextResponse.json({ error: "Select at least one service." }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "Upload or load shipment rows first." }, { status: 400 });
    }

    const quotes = [];

    for (const account of selectedAccounts) {
      for (const row of rows) {
        const destinationPostalCode = (row.DestinationZIP ?? "").trim();
        const originPostalCode = (row.OriginZIP ?? account.originPostalCode).trim();
        const weight = Number.parseFloat(row.Weight ?? "0");
        const length = Number.parseFloat(row.Length ?? "0") || 0;
        const width = Number.parseFloat(row.Width ?? "0") || 0;
        const height = Number.parseFloat(row.Height ?? "0") || 0;

        if (!destinationPostalCode || Number.isNaN(weight)) {
          continue;
        }

        for (const service of services) {
          const quoteRequest: QuoteRequest = {
            originPostalCode,
            originCountryCode: inferCountryFromPostalCode(originPostalCode),
            destinationPostalCode,
            destinationCountryCode: inferCountryFromPostalCode(destinationPostalCode),
            weight,
            length,
            width,
            height,
            service,
            isResidential: Boolean(body.isResidential)
          };

          quotes.push(await getUpsQuote(account, quoteRequest));
        }
      }
    }

    return NextResponse.json({
      data: quotes
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected UPS quote error."
      },
      { status: 500 }
    );
  }
}
