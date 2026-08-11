import { NextResponse } from "next/server";

import {
  acknowledgeWebsiteGrowthBuildNotification,
  claimWebsiteGrowthBuildNotification,
  type WebsiteGrowthBuildNotificationEvent
} from "@/modules/website-growth/build-notifications";
import {
  authenticateWebsiteGrowthScoutRequest,
  WebsiteGrowthScoutAuthError
} from "@/server/website-growth-scout-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { tenantSlug } = authenticateWebsiteGrowthScoutRequest(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (body?.action === "claim") {
      const workerId = readBoundedString(body.workerId, 100);
      if (!workerId) {
        return NextResponse.json({ error: "Website Growth notification workerId is required." }, { status: 400 });
      }
      const notification = await claimWebsiteGrowthBuildNotification({
        tenantSlug,
        reviewBaseUrl: new URL(request.url).origin,
        workerId
      });
      return NextResponse.json({ data: { notification } });
    }

    if (body?.action === "ack") {
      const requestId = readBoundedString(body.requestId, 100);
      const claimToken = readBoundedString(body.claimToken, 100);
      const event = readEvent(body.event);
      if (!requestId || !claimToken || !event) {
        return NextResponse.json({ error: "Website Growth notification acknowledgement is invalid." }, { status: 400 });
      }
      const acknowledged = await acknowledgeWebsiteGrowthBuildNotification({
        tenantSlug,
        requestId,
        event,
        claimToken
      });
      if (!acknowledged) {
        return NextResponse.json({ error: "Website Growth notification claim was not found." }, { status: 409 });
      }
      return NextResponse.json({ data: { acknowledged: true } });
    }

    return NextResponse.json({ error: "Website Growth notification action is invalid." }, { status: 400 });
  } catch (error) {
    const status = error instanceof WebsiteGrowthScoutAuthError ? error.status : 502;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Website Growth notification worker failed." },
      { status }
    );
  }
}

function readEvent(value: unknown): WebsiteGrowthBuildNotificationEvent | null {
  return value === "DISPATCHED" || value === "PREVIEW_READY" || value === "FAILED"
    ? value
    : null;
}

function readBoundedString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() && value.trim().length <= maxLength
    ? value.trim()
    : null;
}
