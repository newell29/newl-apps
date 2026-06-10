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
              <tr key={candidate.id} className="hover:bg-muted/60">
                <td className="px-4 py-3 font-medium text-foreground">{candidate.companyName}</td>
                <td className="px-4 py-3 text-mutedForeground">{candidate.domain ?? "Unknown"}</td>
                <td className="px-4 py-3 text-mutedForeground">{candidate.priorityScore}</td>
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
