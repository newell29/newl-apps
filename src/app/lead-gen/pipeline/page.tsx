import { PageHeader } from "@/components/page-header";
import { StageBadge } from "@/components/stage-badge";
import { getLeadPipeline } from "@/modules/lead-gen/queries";
import { getCurrentTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const tenant = await getCurrentTenantContext();
  const leads = await getLeadPipeline(tenant);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lead Generation"
        title="Pipeline"
        description="Internal pipeline view for reviewed companies, contacts, and outreach status."
      />

      <div className="grid gap-4 xl:grid-cols-3">
        {leads.map((lead) => (
          <article key={lead.id} className="rounded-lg border border-line bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-ink">{lead.companyName}</h2>
                <p className="mt-1 text-sm text-slate-500">{lead.contactName ?? "No contact yet"}</p>
              </div>
              <StageBadge stage={lead.stage} />
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span>Score {lead.score}</span>
              <span>{lead.updatedAt.toLocaleDateString("en-US")}</span>
            </div>
            {lead.notes ? <p className="mt-3 text-sm leading-6 text-slate-600">{lead.notes}</p> : null}
          </article>
        ))}
      </div>
    </div>
  );
}
