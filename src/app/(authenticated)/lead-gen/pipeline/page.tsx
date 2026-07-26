import { LeadPipelineStage, ModuleKey } from "@prisma/client";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { updateLeadStageAction } from "@/modules/lead-gen/actions";
import {
  formatSalesOpportunityStage,
  SALES_OPPORTUNITY_STAGES
} from "@/modules/lead-gen/automation-workflow";
import {
  getLeadPipeline,
  getLeadPipelineFilters,
  type LeadPipelineSort
} from "@/modules/lead-gen/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function SalesOpportunitiesPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  const params = searchParams ? await searchParams : {};
  const stage = parseStage(readParam(params.stage));
  const ownerUserId = readParam(params.rep) || "ALL";
  const industry = readParam(params.industry) || "";
  const sort = parseSort(readParam(params.sort));
  const [allLeads, filters] = await Promise.all([
    getLeadPipeline(context, {
      scope: "SALES_OPPORTUNITIES",
      stage: "ALL",
      ownerUserId,
      industry: industry || undefined,
      sort
    }),
    getLeadPipelineFilters(context)
  ]);
  const leads = stage === "ALL"
    ? allLeads
    : allLeads.filter((lead) => lead.salesOpportunityStage === stage);

  const stageCounts = Object.fromEntries(
    SALES_OPPORTUNITY_STAGES.map((value) => [
      value,
      allLeads.filter((lead) => lead.salesOpportunityStage === value).length
    ])
  ) as Record<(typeof SALES_OPPORTUNITY_STAGES)[number], number>;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Sales Opportunities"
        description="Track only companies that have shown genuine engagement. Research and outbound preparation stay in the earlier workflow so this view remains a clean revenue pipeline."
      />

      <section className="rounded-lg border border-accentBorder bg-accentSoft p-4 text-sm text-foreground">
        <p className="font-semibold">A company enters here after a meaningful reply or meeting signal.</p>
        <p className="mt-1 text-mutedForeground">
          Hunter rankings belong in Daily Opportunities, while contact discovery, message drafts, cadence enrollment,
          and unanswered follow-ups belong in the Outreach Queue.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className="rounded-md border border-border bg-card px-3 py-1.5 font-semibold" href="/lead-gen/hunter">
            Daily Opportunities
          </Link>
          <Link className="rounded-md border border-border bg-card px-3 py-1.5 font-semibold" href="/lead-gen/outreach">
            Outreach Queue
          </Link>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {SALES_OPPORTUNITY_STAGES.map((value) => (
          <Link
            key={value}
            href={`/lead-gen/pipeline?stage=${value}`}
            className={`rounded-lg border p-4 shadow-sm ${
              stage === value ? "border-primary bg-accentSoft" : "border-border bg-card"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              {formatSalesOpportunityStage(value)}
            </p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{stageCounts[value]}</p>
          </Link>
        ))}
      </div>

      <form action="/lead-gen/pipeline" className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <Filter label="Stage">
            <select name="stage" defaultValue={stage} className={inputClass}>
              <option value="ALL">All sales stages</option>
              {SALES_OPPORTUNITY_STAGES.map((value) => (
                <option key={value} value={value}>{formatSalesOpportunityStage(value)}</option>
              ))}
            </select>
          </Filter>
          <Filter label="Owner">
            <select name="rep" defaultValue={ownerUserId} className={inputClass}>
              <option value="ALL">All owners</option>
              <option value="UNASSIGNED">Unassigned</option>
              {filters.owners.map((owner) => (
                <option key={owner.value} value={owner.value}>{owner.label}</option>
              ))}
            </select>
          </Filter>
          <Filter label="Industry">
            <select name="industry" defaultValue={industry} className={inputClass}>
              <option value="">All industries</option>
              {filters.industries.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </Filter>
          <Filter label="Sort">
            <select name="sort" defaultValue={sort} className={inputClass}>
              <option value="updated_desc">Most recently active</option>
              <option value="score_desc">Highest score</option>
              <option value="company_name_asc">Company A-Z</option>
            </select>
          </Filter>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">
            Apply
          </button>
          <Link href="/lead-gen/pipeline" className="rounded-md border border-border px-4 py-2 text-sm font-semibold">
            Clear
          </Link>
          <Link
            href={buildExportHref({ stage, ownerUserId, industry, sort })}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold"
          >
            Export
          </Link>
        </div>
      </form>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border bg-muted px-4 py-3">
          <div>
            <h2 className="font-semibold text-foreground">Active sales work</h2>
            <p className="text-xs text-mutedForeground">Only engaged, meeting, proposal, won, and lost records appear here.</p>
          </div>
          <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold">
            {leads.length} opportunities
          </span>
        </div>
        {leads.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-mutedForeground">
                <tr>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Relationship</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Next step</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((lead) => (
                  <tr key={lead.id} className="align-top">
                    <td className="px-4 py-4">
                      <p className="font-semibold text-foreground">{lead.companyName}</p>
                      <p className="mt-1 text-xs text-mutedForeground">{lead.primaryIndustry ?? "Industry not classified"}</p>
                    </td>
                    <td className="px-4 py-4">
                      <form action={updateLeadStageAction} className="flex items-center gap-2">
                        <input type="hidden" name="leadId" value={lead.id} />
                        <select
                          name="stage"
                          defaultValue={lead.salesOpportunityStage ?? lead.stage}
                          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm font-semibold"
                        >
                          {SALES_OPPORTUNITY_STAGES.map((value) => (
                            <option key={value} value={value}>{formatSalesOpportunityStage(value)}</option>
                          ))}
                        </select>
                        <button className="rounded-md border border-border px-2 py-1.5 text-xs font-semibold">
                          Save
                        </button>
                      </form>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium text-foreground">{lead.contactName ?? "Engaged contact not selected"}</p>
                      <p className="mt-1 text-xs text-mutedForeground">Updated {lead.updatedAt.toLocaleDateString("en-US")}</p>
                    </td>
                    <td className="px-4 py-4">{lead.assignedRep}</td>
                    <td className="px-4 py-4 font-semibold">{lead.score}</td>
                    <td className="max-w-xs px-4 py-4 text-mutedForeground">{lead.nextStep}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-14 text-center">
            <h2 className="font-semibold text-foreground">No sales opportunities in this view</h2>
            <p className="mt-2 text-sm text-mutedForeground">
              That is okay: records remain in Daily Opportunities and Outreach Queue until a real engagement signal occurs.
            </p>
            <Link href="/lead-gen/outreach" className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">
              Open Outreach Queue
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

const inputClass = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

function Filter({ label, children }: { label: string; children: ReactNode }) {
  return <label className="text-sm font-medium text-foreground">{label}{children}</label>;
}

function parseStage(value: string | undefined): LeadPipelineStage | "ALL" {
  if (!value || value === "ALL") return "ALL";
  const stage = value as LeadPipelineStage;
  return SALES_OPPORTUNITY_STAGES.some((candidate) => candidate === stage) ? stage : "ALL";
}

function parseSort(value: string | undefined): LeadPipelineSort {
  return value === "score_desc" || value === "company_name_asc" ? value : "updated_desc";
}

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildExportHref(input: {
  stage: LeadPipelineStage | "ALL";
  ownerUserId: string;
  industry: string;
  sort: LeadPipelineSort;
}) {
  const params = new URLSearchParams({ scope: "sales", sort: input.sort });
  if (input.stage !== "ALL") params.set("stage", input.stage);
  if (input.ownerUserId !== "ALL") params.set("rep", input.ownerUserId);
  if (input.industry) params.set("industry", input.industry);
  return `/api/lead-gen/pipeline/export?${params}`;
}
