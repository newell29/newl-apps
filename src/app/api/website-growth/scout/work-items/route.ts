import { loadSiteReview, refreshSiteReview } from "@/modules/website-growth/scout/effectiveness";
import { effectivenessPacket } from "@/modules/website-growth/scout/effectiveness-model";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { authenticateWebsiteGrowthScoutRequest, WebsiteGrowthScoutAuthError } from "@/server/website-growth-scout-auth";
import { claimScoutWork, completeScoutWork, reconcileScoutWork, recordScoutWake, scoutWorkContext, scoutWorkspace } from "@/modules/website-growth/scout/store";
import { record, ScoutWorkError, text } from "@/modules/website-growth/scout/model";
import { scoutCandidates, scoutCompetitorEvidence, scoutOutcomes } from "@/modules/website-growth/scout/learning";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  let action = "unknown";
  try {
    const { tenantSlug } = authenticateWebsiteGrowthScoutRequest(request);
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    if (!tenant) throw new ScoutWorkError("Scout tenant was not found.", 404);
    const access = await prisma.tenantModuleAccess.findFirst({ where: { tenantId: tenant.id, enabled: true, module: { key: "WEBSITE_GROWTH" } }, select: { id: true } });
    if (!access) throw new ScoutWorkError("Website Growth is disabled for this tenant.", 403);
    const raw = await request.text();
    if (raw.length > 120_000) throw new ScoutWorkError("Scout request is too large.", 413);
    const input = record(JSON.parse(raw));
    action = typeof input.action === "string" ? input.action.slice(0, 40) : "unknown";
    if (input.action === "prepare") {
      const wakeId = input.wakeId === undefined ? randomUUID() : text(input.wakeId, "Wake ID", 100);
      const saved = await scoutWorkspace(tenant.id);
      const review = saved.mission.enabled ? await refreshSiteReview(tenant.id).catch(() => loadSiteReview(tenant.id).catch(() => null)) : null;
      const workspace = saved.mission.enabled ? await reconcileScoutWork(tenant.id) : saved;
      // Selection needs summaries, not every saved artifact. Fetch full evidence only after a scoped claim.
      const due = workspace.capacity.available ? scoutCandidates(workspace.items) : [];
      const decisions = workspace.items.filter(item => ["DONE", "DISMISSED"].includes(item.state) && item.kind !== "RELATIONSHIP").slice(0, 20);
      const items = [...due, ...decisions].map(item => ({ id: item.id, kind: item.kind, state: item.state,
        priorityReason: item.evidence.source === "authority-campaign" && item.evidence.replyKey ? "Publisher reply: finish the concrete next action before new discovery." : null,
        title: item.title.slice(0, 250), hypothesis: item.hypothesis.slice(0, 800), nextAction: item.nextAction.slice(0, 500), lease: null,
        history: item.history.slice(-3).map(event => ({ ...event, summary: event.summary.slice(0, 300) })) }));
      const idleReason = !workspace.mission.enabled ? "Research is paused by the owner."
        : workspace.capacity.usedSteps >= workspace.mission.dailySteps ? "The rolling daily research budget is used; Scout will resume as earlier steps leave the 24-hour window."
        : workspace.capacity.active >= workspace.mission.maxActive ? "The active-work limit is reached. Finish the current research or resolve the decisions shown on the workboard."
        : !due.length ? "No research is due. Scout is waiting for a scheduled review or an external system." : null;
      await recordScoutWake(tenant.id, wakeId, { missionEnabled: workspace.mission.enabled, dueCount: due.length,
        usedSteps: workspace.capacity.usedSteps, dailySteps: workspace.mission.dailySteps,
        active: workspace.capacity.active, maxActive: workspace.mission.maxActive, idleReason });
      return NextResponse.json({ data: { mission: workspace.mission, configured: workspace.configured,
        capacity: workspace.capacity, truncated: workspace.truncated, idleReason, items, due: due.map(item => item.id),
        learning: due.length ? { outcomes: scoutOutcomes(workspace.items), competitors: await scoutCompetitorEvidence(tenant.id), effectiveness: effectivenessPacket(review) } : null } });
    }
    const id = text(input.id, "Work ID", 100);
    if (input.action === "claim") {
      // The generated fallback keeps an older deployed worker compatible during a staggered application/runtime rollout.
      const claimId = input.claimId === undefined ? randomUUID() : text(input.claimId, "Claim ID", 100);
      return NextResponse.json({ data: await claimScoutWork(tenant.id, id, text(input.reason, "Selection reason", 1500), claimId) });
    }
    const lease = text(input.lease, "Research lease", 100);
    if (input.action === "context") return NextResponse.json({ data: await scoutWorkContext(tenant.id, id, lease) });
    if (input.action === "complete") return NextResponse.json({ data: await completeScoutWork(tenant.id, id, lease, input.result) });
    throw new ScoutWorkError("Unsupported Scout action.");
  } catch (error) {
    const known = error instanceof ScoutWorkError || error instanceof WebsiteGrowthScoutAuthError;
    if (!known) {
      const details = record(error);
      console.error("Scout work-item request failed", {
        action,
        errorType: error instanceof Error ? error.name : "UnknownError",
        errorCode: typeof details.code === "string" ? details.code.slice(0, 32) : undefined
      });
    }
    return NextResponse.json(
      { error: known ? error.message : "Scout could not complete this step. Saved progress is preserved." },
      { status: known ? error.status : 503, headers: known ? undefined : { "Retry-After": "1" } }
    );
  }
}
