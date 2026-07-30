import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireAdmin, requireModule } from "@/server/auth/authorization";
import { fetchApolloContactsForCompany } from "@/server/integrations/apollo";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const context = await getAuthenticatedContext();
    requireAdmin(context);
    await requireModule(context, ModuleKey.LEAD_GEN);

    const result = await fetchApolloContactsForCompany(
      {
        companyName: "YAT USA, INC.",
        apolloAccountId: "6888f2e0496bf40001170587"
      },
      {
        allowPeopleSearchFallback: true,
        authorizePaidEmailEnrichment: false
      }
    );

    return NextResponse.json({
      count: result.contacts.length,
      matchReason: result.match.matchReason,
      contacts: result.contacts.map((contact) => ({
        apolloPersonId: contact.apolloPersonId,
        fullName: contact.fullName,
        title: contact.title,
        hasEmailAvailable: contact.hasEmailAvailable
      }))
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Apollo preview diagnostic failed."
      },
      { status: 500 }
    );
  }
}
