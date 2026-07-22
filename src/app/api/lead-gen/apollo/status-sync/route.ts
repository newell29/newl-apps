import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { runScheduledApolloStatusSync } from "@/modules/lead-gen/apollo-status-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.APOLLO_STATUS_SYNC_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "Apollo status sync requires APOLLO_STATUS_SYNC_SECRET." }, { status: 503 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!safeEquals(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized Apollo status sync request." }, { status: 401 });
  }

  if (!process.env.APOLLO_MASTER_API?.trim()) {
    return NextResponse.json({ error: "Apollo status sync requires APOLLO_MASTER_API." }, { status: 503 });
  }

  try {
    const results = await runScheduledApolloStatusSync();
    const failedTenants = results.filter((result) => result.status === "error").length;
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        tenantCount: results.length,
        totals: {
          selectedContacts: results.reduce((sum, result) => sum + result.selectedContacts, 0),
          syncedContacts: results.reduce((sum, result) => sum + result.syncedContacts, 0),
          changedContacts: results.reduce((sum, result) => sum + result.changedContacts, 0),
          failedContacts: results.reduce((sum, result) => sum + result.failedContacts, 0),
          failedTenants,
          retryCount: results.reduce((sum, result) => sum + result.retryCount, 0)
        },
        results
      },
      { status: failedTenants > 0 ? 502 : 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to run the scheduled Apollo status sync." },
      { status: 502 }
    );
  }
}

function safeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
