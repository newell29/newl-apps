import { LeadPipelineStage } from "@prisma/client";
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
  type LeadPipelineSort
} from "@/modules/lead-gen/queries";
import { getCurrentTenantContext } from "@/server/tenant-context";

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
  const tenant = await getCurrentTenantContext();
  const params = searchParams ? await searchParams : {};
  const stage = parseStageParam(readParam(params.stage));
  const ownerUserId = parseOwnerParam(readParam(params.rep));
  const minScore = parseScoreParam(readParam(params.minScore));
  const maxScore = parseScoreParam(readParam(params.maxScore));
  const sort = parseSortParam(readParam(params.sort));
  const exportHref = buildPipelineExportHref(params);
  const [leads, filterOptions] = await Promise.all([
    getLeadPipeline(tenant, {
      stage,
      ownerUserId,
      minScore,
      maxScore,
      sort
    }),
    getLeadPipelineFilters(tenant)
  ]);

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

      <form className="rounded-lg border border-border bg-card p-4 shadow-sm" action="/lead-gen/pipeline">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
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

          <div className="flex items-end md:col-span-2 xl:col-span-1">
            <div className="grid w-full gap-2 sm:grid-cols-3 xl:grid-cols-1">
              <button className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
                Apply filters
              </button>
              <Link
                href="/lead-gen/pipeline"
                className="inline-flex w-full items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accentSoft"
              >
                Clear filters
              </Link>
              <Link
                href={exportHref}
                className="inline-flex w-full items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accentSoft"
              >
                Export to Excel
              </Link>
            </div>
          </div>
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

function buildPipelineExportHref(searchParams: SearchParams) {
  const query = new URLSearchParams();

  appendQueryParam(query, "stage", readParam(searchParams.stage));
  appendQueryParam(query, "rep", readParam(searchParams.rep));
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
