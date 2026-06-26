import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
import { buildQuickBooksAuthorizationUrl } from "@/server/integrations/quickbooks";

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    requireAdmin(context);

    const url = new URL(request.url);
    const entity = url.searchParams.get("entity");
    if (entity !== "NEWL_WORLDWIDE" && entity !== "NEWL_USA") {
      return NextResponse.json({ error: "Use entity=NEWL_WORLDWIDE or entity=NEWL_USA." }, { status: 400 });
    }

    const authorizationUrl = buildQuickBooksAuthorizationUrl({
      tenantId: context.tenantId,
      legalEntity: entity,
      returnTo: "/settings#quickbooks"
    });

    return NextResponse.redirect(authorizationUrl, { status: 302 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to start QuickBooks connection."
      },
      { status: 500 }
    );
  }
}
