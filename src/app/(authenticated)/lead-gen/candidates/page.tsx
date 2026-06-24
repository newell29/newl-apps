import { CandidateStatus } from "@prisma/client";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { bulkUpdateCandidateStatusAction } from "@/modules/lead-gen/actions";
import { CandidateReviewTableClient } from "@/modules/lead-gen/components/candidate-review-table-client";
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
  const industry = readParam(params.industry) ?? "";
  const minScore = parseScoreParam(readParam(params.minScore));
  const maxScore = parseScoreParam(readParam(params.maxScore));
  const minShipmentCount = parseShipmentCountParam(readParam(params.minShipmentCount));
  const hasAdvancedFilters = Boolean(industry || minScore !== undefined || maxScore !== undefined || minShipmentCount !== undefined);
  const hasFilters = Boolean(
    query ||
      searchProfileId ||
      industry ||
      minScore !== undefined ||
      maxScore !== undefined ||
      minShipmentCount !== undefined ||
      status !== "ACTIVE" ||
      sort !== "score_desc"
  );
  const [companies, filterOptions] = await Promise.all([
    getCandidateFeed(tenant, {
      query,
      status,
      searchProfileId,
      industry: industry || undefined,
      minScore,
      maxScore,
      minShipmentCount,
      sort
    }),
    getCandidateFeedFilters(tenant)
  ]);
  const exportHref = buildExportHref({
    query,
    status,
    searchProfileId,
    industry: industry || undefined,
    minScore,
    maxScore,
    minShipmentCount,
    sort
  });
  const filterChips = buildCandidateFilterChips({
    query,
    status,
    searchProfileId,
    searchProfiles: filterOptions.searchProfiles,
    industry,
    minScore,
    maxScore,
    minShipmentCount,
    sort
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lead Generation"
        title="Found Companies Review Queue"
        description="Companies found by TradeMining appear here first. Review and approve the best-fit companies into Pipeline."
      />

      <div className="rounded-lg border border-accentBorder bg-accentSoft px-4 py-3 text-sm text-foreground">
        Found Companies are not sales leads yet. This active review queue shows New and Reviewing companies by default;
        approved accounts move to Pipeline.
      </div>

      <form className="overflow-hidden rounded-lg border border-border bg-card shadow-sm" action="/lead-gen/candidates">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Filters</p>
            <p className="text-xs text-mutedForeground">
              Narrow the review queue by company, profile, industry, score, or shipment activity.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Apply filters
            </button>
            {hasFilters ? (
              <Link
                href="/lead-gen/candidates"
                className="rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accentSoft"
              >
                Clear filters
              </Link>
            ) : null}
            <Link
              href={exportHref}
              className="rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accentSoft"
            >
              Export CSV
            </Link>
          </div>
        </div>

        {filterChips.length > 0 ? (
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

        <div className="grid gap-6 p-4 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Search</p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-foreground md:col-span-2">
                <span>Company search</span>
                <input
                  name="q"
                  defaultValue={query}
                  placeholder="Company, profile, destination, origin, product, HS code"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
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
            </div>
          </div>

          <div className="space-y-3">
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

        <details className="border-t border-border px-4 py-3" open={hasAdvancedFilters}>
          <summary className="cursor-pointer text-sm font-semibold text-foreground">More filters</summary>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Industry</p>
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
            </div>
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Scoring and volume</p>
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
              <label className="space-y-1 text-sm font-medium text-foreground">
                <span>Min shipments</span>
                <input
                  name="minShipmentCount"
                  type="number"
                  min="0"
                  defaultValue={minShipmentCount ?? ""}
                  placeholder="Any"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
            </div>
          </div>
        </details>
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
          <CandidateReviewTableClient companies={companies} bulkUpdateAction={bulkUpdateCandidateStatusAction} />
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

function buildCandidateFilterChips({
  query,
  status,
  searchProfileId,
  searchProfiles,
  industry,
  minScore,
  maxScore,
  minShipmentCount,
  sort
}: {
  query: string;
  status: CandidateStatus | "ACTIVE";
  searchProfileId: string | undefined;
  searchProfiles: Array<{ id: string; name: string }>;
  industry: string;
  minScore: number | undefined;
  maxScore: number | undefined;
  minShipmentCount: number | undefined;
  sort: CandidateFeedSort;
}) {
  const chips: Array<{ label: string; href: string }> = [];
  const matchedProfile = searchProfiles.find((profile) => profile.id === searchProfileId);

  if (query) {
    chips.push({
      label: `Search: ${query}`,
      href: buildCandidatesPageHref({ status, profile: searchProfileId, industry, minScore, maxScore, minShipmentCount, sort })
    });
  }
  if (status !== "ACTIVE") {
    chips.push({
      label: `Status: ${statusOptions.find((option) => option.value === status)?.label ?? status}`,
      href: buildCandidatesPageHref({ q: query, profile: searchProfileId, industry, minScore, maxScore, minShipmentCount, sort })
    });
  }
  if (matchedProfile) {
    chips.push({
      label: `Profile: ${matchedProfile.name}`,
      href: buildCandidatesPageHref({ q: query, status, industry, minScore, maxScore, minShipmentCount, sort })
    });
  }
  if (industry) {
    chips.push({
      label: `Industry: ${industry}`,
      href: buildCandidatesPageHref({ q: query, status, profile: searchProfileId, minScore, maxScore, minShipmentCount, sort })
    });
  }
  if (minScore !== undefined) {
    chips.push({
      label: `Min score: ${minScore}`,
      href: buildCandidatesPageHref({ q: query, status, profile: searchProfileId, industry, maxScore, minShipmentCount, sort })
    });
  }
  if (maxScore !== undefined) {
    chips.push({
      label: `Max score: ${maxScore}`,
      href: buildCandidatesPageHref({ q: query, status, profile: searchProfileId, industry, minScore, minShipmentCount, sort })
    });
  }
  if (minShipmentCount !== undefined) {
    chips.push({
      label: `Min shipments: ${minShipmentCount}`,
      href: buildCandidatesPageHref({ q: query, status, profile: searchProfileId, industry, minScore, maxScore, sort })
    });
  }
  if (sort !== "score_desc") {
    chips.push({
      label: `Sort: ${sortOptions.find((option) => option.value === sort)?.label ?? sort}`,
      href: buildCandidatesPageHref({ q: query, status, profile: searchProfileId, industry, minScore, maxScore, minShipmentCount })
    });
  }

  return chips;
}

function buildCandidatesPageHref(params: {
  q?: string;
  status?: CandidateStatus | "ACTIVE";
  profile?: string;
  industry?: string;
  minScore?: number;
  maxScore?: number;
  minShipmentCount?: number;
  sort?: CandidateFeedSort;
}) {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.status && params.status !== "ACTIVE") search.set("status", params.status);
  if (params.profile) search.set("profile", params.profile);
  if (params.industry) search.set("industry", params.industry);
  if (params.minScore !== undefined) search.set("minScore", String(params.minScore));
  if (params.maxScore !== undefined) search.set("maxScore", String(params.maxScore));
  if (params.minShipmentCount !== undefined) search.set("minShipmentCount", String(params.minShipmentCount));
  if (params.sort && params.sort !== "score_desc") search.set("sort", params.sort);
  const query = search.toString();
  return query ? `/lead-gen/candidates?${query}` : "/lead-gen/candidates";
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

function buildExportHref({
  query,
  status,
  searchProfileId,
  industry,
  minScore,
  maxScore,
  minShipmentCount,
  sort
}: {
  query: string;
  status: CandidateStatus | "ACTIVE";
  searchProfileId?: string;
  industry?: string;
  minScore?: number;
  maxScore?: number;
  minShipmentCount?: number;
  sort: CandidateFeedSort;
}) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (status) params.set("status", status);
  if (searchProfileId) params.set("profile", searchProfileId);
  if (industry) params.set("industry", industry);
  if (minScore !== undefined) params.set("minScore", String(minScore));
  if (maxScore !== undefined) params.set("maxScore", String(maxScore));
  if (minShipmentCount !== undefined) params.set("minShipmentCount", String(minShipmentCount));
  if (sort) params.set("sort", sort);
  const search = params.toString();
  return search ? `/api/lead-gen/candidates/export?${search}` : "/api/lead-gen/candidates/export";
}
