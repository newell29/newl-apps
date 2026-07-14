import { NextResponse } from "next/server";

import { createWeeklyWebsiteGrowthPlansForEnabledTenants } from "@/modules/website-growth/weekly-plan";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const syncSecret = process.env.WEBSITE_GROWTH_WEEKLY_SECRET?.trim() || process.env.CRON_SECRET?.trim();

  if (!syncSecret) {
    return NextResponse.json(
      {
        enabled: false,
        scheduled: false,
        cadence: "weekly",
        message: "Website Growth weekly planner requires WEBSITE_GROWTH_WEEKLY_SECRET or CRON_SECRET before cron requests can run."
      },
      { status: 503 }
    );
  }

  const requestHeaders = new Headers(request.headers);
  const authorization = requestHeaders.get("authorization") ?? "";
  const headerSecret = requestHeaders.get("x-newl-cron-secret") ?? "";
  const bearerSecret = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";

  if (![bearerSecret, headerSecret].includes(syncSecret)) {
    return NextResponse.json({ error: "Unauthorized Website Growth weekly planner request." }, { status: 401 });
  }

  try {
    const results = await createWeeklyWebsiteGrowthPlansForEnabledTenants();

    return NextResponse.json({
      results,
      tenantCount: results.length,
      totalReviewedCount: results.reduce((sum, result) => sum + result.reviewedCount, 0),
      totalSelectedCount: results.reduce((sum, result) => sum + result.selectedCount, 0),
      generatedAt: new Date().toISOString(),
      cron: {
        enabled: true,
        scheduled: true,
        cadence: "weekly",
        note: "This prepares weekly SEO recommendations for approval. It does not publish website content."
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to run Website Growth weekly planner." },
      { status: 502 }
    );
  }
}
