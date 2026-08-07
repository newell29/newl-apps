import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
import {
  buildQuickBooksAuthorizationUrl,
  isQuickBooksOperatingCompanySlug
} from "@/server/integrations/quickbooks";

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    requireAdmin(context);

    const url = new URL(request.url);
    const entity = url.searchParams.get("entity");
    // Operating-company-keyed connect (CP-02B-1-Q1): the stable slug is the
    // internal key for all three operating companies. The two legacy enum keys
    // are intentionally rejected; existing stored connections are unaffected
    // because the callback bridges slug -> stored legalEntity on write.
    if (!entity || !isQuickBooksOperatingCompanySlug(entity)) {
      return NextResponse.json(
        {
          error:
            "Use entity=newl-worldwide, entity=newl-usa, or entity=newells-express."
        },
        { status: 400 }
      );
    }

    const authorizationUrl = buildQuickBooksAuthorizationUrl({
      tenantId: context.tenantId,
      operatingCompanySlug: entity,
      returnTo: "/settings"
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
