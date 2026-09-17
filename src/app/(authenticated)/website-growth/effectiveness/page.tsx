import { ModuleKey, PlatformRole } from "@prisma/client";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { getAuthenticatedContext } from "@/server/tenant-context";
import { requireModule, resolveRoleCanMutate } from "@/server/auth/authorization";
import { scoutWorkspace } from "@/modules/website-growth/scout/store";
import { loadSiteReview } from "@/modules/website-growth/scout/effectiveness";
import { scoutCompetitorEvidence } from "@/modules/website-growth/scout/learning";
import { record } from "@/modules/website-growth/scout/model";
import { EffectivenessReview } from "@/modules/website-growth/scout/effectiveness-view";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export default async function ScoutEffectivenessPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  const [review, workspace, competitors] = await Promise.all([
    loadSiteReview(context.tenantId).catch(() => null), scoutWorkspace(context.tenantId).catch(() => null), scoutCompetitorEvidence(context.tenantId)
  ]);
  const canReview = ([PlatformRole.ADMIN, PlatformRole.MANAGER] as PlatformRole[]).includes(context.role) && await resolveRoleCanMutate(context.tenantId, context.role);
  // Only public-work summaries enter this view. Publisher correspondence/recipient data stays on the workboard.
  const publicItems = (workspace?.items ?? []).filter(item => item.kind !== "RELATIONSHIP");
  const selected = [...publicItems.filter(item => item.evidence.source === "site-review"), ...publicItems.filter(item => item.evidence.source !== "site-review")].slice(0, 200);
  const items = selected.map(item => ({ ...item, history: [], evidence: { source: item.evidence.source ?? null,
    handoff: item.evidence.handoff ?? null, measurement: item.evidence.measurement ?? null, publishedAt: item.evidence.publishedAt ?? null },
    artifact: item.artifact ? { recommendation: String(record(item.artifact).recommendation ?? "").slice(0, 6000),
      limitations: String(record(item.artifact).limitations ?? "").slice(0, 3000), outcome: record(item.artifact).outcome ?? null,
      confidence: record(item.artifact).confidence ?? null } : null }));
  return <div className="space-y-6">
    <PageHeader eyebrow="Website Growth" title="Scout effectiveness review" description="Review the whole site, find the next useful opportunity, and see what delivered work achieved." />
    <nav className="flex flex-wrap gap-4 text-sm font-semibold"><Link href="/website-growth/marketing">Marketing workboard</Link><Link href="/website-growth/pages">Page briefs and previews</Link><Link href="/website-growth/backlinks">Publisher opportunities</Link><Link href="/website-growth/signals">Research signals</Link></nav>
    <EffectivenessReview review={review} items={items} canReview={canReview} workspaceAvailable={Boolean(workspace)} truncated={Boolean(workspace?.truncated || publicItems.length > selected.length)}
      mission={workspace?.mission ?? null} competitorSummary={competitors.status === "AVAILABLE" ? `${competitors.reports.filter(report => report.fresh).length} recent cached reports. Scout verifies dated public competitor sources during research.` : "No competitor reports available. Scout can research public competitors and must state the evidence gap."} />
  </div>;
}
