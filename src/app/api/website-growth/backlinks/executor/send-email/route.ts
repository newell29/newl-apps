import {
  WebsiteGrowthOutreachConsentBasis,
  WebsiteGrowthOutreachMessageKind
} from "@prisma/client";
import { NextResponse } from "next/server";

import { sendWebsiteGrowthOutreachEmail } from "@/modules/website-growth/backlink-outreach";
import { prisma } from "@/server/db";
import {
  authenticateWebsiteGrowthBacklinkExecutorRequest,
  WebsiteGrowthBacklinkExecutorAuthError
} from "@/server/website-growth-backlink-executor-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { tenantSlug } = authenticateWebsiteGrowthBacklinkExecutorRequest(request);
    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true }
    });
    if (!tenant) {
      return NextResponse.json(
        { error: "Backlink executor tenant was not found." },
        { status: 404 }
      );
    }
    const body = (await request.json()) as Record<string, unknown>;
    const kind = readEnum(body.kind, WebsiteGrowthOutreachMessageKind, "message kind");
    const consentBasis = readEnum(
      body.consentBasis,
      WebsiteGrowthOutreachConsentBasis,
      "consent basis"
    );
    const recipientCountry =
      body.recipientCountry === "CA" || body.recipientCountry === "US"
        ? body.recipientCountry
        : null;
    if (!recipientCountry) {
      throw new Error("Recipient country must be CA or US.");
    }

    const result = await sendWebsiteGrowthOutreachEmail({
      tenantId: tenant.id,
      input: {
        opportunityId: readString(body.opportunityId, "opportunityId"),
        kind,
        recipientName:
          typeof body.recipientName === "string" ? body.recipientName : null,
        recipientEmail: readString(body.recipientEmail, "recipientEmail"),
        recipientCountry,
        contactSourceUrl: readString(body.contactSourceUrl, "contactSourceUrl"),
        consentBasis,
        subject: readString(body.subject, "subject"),
        body: readString(body.body, "body")
      }
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    const status =
      error instanceof WebsiteGrowthBacklinkExecutorAuthError
        ? error.status
        : error instanceof SyntaxError
          ? 400
          : 422;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Backlink outreach send failed."
      },
      { status }
    );
  }
}

function readString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function readEnum<T extends Record<string, string>>(
  value: unknown,
  enumObject: T,
  label: string
) {
  if (
    typeof value === "string" &&
    Object.values(enumObject).includes(value)
  ) {
    return value as T[keyof T];
  }
  throw new Error(`Backlink outreach ${label} is invalid.`);
}
