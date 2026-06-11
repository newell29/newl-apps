import { CandidateStatus } from "@prisma/client";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StageBadge } from "@/components/stage-badge";
import { updateCandidateStatusAction } from "@/modules/lead-gen/actions";
import {
  getCandidateFeed,
  getCandidateFeedFilters,
  type CandidateFeedSort
} from "@/modules/lead-gen/queries";
import { getCurrentTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const statusOptions = [
  { label: "Active review queue", value: "ACTIVE" },
  { label: "New", value: CandidateStatus.NEW },
  { label: "Reviewing", value: CandidateStatus.REVIEWING },
  { label: "Approved for pipeline", value: CandidateStatus.APPROVED_FOR_PIPELINE },
  { label: "Rejected", value: CandidateStatus.REJECTED },
  { label: "Disqualified", value: CandidateStatus.DISQUALIFIED }
] as const;

const sortOptions = [
  { label: "Score high to low", value: "score_desc" },
  { label: "Score low to high", value: "score_asc" },
  { label: "Latest shipment", value: "latest_shipment_desc" },
  { label: "Shipment count", value: "shipment_count_desc" },
  { label: "Recently updated", value: "updated_desc" }
] as const;

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CandidateFeedPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const tenant = await getCurrentTenantContext();
  const params = searchParams ? await searchParams : {};
  const query = readParam(params.q) ?? "";
  const status = parseStatusParam(readParam(params.status));
  const sort = parseSortParam(readParam(params.sort));
  const searchProfileId = readParam(params.profile);
  const hasFilters = Boolean(query || searchProfileId || status !== "ACTIVE" || sort !== "score_desc");
  const [companies, filterOptions] = await Promise.all([
    getCandidateFeed(tenant, {
      query,
      status,
      searchProfileId,
      sort
    }),
    getCandidateFeedFilters(tenant)
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lead Generation"
        title="Found Companies Review Queue"
        description="Companies found by TradeMining appear here first. Review, filter, and approve the best-fit companies before moving them into Pipeline."
      />

      <div className="rounded-lg border border-accentBorder bg-accentSoft px-4 py-3 text-sm text-foreground">
        Found Companies are not sales leads yet. This active review queue shows New and Reviewing companies by default;
        approved accounts move to Pipeline.
      </div>

      <form className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm lg:grid-cols-5" action="/lead-gen/candidates">
        <label className="space-y-1 text-sm font-medium text-foreground lg:col-span-2">
          <span>Search companies</span>
          <input
            name="q"
            defaultValue={query}
            placeholder="Company, profile, destination, origin, product, HS code"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>

        <label className="space-y-1 text-sm font-medium text-foreground">
          <span>Status</span>
          <select
            name="status"
            defaultValue={status}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm font-medium text-foreground">
          <span>Search profile</span>
          <select
            name="profile"
            defaultValue={searchProfileId ?? ""}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="">All profiles</option>
            {filterOptions.searchProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
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

        <div className="lg:col-span-5">
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
            Apply filters
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Found company review</p>
            <p className="text-xs text-mutedForeground">
              Compare shipment evidence, search profile fit, and score reasoning before approving accounts.
            </p>
          </div>
          <span className="rounded-full border border-accentBorder bg-card px-2.5 py-1 text-xs font-semibold text-primary">
            {companies.length.toLocaleString("en-US")} companies
          </span>
        </div>

        {companies.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-[1240px] divide-y divide-border text-sm">
              <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
                <tr>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Matched profile</th>
                  <th className="px-4 py-3">Shipments</th>
                  <th className="px-4 py-3">Destination</th>
                  <th className="px-4 py-3">Origin</th>
                  <th className="px-4 py-3">Product / HS</th>
                  <th className="px-4 py-3">Rep</th>
                  <th className="px-4 py-3">Pipeline</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {companies.map((company) => (
                  <tr key={company.id} className="align-top transition-colors hover:bg-muted/60">
                    <td className="max-w-[240px] px-4 py-4">
                      <p className="font-semibold text-foreground">{company.companyName}</p>
                      <p className="mt-1 text-xs text-mutedForeground">{company.normalizedName}</p>
                      <p className="mt-1 text-xs text-mutedForeground">{company.domain ?? company.source ?? "TradeMining"}</p>
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-xl font-bold text-primary">{company.candidateScore}</span>
                      <p className="mt-2 max-w-[260px] text-xs leading-5 text-mutedForeground">{company.scoreReasoning}</p>
                      {company.importedScoreReasoning ? (
                        <p className="mt-2 max-w-[260px] rounded-md border border-border bg-background px-2 py-1 text-xs text-mutedForeground">
                          Ingested note: {company.importedScoreReasoning}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-4">
                      <CandidateStatusBadge status={company.candidateStatus} />
                      {company.candidateStatusReason ? (
                        <p className="mt-2 max-w-[170px] text-xs text-mutedForeground">{company.candidateStatusReason}</p>
                      ) : null}
                    </td>
                    <td className="max-w-[180px] px-4 py-4 text-mutedForeground">
                      <p className="font-medium text-foreground">{company.matchedSearchProfileName}</p>
                      <p className="text-xs">{company.matchedSearchProfileId ?? "No profile id"}</p>
                    </td>
                    <td className="px-4 py-4 text-mutedForeground">
                      <p className="font-semibold text-foreground">{company.shipmentCount}</p>
                      <p className="text-xs">Latest {formatDate(company.latestShipmentDate)}</p>
                    </td>
                    <td className="max-w-[170px] px-4 py-4 text-mutedForeground">
                      {company.destinationMarket ?? company.destinationPort ?? "Unknown"}
                    </td>
                    <td className="max-w-[190px] px-4 py-4 text-mutedForeground">
                      {[company.originCountry, company.originPort, company.shipFromPort].filter(Boolean).join(" / ") ||
                        "Unknown"}
                    </td>
                    <td className="max-w-[220px] px-4 py-4 text-mutedForeground">
                      <p>{company.productDescription ?? "Unknown product"}</p>
                      <p className="mt-1 text-xs">HS: {company.hsCode ?? "Unknown"}</p>
                    </td>
                    <td className="px-4 py-4 text-mutedForeground">{company.assignedRep}</td>
                    <td className="px-4 py-4">
                      {company.currentPipelineStage ? (
                        <div className="space-y-2">
                          <StageBadge stage={company.currentPipelineStage} />
                          <Link className="block text-xs font-semibold text-primary hover:text-primaryHover" href="/lead-gen/pipeline">
                            In Pipeline
                          </Link>
                        </div>
                      ) : (
                        <span className="text-xs font-medium text-mutedForeground">Not approved</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex min-w-[180px] flex-wrap gap-2">
                        {company.currentPipelineStage ? (
                          <Link
                            href="/lead-gen/pipeline"
                            className="rounded-md border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success"
                          >
                            In Pipeline
                          </Link>
                        ) : (
                          <>
                            <CandidateActionButton companyId={company.id} status={CandidateStatus.REVIEWING} label="Mark Reviewing" />
                            <CandidateActionButton
                              companyId={company.id}
                              status={CandidateStatus.APPROVED_FOR_PIPELINE}
                              label="Approve to Pipeline"
                              primary
                            />
                            <CandidateActionButton companyId={company.id} status={CandidateStatus.REJECTED} label="Reject" />
                            <CandidateActionButton
                              companyId={company.id}
                              status={CandidateStatus.DISQUALIFIED}
                              label="Disqualify"
                            />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-12 text-center">
            <h2 className="text-base font-semibold text-foreground">
              {hasFilters ? "No companies match these filters." : "No companies found yet."}
            </h2>
            <p className="mt-2 text-sm text-mutedForeground">
              {hasFilters
                ? "Adjust the search, status, profile, or sort controls to widen the review queue."
                : "Run an OpenClaw/n8n ingestion or post a test batch to populate this queue."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function CandidateActionButton({
  companyId,
  status,
  label,
  primary = false
}: {
  companyId: string;
  status: CandidateStatus;
  label: string;
  primary?: boolean;
}) {
  return (
    <form action={updateCandidateStatusAction}>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="status" value={status} />
      <button
        className={
          primary
            ? "rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground transition-colors hover:bg-primaryHover"
            : "rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-accentBorder hover:bg-accentSoft"
        }
      >
        {label}
      </button>
    </form>
  );
}

function CandidateStatusBadge({ status }: { status: CandidateStatus }) {
  const className =
    status === CandidateStatus.APPROVED_FOR_PIPELINE
      ? "border-success/30 bg-success/10 text-success"
      : status === CandidateStatus.REJECTED || status === CandidateStatus.DISQUALIFIED
        ? "border-danger/30 bg-danger/10 text-danger"
        : status === CandidateStatus.REVIEWING
          ? "border-warning/30 bg-warning/10 text-warning"
          : "border-accentBorder bg-accentSoft text-primary";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {status.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}

function parseStatusParam(value: string | undefined) {
  if (!value || value === "ACTIVE") {
    return "ACTIVE";
  }

  return Object.values(CandidateStatus).includes(value as CandidateStatus) ? (value as CandidateStatus) : "ACTIVE";
}

function parseSortParam(value: string | undefined): CandidateFeedSort {
  return sortOptions.some((option) => option.value === value) ? (value as CandidateFeedSort) : "score_desc";
}

function readParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function formatDate(value: Date | null) {
  if (!value) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(value);
}
