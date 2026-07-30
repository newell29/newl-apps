import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireAdmin, requireModule } from "@/server/auth/authorization";
import {
  diagnoseApolloPeopleDirectoryForSavedAccount,
  fetchApolloContactsForCompany
} from "@/server/integrations/apollo";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const context = await getAuthenticatedContext();
  requireAdmin(context);
  await requireModule(context, ModuleKey.LEAD_GEN);

  if (new URL(request.url).searchParams.get("inspect") === "1") {
    const result = await diagnoseApolloPeopleDirectoryForSavedAccount({
      apolloAccountId: "6888f2e0496bf40001170587",
      expectedApolloPersonId: "6138684489ec360001a60945"
    });
    return NextResponse.json(result);
  }

  return new NextResponse(
    [
      "<!doctype html>",
      '<html lang="en"><body>',
      '<form method="post">',
      '<button type="submit">Run one-credit YAT verification</button>',
      "</form>",
      "</body></html>"
    ].join(""),
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      }
    }
  );
}

export async function POST() {
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
        domain: "yattool.com",
        apolloAccountId: "6888f2e0496bf40001170587"
      },
      {
        allowPeopleSearchFallback: true,
        authorizePaidEmailEnrichment: true,
        explicitApolloPersonIds: ["6138684489ec360001a60945"]
      }
    );

    return NextResponse.json({
      count: result.contacts.length,
      matchReason: result.match.matchReason,
      contacts: result.contacts.map((contact) => ({
        apolloPersonId: contact.apolloPersonId,
        fullName: contact.fullName,
        title: contact.title,
        hasEmailAvailable: contact.hasEmailAvailable,
        hasConcreteEmail: Boolean(contact.email)
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
