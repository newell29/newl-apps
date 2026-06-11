import { CandidateStatus, LeadPipelineStage } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { StageBadge } from "@/components/stage-badge";
import { updateLeadStageAction } from "@/modules/lead-gen/actions";
import {
  getLeadPipeline,
  getLeadPipelineFilters,
  type LeadPipelineSort
} from "@/modules/lead-gen/queries";
import { getCurrentTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const sortOptions = [
  { label: "Newest approved", value: "approved_desc" },
  { label: "Highest score", value: "score_desc" },
  { label: "Recently updated", value: "updated_desc" }
] as const;

type SearchParams = Record<string, string | string[] | undefined>;

export default async function PipelinePage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const tenant = await getCurrentTenantContext();
  const params = searchParams ? await searchParams : {};
  const stage = parseStageParam(readParam(params.stage));
  const ownerUserId = parseOwnerParam(readParam(params.rep));
  const sort = parseSortParam(readParam(params.sort));
  const [leads, filterOptions] = await Promise.all([
    getLeadPipeline(tenant, {
      stage,
      ownerUserId,
      sort
    }),
    getLeadPipelineFilters(tenant)
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lead Generation"
        title="Pipeline"
        description="Approved accounts being worked by sales after Candidate Feed review."
      />

      <div className="rounded-lg border border-accentBorder bg-accentSoft px-4 py-3 text-sm text-foreground">
        Only approved companies appear here. Approve companies from Found Companies / Candidate Feed to start building
        the sales pipeline.
      </div>

      <form className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm lg:grid-cols-6" action="/lead-gen/pipeline">
        <label className="space-y-1 text-sm font-medium text-foreground">
          <span>Stage</span>
          <select
            name="stage"
            defaultValue={stage}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="ALL">All stages</option>
            {filterOptions.stages.map((stageOption) => (
              <option key={stageOption} value={stageOption}>
                {formatStage(stageOption)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm font-medium text-foreground">
          <span>Assigned rep</span>
          <select
            name="rep"
            defaultValue={ownerUserId}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="ALL">All reps</option>
            <option value="UNASSIGNED">Unassigned</option>
            {filterOptions.owners.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm font-medium text-foreground">
          <span>Score</span>
          <select
            name="sort"
            defaultValue={sort}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <PipelinePlaceholderFilter label="Contact status" value="All contacts" />
        <PipelinePlaceholderFilter label="Apollo status" value="All Apollo states" />
        <PipelinePlaceholderFilter label="Sequence status" value="All sequence states" />

        <div className="lg:col-span-6">
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
            Apply filters
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Approved account workflow</p>
            <p className="text-xs text-mutedForeground">
              Sales operations view for pipeline stage, account score, enrichment readiness, and next action.
            </p>
          </div>
          <span className="rounded-full border border-accentBorder bg-card px-2.5 py-1 text-xs font-semibold text-primary">
            {leads.length.toLocaleString("en-US")} accounts
          </span>
        </div>

        {leads.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-[1280px] divide-y divide-border text-sm">
              <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
                <tr>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Pipeline stage</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Candidate status</th>
                  <th className="px-4 py-3">Assigned rep</th>
                  <th className="px-4 py-3">Contact status</th>
                  <th className="px-4 py-3">Apollo</th>
                  <th className="px-4 py-3">Sequence</th>
                  <th className="px-4 py-3">Last activity</th>
                  <th className="px-4 py-3">Next step</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((lead) => (
                  <tr key={lead.id} className="align-top transition-colors hover:bg-muted/60">
                    <td className="max-w-[240px] px-4 py-4">
                      <p className="font-semibold text-foreground">{lead.companyName}</p>
                      <p className="mt-1 text-xs text-mutedForeground">{lead.normalizedName}</p>
                      {lead.notes ? <p className="mt-2 text-xs leading-5 text-mutedForeground">{lead.notes}</p> : null}
                    </td>
                    <td className="px-4 py-4">
                      <StageBadge stage={lead.stage} />
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-lg font-bold text-primary">{lead.score}</span>
                      <p className="mt-1 text-xs text-mutedForeground">Company {lead.companyScore}</p>
                    </td>
                    <td className="px-4 py-4">
                      <CandidateStatusBadge status={lead.candidateStatus} />
                    </td>
                    <td className="px-4 py-4 text-mutedForeground">{lead.assignedRep}</td>
                    <td className="max-w-[180px] px-4 py-4 text-mutedForeground">
                      <p className="font-medium text-foreground">{lead.contactStatus}</p>
                      <p className="mt-1 text-xs">{lead.contactName ?? "No primary contact"}</p>
                    </td>
                    <td className="px-4 py-4 text-mutedForeground">{lead.apolloStatus}</td>
                    <td className="px-4 py-4 text-mutedForeground">{lead.sequenceStatus}</td>
                    <td className="px-4 py-4 text-mutedForeground">
                      <p>{formatDate(lead.updatedAt)}</p>
                      <p className="mt-1 text-xs">Approved {formatDate(lead.approvedAt)}</p>
                    </td>
                    <td className="max-w-[200px] px-4 py-4 font-medium text-foreground">{lead.nextStep}</td>
                    <td className="px-4 py-4">
                      <div className="flex min-w-[260px] flex-wrap gap-2">
                        <form action={updateLeadStageAction} className="flex gap-2">
                          <input type="hidden" name="leadId" value={lead.id} />
                          <select
                            name="stage"
                            defaultValue={lead.stage}
                            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                          >
                            {filterOptions.stages.map((stageOption) => (
                              <option key={stageOption} value={stageOption}>
                                {formatStage(stageOption)}
                              </option>
                            ))}
                          </select>
                          <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
                            Move
                          </button>
                        </form>
                        <form action={updateLeadStageAction}>
                          <input type="hidden" name="leadId" value={lead.id} />
                          <input type="hidden" name="stage" value={LeadPipelineStage.DISQUALIFIED} />
                          <button className="rounded-md border border-danger/30 bg-card px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10">
                            Disqualify
                          </button>
                        </form>
                        <button
                          disabled
                          className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-mutedForeground"
                        >
                          View company
                        </button>
                        <button
                          disabled
                          className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-mutedForeground"
                        >
                          Enrich contacts
                        </button>
                        <button
                          disabled
                          className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-mutedForeground"
                        >
                          Assign rep
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-12 text-center">
            <h2 className="text-base font-semibold text-foreground">No approved accounts yet</h2>
            <p className="mt-2 text-sm text-mutedForeground">
              Approve companies from Found Companies / Candidate Feed to start building your pipeline.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function PipelinePlaceholderFilter({ label, value }: { label: string; value: string }) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      <select
        disabled
        className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-mutedForeground"
        defaultValue={value}
      >
        <option>{value}</option>
      </select>
    </label>
  );
}

function CandidateStatusBadge({ status }: { status: CandidateStatus }) {
  const className =
    status === CandidateStatus.APPROVED_FOR_PIPELINE
      ? "border-success/30 bg-success/10 text-success"
      : status === CandidateStatus.DISQUALIFIED
        ? "border-danger/30 bg-danger/10 text-danger"
        : "border-accentBorder bg-accentSoft text-primary";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {status.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}

function parseStageParam(value: string | undefined) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return Object.values(LeadPipelineStage).includes(value as LeadPipelineStage) ? (value as LeadPipelineStage) : "ALL";
}

function parseOwnerParam(value: string | undefined) {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return value === "UNASSIGNED" ? "UNASSIGNED" : value;
}

function parseSortParam(value: string | undefined): LeadPipelineSort {
  return sortOptions.some((option) => option.value === value) ? (value as LeadPipelineSort) : "approved_desc";
}

function readParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function formatStage(stage: LeadPipelineStage) {
  return stage
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(value);
}
