import { CandidateStatus } from "@prisma/client";
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
  const status = parseStatusParam(readParam(params.status));
  const sort = parseSortParam(readParam(params.sort));
  const searchProfileId = readParam(params.profile);
  const [candidates, filterOptions] = await Promise.all([
    getCandidateFeed(tenant, {
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
        title="Candidate Feed"
        description="Ranked TradeMining companies for review before sales pipeline approval."
      />

      <div className="rounded-lg border border-accentBorder bg-accentSoft px-4 py-3 text-sm text-foreground">
        New TradeMining companies stay here first. OpenClaw/n8n ingestion can keep adding evidence, and Newl reviews the
        ranked candidates before approving a company into the sales pipeline.
      </div>

      <form className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm md:grid-cols-3" action="/lead-gen/candidates">
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
          <div className="flex gap-2">
            <select
              name="sort"
              defaultValue={sort}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Apply
            </button>
          </div>
        </label>
      </form>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-accentSoft px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Ranked candidate review</p>
            <p className="text-xs text-mutedForeground">
              Deterministic scoring from shipment evidence, profile priority, recency, and review state.
            </p>
          </div>
          <span className="rounded-full border border-accentBorder bg-card px-2.5 py-1 text-xs font-semibold text-primary">
            {candidates.length.toLocaleString("en-US")} companies
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1180px] divide-y divide-border text-sm">
            <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
              <tr>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Shipments</th>
                <th className="px-4 py-3">Matched profile</th>
                <th className="px-4 py-3">Lane</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Assigned rep</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {candidates.map((candidate) => (
                <tr key={candidate.id} className="align-top transition-colors hover:bg-muted/60">
                  <td className="max-w-[260px] px-4 py-4">
                    <p className="font-semibold text-foreground">{candidate.companyName}</p>
                    <p className="mt-1 text-xs text-mutedForeground">{candidate.normalizedName}</p>
                    <p className="mt-1 text-xs text-mutedForeground">{candidate.domain ?? candidate.source ?? "TradeMining"}</p>
                    {candidate.currentPipelineStage ? (
                      <div className="mt-2">
                        <StageBadge stage={candidate.currentPipelineStage} />
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-4">
                    <span className="text-2xl font-bold text-primary">{candidate.candidateScore}</span>
                    <p className="mt-2 max-w-[260px] text-xs leading-5 text-mutedForeground">{candidate.scoreReasoning}</p>
                    {candidate.importedScoreReasoning ? (
                      <p className="mt-2 max-w-[260px] rounded-md border border-border bg-background px-2 py-1 text-xs text-mutedForeground">
                        Ingested note: {candidate.importedScoreReasoning}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-4">
                    <CandidateStatusBadge status={candidate.candidateStatus} />
                    {candidate.candidateStatusReason ? (
                      <p className="mt-2 max-w-[180px] text-xs text-mutedForeground">{candidate.candidateStatusReason}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-4 text-mutedForeground">
                    <p className="font-semibold text-foreground">{candidate.shipmentCount}</p>
                    <p className="text-xs">{formatDate(candidate.latestShipmentDate)}</p>
                  </td>
                  <td className="max-w-[180px] px-4 py-4 text-mutedForeground">
                    <p className="font-medium text-foreground">{candidate.matchedSearchProfileName}</p>
                    <p className="text-xs">{candidate.matchedSearchProfileId ?? "No profile id"}</p>
                  </td>
                  <td className="max-w-[220px] px-4 py-4 text-mutedForeground">
                    <p>
                      <span className="font-medium text-foreground">Destination:</span>{" "}
                      {candidate.destinationMarket ?? candidate.destinationPort ?? "Unknown"}
                    </p>
                    <p className="mt-1">
                      <span className="font-medium text-foreground">Origin:</span>{" "}
                      {[candidate.originCountry, candidate.originPort, candidate.shipFromPort].filter(Boolean).join(" / ") ||
                        "Unknown"}
                    </p>
                  </td>
                  <td className="max-w-[220px] px-4 py-4 text-mutedForeground">
                    <p>{candidate.productDescription ?? "Unknown product"}</p>
                    <p className="mt-1 text-xs">HS: {candidate.hsCode ?? "Unknown"}</p>
                  </td>
                  <td className="px-4 py-4 text-mutedForeground">{candidate.assignedRep}</td>
                  <td className="px-4 py-4 text-mutedForeground">
                    <p>{formatDate(candidate.updatedAt)}</p>
                    <p className="mt-1 text-xs">Created {formatDate(candidate.createdAt)}</p>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex min-w-[180px] flex-wrap gap-2">
                      <CandidateActionButton companyId={candidate.id} status={CandidateStatus.REVIEWING} label="Reviewing" />
                      <CandidateActionButton
                        companyId={candidate.id}
                        status={CandidateStatus.APPROVED_FOR_PIPELINE}
                        label="Approve"
                        primary
                      />
                      <CandidateActionButton companyId={candidate.id} status={CandidateStatus.REJECTED} label="Reject" />
                      <CandidateActionButton
                        companyId={candidate.id}
                        status={CandidateStatus.DISQUALIFIED}
                        label="Disqualify"
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {candidates.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-mutedForeground">
            No candidates match the current filters.
          </div>
        ) : null}
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
