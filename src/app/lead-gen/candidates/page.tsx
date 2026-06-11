import { PageHeader } from "@/components/page-header";
import { StageBadge } from "@/components/stage-badge";
import { getCandidateFeed } from "@/modules/lead-gen/queries";
import { getCurrentTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function CandidateFeedPage() {
  const tenant = await getCurrentTenantContext();
  const candidates = await getCandidateFeed(tenant);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lead Generation"
        title="Candidate Feed"
        description="Scored company candidates ready for review before Apollo enrichment."
      />

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-accentSoft px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Ranked prospects</p>
          <span className="rounded-full border border-primary/25 bg-card px-2.5 py-1 text-xs font-semibold text-primary">
            {candidates.length.toLocaleString("en-US")} companies
          </span>
        </div>
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Domain</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Stage</th>
              <th className="px-4 py-3">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {candidates.map((candidate) => (
              <tr key={candidate.id} className="transition-colors hover:bg-muted/60">
                <td className="px-4 py-3 font-medium text-foreground">{candidate.companyName}</td>
                <td className="px-4 py-3 text-mutedForeground">{candidate.domain ?? "Unknown"}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                    {candidate.priorityScore}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StageBadge stage={candidate.stage} />
                </td>
                <td className="px-4 py-3 text-mutedForeground">{candidate.source ?? "sample"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
