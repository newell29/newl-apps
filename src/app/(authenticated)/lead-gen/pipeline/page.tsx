import { LeadPipelineStage, ModuleKey } from "@prisma/client";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  bulkAssignLeadOwnerAction,
  bulkQueueApolloEnrichmentAction,
  bulkUnassignLeadOwnerAction,
  bulkUpdateLeadStageAction,
  updateLeadStageAction
} from "@/modules/lead-gen/actions";
import { PipelineTableClient } from "@/modules/lead-gen/components/pipeline-table-client";
import {
  getLeadPipeline,
  getLeadPipelineFilters,
  type LeadPipelineApolloStatusFilter,
  type LeadPipelineCandidateStatusFilter,
  type LeadPipelineContactStatusFilter,
  type LeadPipelineSort,
  type LeadPipelineSequenceStatusFilter
} from "@/modules/lead-gen/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const sortOptions = [
  { label: "Newest approved", value: "approved_desc" },
  { label: "Highest score", value: "score_desc" },
  { label: "Recently updated", value: "updated_desc" },
  { label: "Company name A-Z", value: "company_name_asc" }
] as const;

type SearchParams = Record<string, string | string[] | undefined>;

export default async function PipelinePage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  const tenant = context;
  const params = searchParams ? await searchParams : {};
  const stage = parseStageParam(readParam(params.stage));
  const ownerUserId = parseOwnerParam(readParam(params.rep));
  const industry = readParam(params.industry) ?? "";
  const candidateStatus = parseCandidateStatusParam(readParam(params.candidateStatus));
  const contactStatus = parseContactStatusParam(readParam(params.contactStatus));
  const apolloStatus = parseApolloStatusParam(readParam(params.apolloStatus));
  const sequenceStatus = parseSequenceStatusParam(readParam(params.sequenceStatus));
  const minShipments30d = parseShipmentCountParam(readParam(params.minShipments30d));
  const maxShipments30d = parseShipmentCountParam(readParam(params.maxShipments30d));
  const minShipments90d = parseShipmentCountParam(readParam(params.minShipments90d));
  const maxShipments90d = parseShipmentCountParam(readParam(params.maxShipments90d));
  const minScore = parseScoreParam(readParam(params.minScore));
  const maxScore = parseScoreParam(readParam(params.maxScore));
  const sort = parseSortParam(readParam(params.sort));
  const hasAdvancedFilters = Boolean(
    candidateStatus !== "ALL" ||
      contactStatus !== "ALL" ||
      apolloStatus !== "ALL" ||
      sequenceStatus !== "ALL" ||
      minShipments30d !== undefined ||
      maxShipments30d !== undefined ||
      minShipments90d !== undefined ||
      maxShipments90d !== undefined ||
      minScore !== undefined ||
      maxScore !== undefined
  );
  const hasFilters = Boolean(
    stage !== "ALL" ||
      ownerUserId !== "ALL" ||
      industry ||
      candidateStatus !== "ALL" ||
      contactStatus !== "ALL" ||
      apolloStatus !== "ALL" ||
      sequenceStatus !== "ALL" ||
      minShipments30d !== undefined ||
      maxShipments30d !== undefined ||
      minShipments90d !== undefined ||
      maxShipments90d !== undefined ||
      minScore !== undefined ||
      maxScore !== undefined ||
      sort !== "approved_desc"
  );
  const exportHref = buildPipelineExportHref(params);
  const [leads, filterOptions] = await Promise.all([
    getLeadPipeline(tenant, {
      stage,
      ownerUserId,
      industry: industry || undefined,
      candidateStatus,
      contactStatus,
      apolloStatus,
      sequenceStatus,
      minShipments30d,
      maxShipments30d,
      minShipments90d,
      maxShipments90d,
      minScore,
      maxScore,
      sort
    }),
    getLeadPipelineFilters(tenant)
  ]);
  const filterChips = buildPipelineFilterChips({
    stage,
    ownerUserId,
    industry,
    candidateStatus,
    contactStatus,
    apolloStatus,
    sequenceStatus,
    minShipments30d,
    maxShipments30d,
    minShipments90d,
    maxShipments90d,
    minScore,
    maxScore,
    sort,
    owners: filterOptions.owners
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lead Generation"
        title="Pipeline"
        description="Only approved companies appear here. Contact enrichment and sequence tracking will be added after Apollo sync."
      />

      <div className="rounded-lg border border-accentBorder bg-accentSoft px-4 py-3 text-sm text-foreground">
        Only approved companies appear here. Contact enrichment and sequence tracking will be added after Apollo sync.
      </div>

      <form className="overflow-hidden rounded-lg border border-border bg-card shadow-sm" action="/lead-gen/pipeline">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Filters</p>
            <p className="text-xs text-mutedForeground">
              Focus the approved account view by owner, industry, workflow state, shipment range, and score.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Apply filters
            </button>
            <Link
              href="/lead-gen/pipeline"
              className="inline-flex items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accentSoft"
            >
              Clear filters
            </Link>
            <Link
              href={exportHref}
              className="inline-flex items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accentSoft"
            >
              Export to Excel
            </Link>
          </div>
        </div>

        {hasFilters ? (
          <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
            {filterChips.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="inline-flex items-center gap-2 rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent/10"
              >
                <span>{item.label}</span>
                <span className="text-mutedForeground">x</span>
              </Link>
            ))}
          </div>
        ) : null}

        <div className="grid gap-6 p-4 xl:grid-cols-4">
          <div className="space-y-3 xl:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Ownership</p>
            <div className="grid gap-3 md:grid-cols-2">
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
                  <option value="UNASSIGNED">Unassigned only</option>
                  {filterOptions.owners.map((owner) => (
                    <option key={owner.value} value={owner.value}>
                      {owner.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Qualification</p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-foreground">
                <span>Industry</span>
                <select
                  name="industry"
                  defaultValue={industry}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">All industries</option>
                  {filterOptions.industries.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-foreground">
                <span>Sort</span>
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
            </div>
          </div>
        </div>

        <details className="border-t border-border px-4 py-3" open={hasAdvancedFilters}>
          <summary className="cursor-pointer text-sm font-semibold text-foreground">More filters</summary>
          <div className="mt-4 grid gap-6 xl:grid-cols-3">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Qualification details</p>
              <label className="space-y-1 text-sm font-medium text-foreground">
                <span>Candidate status</span>
                <select
                  name="candidateStatus"
                  defaultValue={candidateStatus}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="ALL">All candidate statuses</option>
                  {filterOptions.candidateStatuses.map((statusOption) => (
                    <option key={statusOption} value={statusOption}>
                      {formatCandidateStatus(statusOption)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-foreground">
                <span>Contact status</span>
                <select
                  name="contactStatus"
                  defaultValue={contactStatus}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="ALL">All contact statuses</option>
                  {filterOptions.contactStatuses.map((statusOption) => (
                    <option key={statusOption} value={statusOption}>
                      {formatPipelineContactStatus(statusOption)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Apollo and sequencing</p>
              <label className="space-y-1 text-sm font-medium text-foreground">
                <span>Apollo</span>
                <select
                  name="apolloStatus"
                  defaultValue={apolloStatus}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="ALL">All Apollo statuses</option>
                  {filterOptions.apolloStatuses.map((statusOption) => (
                    <option key={statusOption} value={statusOption}>
                      {formatPipelineState(statusOption)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-foreground">
                <span>Sequence</span>
                <select
                  name="sequenceStatus"
                  defaultValue={sequenceStatus}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="ALL">All sequence statuses</option>
                  {filterOptions.sequenceStatuses.map((statusOption) => (
                    <option key={statusOption} value={statusOption}>
                      {formatPipelineState(statusOption)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Shipment and score range</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-medium text-foreground">
                  <span>Min shipments (30d)</span>
                  <input
                    name="minShipments30d"
                    type="number"
                    min="0"
                    defaultValue={minShipments30d ?? ""}
                    placeholder="0"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </label>
                <label className="space-y-1 text-sm font-medium text-foreground">
                  <span>Max shipments (30d)</span>
                  <input
                    name="maxShipments30d"
                    type="number"
                    min="0"
                    defaultValue={maxShipments30d ?? ""}
                    placeholder="Any"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-medium text-foreground">
                  <span>Min shipments (90d)</span>
                  <input
                    name="minShipments90d"
                    type="number"
                    min="0"
                    defaultValue={minShipments90d ?? ""}
                    placeholder="0"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </label>
                <label className="space-y-1 text-sm font-medium text-foreground">
                  <span>Max shipments (90d)</span>
                  <input
                    name="maxShipments90d"
                    type="number"
                    min="0"
                    defaultValue={maxShipments90d ?? ""}
                    placeholder="Any"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-medium text-foreground">
                  <span>Min score</span>
                  <input
                    name="minScore"
                    type="number"
                    min="0"
                    max="100"
                    defaultValue={minScore ?? ""}
                    placeholder="0"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </label>
                <label className="space-y-1 text-sm font-medium text-foreground">
                  <span>Max score</span>
                  <input
                    name="maxScore"
                    type="number"
                    min="0"
                    max="100"
                    defaultValue={maxScore ?? ""}
                    placeholder="100"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </label>
              </div>
            </div>
          </div>
        </details>
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
          <PipelineTableClient
            leads={leads}
            stageOptions={filterOptions.stages}
            repOptions={filterOptions.owners}
            bulkUpdateLeadStageAction={bulkUpdateLeadStageAction}
            bulkQueueApolloEnrichmentAction={bulkQueueApolloEnrichmentAction}
            bulkAssignLeadOwnerAction={bulkAssignLeadOwnerAction}
            bulkUnassignLeadOwnerAction={bulkUnassignLeadOwnerAction}
            updateLeadStageAction={updateLeadStageAction}
          />
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

function buildPipelineFilterChips({
  stage,
  ownerUserId,
  industry,
  candidateStatus,
  contactStatus,
  apolloStatus,
  sequenceStatus,
  minShipments30d,
  maxShipments30d,
  minShipments90d,
  maxShipments90d,
  minScore,
  maxScore,
  sort,
  owners
}: {
  stage: LeadPipelineStage | "ALL";
  ownerUserId: string;
  industry: string;
  candidateStatus: LeadPipelineCandidateStatusFilter;
  contactStatus: LeadPipelineContactStatusFilter;
  apolloStatus: LeadPipelineApolloStatusFilter;
  sequenceStatus: LeadPipelineSequenceStatusFilter;
  minShipments30d: number | undefined;
  maxShipments30d: number | undefined;
  minShipments90d: number | undefined;
  maxShipments90d: number | undefined;
  minScore: number | undefined;
  maxScore: number | undefined;
  sort: LeadPipelineSort;
  owners: Array<{ value: string; label: string }>;
}) {
  const chips: Array<{ label: string; href: string }> = [];
  const matchedOwner = owners.find((owner) => owner.value === ownerUserId);

  if (stage !== "ALL") {
    chips.push({
      label: `Stage: ${formatStage(stage)}`,
      href: buildPipelinePageHref({ rep: ownerUserId, industry, candidateStatus, contactStatus, apolloStatus, sequenceStatus, minShipments30d, maxShipments30d, minShipments90d, maxShipments90d, minScore, maxScore, sort })
    });
  }
  if (ownerUserId === "UNASSIGNED") {
    chips.push({
      label: "Rep: Unassigned only",
      href: buildPipelinePageHref({ stage, industry, candidateStatus, contactStatus, apolloStatus, sequenceStatus, minShipments30d, maxShipments30d, minShipments90d, maxShipments90d, minScore, maxScore, sort })
    });
  } else if (matchedOwner) {
    chips.push({
      label: `Rep: ${matchedOwner.label}`,
      href: buildPipelinePageHref({ stage, industry, candidateStatus, contactStatus, apolloStatus, sequenceStatus, minShipments30d, maxShipments30d, minShipments90d, maxShipments90d, minScore, maxScore, sort })
    });
  }
  if (industry) {
    chips.push({
      label: `Industry: ${industry}`,
      href: buildPipelinePageHref({ stage, rep: ownerUserId, candidateStatus, contactStatus, apolloStatus, sequenceStatus, minShipments30d, maxShipments30d, minShipments90d, maxShipments90d, minScore, maxScore, sort })
    });
  }
  if (candidateStatus !== "ALL") {
    chips.push({
      label: `Candidate: ${formatCandidateStatus(candidateStatus)}`,
      href: buildPipelinePageHref({ stage, rep: ownerUserId, industry, contactStatus, apolloStatus, sequenceStatus, minShipments30d, maxShipments30d, minShipments90d, maxShipments90d, minScore, maxScore, sort })
    });
  }
  if (contactStatus !== "ALL") {
    chips.push({
      label: `Contact: ${formatPipelineContactStatus(contactStatus)}`,
      href: buildPipelinePageHref({ stage, rep: ownerUserId, industry, candidateStatus, apolloStatus, sequenceStatus, minShipments30d, maxShipments30d, minShipments90d, maxShipments90d, minScore, maxScore, sort })
    });
  }
  if (apolloStatus !== "ALL") {
    chips.push({
      label: `Apollo: ${formatPipelineState(apolloStatus)}`,
      href: buildPipelinePageHref({ stage, rep: ownerUserId, industry, candidateStatus, contactStatus, sequenceStatus, minShipments30d, maxShipments30d, minShipments90d, maxShipments90d, minScore, maxScore, sort })
    });
  }
  if (sequenceStatus !== "ALL") {
    chips.push({
      label: `Sequence: ${formatPipelineState(sequenceStatus)}`,
      href: buildPipelinePageHref({ stage, rep: ownerUserId, industry, candidateStatus, contactStatus, apolloStatus, minShipments30d, maxShipments30d, minShipments90d, maxShipments90d, minScore, maxScore, sort })
    });
  }
  if (minShipments30d !== undefined) {
    chips.push({
      label: `30d min: ${minShipments30d}`,
      href: buildPipelinePageHref({ stage, rep: ownerUserId, industry, candidateStatus, contactStatus, apolloStatus, sequenceStatus, maxShipments30d, minShipments90d, maxShipments90d, minScore, maxScore, sort })
    });
  }
  if (maxShipments30d !== undefined) {
    chips.push({
      label: `30d max: ${maxShipments30d}`,
      href: buildPipelinePageHref({ stage, rep: ownerUserId, industry, candidateStatus, contactStatus, apolloStatus, sequenceStatus, minShipments30d, minShipments90d, maxShipments90d, minScore, maxScore, sort })
    });
  }
  if (minShipments90d !== undefined) {
    chips.push({
      label: `90d min: ${minShipments90d}`,
      href: buildPipelinePageHref({ stage, rep: ownerUserId, industry, candidateStatus, contactStatus, apolloStatus, sequenceStatus, minShipments30d, maxShipments30d, maxShipments90d, minScore, maxScore, sort })
    });
  }
  if (maxShipments90d !== undefined) {
    chips.push({
      label: `90d max: ${maxShipments90d}`,
      href: buildPipelinePageHref({ stage, rep: ownerUserId, industry, candidateStatus, contactStatus, apolloStatus, sequenceStatus, minShipments30d, maxShipments30d, minShipments90d, minScore, maxScore, sort })
    });
  }
  if (minScore !== undefined) {
    chips.push({
      label: `Min score: ${minScore}`,
      href: buildPipelinePageHref({ stage, rep: ownerUserId, industry, candidateStatus, contactStatus, apolloStatus, sequenceStatus, minShipments30d, maxShipments30d, minShipments90d, maxShipments90d, maxScore, sort })
    });
  }
  if (maxScore !== undefined) {
    chips.push({
      label: `Max score: ${maxScore}`,
      href: buildPipelinePageHref({ stage, rep: ownerUserId, industry, candidateStatus, contactStatus, apolloStatus, sequenceStatus, minShipments30d, maxShipments30d, minShipments90d, maxShipments90d, minScore, sort })
    });
  }
  if (sort !== "approved_desc") {
    chips.push({
      label: `Sort: ${sortOptions.find((option) => option.value === sort)?.label ?? sort}`,
      href: buildPipelinePageHref({ stage, rep: ownerUserId, industry, candidateStatus, contactStatus, apolloStatus, sequenceStatus, minShipments30d, maxShipments30d, minShipments90d, maxShipments90d, minScore, maxScore })
    });
  }

  return chips;
}

function buildPipelinePageHref(params: {
  stage?: LeadPipelineStage | "ALL";
  rep?: string;
  industry?: string;
  candidateStatus?: LeadPipelineCandidateStatusFilter;
  contactStatus?: LeadPipelineContactStatusFilter;
  apolloStatus?: LeadPipelineApolloStatusFilter;
  sequenceStatus?: LeadPipelineSequenceStatusFilter;
  minShipments30d?: number;
  maxShipments30d?: number;
  minShipments90d?: number;
  maxShipments90d?: number;
  minScore?: number;
  maxScore?: number;
  sort?: LeadPipelineSort;
}) {
  const search = new URLSearchParams();
  if (params.stage && params.stage !== "ALL") search.set("stage", params.stage);
  if (params.rep && params.rep !== "ALL") search.set("rep", params.rep);
  if (params.industry) search.set("industry", params.industry);
  if (params.candidateStatus && params.candidateStatus !== "ALL") search.set("candidateStatus", params.candidateStatus);
  if (params.contactStatus && params.contactStatus !== "ALL") search.set("contactStatus", params.contactStatus);
  if (params.apolloStatus && params.apolloStatus !== "ALL") search.set("apolloStatus", params.apolloStatus);
  if (params.sequenceStatus && params.sequenceStatus !== "ALL") search.set("sequenceStatus", params.sequenceStatus);
  if (params.minShipments30d !== undefined) search.set("minShipments30d", String(params.minShipments30d));
  if (params.maxShipments30d !== undefined) search.set("maxShipments30d", String(params.maxShipments30d));
  if (params.minShipments90d !== undefined) search.set("minShipments90d", String(params.minShipments90d));
  if (params.maxShipments90d !== undefined) search.set("maxShipments90d", String(params.maxShipments90d));
  if (params.minScore !== undefined) search.set("minScore", String(params.minScore));
  if (params.maxScore !== undefined) search.set("maxScore", String(params.maxScore));
  if (params.sort && params.sort !== "approved_desc") search.set("sort", params.sort);
  const query = search.toString();
  return query ? `/lead-gen/pipeline?${query}` : "/lead-gen/pipeline";
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

function parseCandidateStatusParam(value: string | undefined): LeadPipelineCandidateStatusFilter {
  return value === "NEW" ||
    value === "REVIEWING" ||
    value === "APPROVED_FOR_PIPELINE" ||
    value === "REJECTED" ||
    value === "DISQUALIFIED"
    ? value
    : "ALL";
}

function parseContactStatusParam(value: string | undefined): LeadPipelineContactStatusFilter {
  return value === "NOT_ENRICHED" ||
    value === "PRIMARY_SELECTED" ||
    value === "APPROVED" ||
    value === "REVIEWING" ||
    value === "FOUND"
    ? value
    : "ALL";
}

function parseApolloStatusParam(value: string | undefined): LeadPipelineApolloStatusFilter {
  return value === "NOT_STARTED" ||
    value === "QUEUED" ||
    value === "ENRICHED" ||
    value === "NOT_FOUND" ||
    value === "NEEDS_REVIEW"
    ? value
    : "ALL";
}

function parseSequenceStatusParam(value: string | undefined): LeadPipelineSequenceStatusFilter {
  return value === "NOT_STARTED" ||
    value === "READY" ||
    value === "ENROLLED" ||
    value === "REPLIED"
    ? value
    : "ALL";
}

function parseSortParam(value: string | undefined): LeadPipelineSort {
  return sortOptions.some((option) => option.value === value) ? (value as LeadPipelineSort) : "approved_desc";
}

function parseScoreParam(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.min(100, Math.max(0, Math.round(parsed)));
}

function parseShipmentCountParam(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.max(0, Math.round(parsed));
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

function formatCandidateStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatPipelineContactStatus(status: LeadPipelineContactStatusFilter) {
  if (status === "NOT_ENRICHED") return "Not enriched";
  if (status === "PRIMARY_SELECTED") return "Primary contact selected";
  if (status === "APPROVED") return "Approved contact(s)";
  if (status === "REVIEWING") return "In review";
  if (status === "FOUND") return "Contact(s) found";
  return "All contact statuses";
}

function formatPipelineState(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function buildPipelineExportHref(searchParams: SearchParams) {
  const query = new URLSearchParams();

  appendQueryParam(query, "stage", readParam(searchParams.stage));
  appendQueryParam(query, "rep", readParam(searchParams.rep));
  appendQueryParam(query, "industry", readParam(searchParams.industry));
  appendQueryParam(query, "candidateStatus", readParam(searchParams.candidateStatus));
  appendQueryParam(query, "contactStatus", readParam(searchParams.contactStatus));
  appendQueryParam(query, "apolloStatus", readParam(searchParams.apolloStatus));
  appendQueryParam(query, "sequenceStatus", readParam(searchParams.sequenceStatus));
  appendQueryParam(query, "minShipments30d", readParam(searchParams.minShipments30d));
  appendQueryParam(query, "maxShipments30d", readParam(searchParams.maxShipments30d));
  appendQueryParam(query, "minShipments90d", readParam(searchParams.minShipments90d));
  appendQueryParam(query, "maxShipments90d", readParam(searchParams.maxShipments90d));
  appendQueryParam(query, "minScore", readParam(searchParams.minScore));
  appendQueryParam(query, "maxScore", readParam(searchParams.maxScore));
  appendQueryParam(query, "sort", readParam(searchParams.sort));

  const search = query.toString();
  return search ? `/api/lead-gen/pipeline/export?${search}` : "/api/lead-gen/pipeline/export";
}

function appendQueryParam(query: URLSearchParams, key: string, value: string | undefined) {
  if (!value || value.trim().length === 0) {
    return;
  }

  query.set(key, value);
}
