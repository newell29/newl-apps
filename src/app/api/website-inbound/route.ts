import { NextResponse } from "next/server";

import { prisma } from "@/server/db";
import { summarizeWebsiteInboundFields } from "@/modules/website-inbound/summary";
import type { WebsiteInboundSubmissionInput } from "@/modules/website-inbound/types";

export const runtime = "nodejs";

function isAuthorized(request: Request) {
  const token = process.env.WEBSITE_INBOUND_API_TOKEN;

  if (!token) {
    return process.env.NODE_ENV !== "production";
  }

  return (
    request.headers.get("authorization") === `Bearer ${token}` ||
    request.headers.get("x-newl-inbound-key") === token
  );
}

function sanitizeFields(fields: Record<string, string | string[]>) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      if (Array.isArray(value)) {
        return [key, value.map((item) => item.trim()).filter(Boolean)];
      }

      return [key, value.trim()];
    })
  );
}

function isValidPayload(payload: Partial<WebsiteInboundSubmissionInput>) {
  return Boolean(
    payload &&
      typeof payload.formType === "string" &&
      payload.formType.trim() &&
      payload.fields &&
      typeof payload.fields === "object" &&
      !Array.isArray(payload.fields)
  );
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: Partial<WebsiteInboundSubmissionInput>;

  try {
    payload = (await request.json()) as Partial<WebsiteInboundSubmissionInput>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  if (!isValidPayload(payload)) {
    return NextResponse.json({ error: "Missing required website inbound fields." }, { status: 400 });
  }

  const tenantSlug =
    process.env.WEBSITE_INBOUND_TENANT_SLUG ?? process.env.DEFAULT_TENANT_SLUG ?? "newl-group";
  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: tenantSlug
    },
    select: {
      id: true
    }
  });

  if (!tenant) {
    return NextResponse.json({ error: "Inbound tenant is not configured." }, { status: 500 });
  }

  const fields = sanitizeFields(payload.fields as Record<string, string | string[]>);
  const summary = summarizeWebsiteInboundFields(fields);
  const submission = await prisma.websiteInboundSubmission.create({
    data: {
      tenantId: tenant.id,
      formType: payload.formType || "general",
      source: payload.source ?? "website",
      pageUrl: payload.pageUrl,
      fields,
      ...summary
    },
    select: {
      id: true,
      createdAt: true
    }
  });

  return NextResponse.json({ submission }, { status: 201 });
}
