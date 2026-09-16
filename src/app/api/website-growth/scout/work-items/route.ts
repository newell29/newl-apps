import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { authenticateWebsiteGrowthScoutRequest, WebsiteGrowthScoutAuthError } from "@/server/website-growth-scout-auth";
import { claimScoutWork, completeScoutWork, reconcileScoutWork, scoutWorkContext, scoutWorkspace } from "@/modules/website-growth/scout/store";
import { isDue, record, ScoutWorkError, text } from "@/modules/website-growth/scout/model";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const { tenantSlug } = authenticateWebsiteGrowthScoutRequest(request);
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    if (!tenant) throw new ScoutWorkError("Scout tenant was not found.", 404);
    const access = await prisma.tenantModuleAccess.findFirst({ where: { tenantId: tenant.id, enabled: true, module: { key: "WEBSITE_GROWTH" } }, select: { id: true } });
    if (!access) throw new ScoutWorkError("Website Growth is disabled for this tenant.", 403);
    const raw = await request.text();
    if (raw.length > 120_000) throw new ScoutWorkError("Scout request is too large.", 413);
    const input = record(JSON.parse(raw));
    if (input.action === "prepare") {
      const saved = await scoutWorkspace(tenant.id);
      const workspace = saved.mission.enabled ? await reconcileScoutWork(tenant.id) : saved;
      // Selection needs summaries, not every saved artifact. Fetch full evidence only after a scoped claim.
      const due = workspace.capacity.available ? workspace.items.filter(item => isDue(item)).slice(0, 50) : [];
      const decisions = workspace.items.filter(item => ["DONE", "DISMISSED"].includes(item.state) && item.kind !== "RELATIONSHIP").slice(0, 20);
      const items = [...due, ...decisions].map(item => ({ id: item.id, kind: item.kind, state: item.state,
        title: item.title.slice(0, 250), hypothesis: item.hypothesis.slice(0, 800), nextAction: item.nextAction.slice(0, 500), lease: null,
        history: item.history.slice(-3).map(event => ({ ...event, summary: event.summary.slice(0, 300) })) }));
      return NextResponse.json({ data: { mission: workspace.mission, configured: workspace.configured,
        capacity: workspace.capacity, truncated: workspace.truncated, items, due: due.map(item => item.id) } });
    }
    const id = text(input.id, "Work ID", 100);
    if (input.action === "claim") return NextResponse.json({ data: await claimScoutWork(tenant.id, id, text(input.reason, "Selection reason", 1500)) });
    const lease = text(input.lease, "Research lease", 100);
    if (input.action === "context") return NextResponse.json({ data: await scoutWorkContext(tenant.id, id, lease) });
    if (input.action === "complete") return NextResponse.json({ data: await completeScoutWork(tenant.id, id, lease, input.result) });
    throw new ScoutWorkError("Unsupported Scout action.");
  } catch (error) {
    const known = error instanceof ScoutWorkError || error instanceof WebsiteGrowthScoutAuthError;
    return NextResponse.json({ error: known ? error.message : "Scout could not complete this step. Saved progress is preserved." }, { status: known ? error.status : 503 });
  }
}
