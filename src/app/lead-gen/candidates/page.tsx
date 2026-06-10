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

      <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        <table className="min-w-full divide-y divide-line text-sm">
          <thead className="bg-panel text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Domain</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Stage</th>
              <th className="px-4 py-3">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {candidates.map((candidate) => (
              <tr key={candidate.id}>
                <td className="px-4 py-3 font-medium text-ink">{candidate.companyName}</td>
                <td className="px-4 py-3 text-slate-600">{candidate.domain ?? "Unknown"}</td>
                <td className="px-4 py-3 text-slate-600">{candidate.priorityScore}</td>
                <td className="px-4 py-3">
                  <StageBadge stage={candidate.stage} />
                </td>
                <td className="px-4 py-3 text-slate-600">{candidate.source ?? "sample"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
