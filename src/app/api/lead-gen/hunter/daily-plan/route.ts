import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { runDueHunterDryPlans } from "@/modules/lead-gen/hunter-planner";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      {
        enabled: false,
        message: "Hunter daily planning requires the existing CRON_SECRET."
      },
      { status: 503 }
    );
  }
  const authorization = request.headers.get("authorization") ?? "";
  if (!safeEquals(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized Hunter daily planning request." }, { status: 401 });
  }

  const results = await runDueHunterDryPlans();
  const failedCount = results.filter((result) => result.state === "failed").length;
  return NextResponse.json(
    {
      results,
      tenantCount: results.length,
      completedCount: results.filter((result) => result.state === "completed").length,
      skippedCount: results.filter((result) => result.state === "skipped").length,
      failedCount,
      generatedAt: new Date().toISOString(),
      note: "Dry run only. No Apollo or customer communication writes are performed."
    },
    { status: failedCount > 0 ? 502 : 200 }
  );
}

function safeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
