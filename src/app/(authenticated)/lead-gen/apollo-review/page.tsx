import { ModuleKey } from "@prisma/client";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  confirmApolloNoMatchAction,
  mapApolloCompanyUrlAction,
  reopenApolloMatchReviewAction,
  retryApolloCompanyReviewFromQueueAction
} from "@/modules/lead-gen/actions";
import { recheckHunterCompanyContactsAction } from "@/modules/lead-gen/hunter-actions";
import { ApolloMatchReviewActions } from "@/modules/lead-gen/components/apollo-match-review-actions";
import {
  getApolloIdentityResolutionMetrics,
  getApolloMatchReviewQueue
} from "@/modules/lead-gen/queries";
import { getApolloExceptionAutopilotStatus } from "@/modules/lead-gen/apollo-exception-autopilot";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ApolloMatchReviewPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  const params = searchParams ? await searchParams : {};
  const companyId = readParam(params.company);
  const contactReviewMessage = readParam(params.contactReview);
  const actionablePlans = Number(readParam(params.plans) ?? "0");
  const [rows, identityMetrics, autopilotStatus] = await Promise.all([
    getApolloMatchReviewQueue(context, {
      companyId: companyId ?? undefined
    }),
    getApolloIdentityResolutionMetrics(context),
    getApolloExceptionAutopilotStatus({ tenantId: context.tenantId })
  ]);
  const activeRows = rows.filter((row) => row.status === "NEEDS_REVIEW");
  const mappedNoEmployeeRows = rows.filter(
    (row) => row.status === "MAPPED_NO_EMPLOYEES"
  );
  const confirmedRows = rows.filter((row) => row.status === "CONFIRMED_NO_MATCH");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lead Generation"
        title="Apollo Exceptions"
        description="Resolve current Hunter/Kimi-vetted opportunities that Apollo could not match safely. Verified companies with no returned employees stay mapped and appear in a separate contact-discovery section."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Needs review" value={activeRows.length} />
        <Metric label="Mapped, no employees" value={mappedNoEmployeeRows.length} />
        <Metric label="Archived exceptions" value={confirmedRows.length} />
        <Metric label="Protected from bulk retry" value={rows.length} />
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Automatic match coverage</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Latest resolver result per company during the last seven days. Older matcher records are excluded.
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-foreground">
              {identityMetrics.autoMatchRate === null ? "—" : `${identityMetrics.autoMatchRate}%`}
            </p>
            <p className="text-xs text-mutedForeground">automatic match rate</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <CompactMetric label="Evaluated" value={identityMetrics.evaluated} />
          <CompactMetric label="Auto matched" value={identityMetrics.autoMatched} />
          <CompactMetric label="Manual review" value={identityMetrics.manualReview} />
          <CompactMetric label="Rejected" value={identityMetrics.rejected} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Exception Autopilot</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
              Hunter researches a changed exception once, verifies the operating identity with Luna,
              and compares a bounded Apollo candidate set. Only a unique official-domain match is
              mapped automatically; ambiguous companies stay below with evidence and suggestions.
            </p>
          </div>
          <span className={autopilotStatus.enabled
            ? "rounded-full bg-success/10 px-3 py-1 text-sm font-semibold text-success"
            : "rounded-full bg-warning/10 px-3 py-1 text-sm font-semibold text-warning"}
          >
            {autopilotStatus.enabled ? "Enabled" : "Off"}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <CompactMetric label="24h processed" value={autopilotStatus.processedLast24Hours} />
          <CompactMetric label="Auto mapped" value={autopilotStatus.autoResolvedLast24Hours} />
          <CompactMetric label="Needs review" value={autopilotStatus.stillAmbiguousLast24Hours} />
          <CompactMetric label="Failed" value={autopilotStatus.failedLast24Hours} />
          <CompactMetric label="Queued" value={autopilotStatus.queued} />
          <CompactMetric label="Daily cap" value={autopilotStatus.dailyCompanyLimit} />
        </div>
      </section>

      {contactReviewMessage ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-foreground">
          <span>{contactReviewMessage}</span>
          {actionablePlans > 0 ? (
            <Link
              href={`/lead-gen/outreach?company=${encodeURIComponent(companyId ?? "")}`}
              className="font-semibold text-primary hover:text-primaryHover"
            >
              Open {actionablePlans} ready plan{actionablePlans === 1 ? "" : "s"}
            </Link>
          ) : (
            <span className="text-xs text-mutedForeground">
              No outreach plan was created, so the company remains here for follow-up.
            </span>
          )}
        </div>
      ) : null}

      {companyId ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 text-sm">
          <span>Showing one company selected from Pipeline.</span>
          <Link href="/lead-gen/apollo-review" className="font-semibold text-primary hover:text-primaryHover">
            Show complete review queue
          </Link>
        </div>
      ) : null}

      <ReviewSection
        title="Needs review"
        description="Open the company in Apollo and paste its Overview or People page URL. You can also retry deliberately after correcting company data or confirm that no usable match exists."
        rows={activeRows}
      />

      <ReviewSection
        title="Mapped company — employee lookup needed"
        description="The Apollo organization is already verified and will not be treated as an unmapped exception. Recheck its saved and organization-scoped employees without spending another organization-match credit."
        rows={mappedNoEmployeeRows}
      />

      <ReviewSection
        title="Archived exceptions"
        description="These companies are hidden from active work but preserved for audit and deduplication. Automatic Apollo searches stay blocked until a rep explicitly reopens them."
        rows={confirmedRows}
        collapsed
      />
    </div>
  );
}

function ReviewSection({
  title,
  description,
  rows,
  collapsed = false
}: {
  title: string;
  description: string;
  rows: Awaited<ReturnType<typeof getApolloMatchReviewQueue>>;
  collapsed?: boolean;
}) {
  if (collapsed) {
    return (
      <details className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <summary className="cursor-pointer">
          <span className="text-lg font-semibold text-foreground">{title}</span>
          <span className="ml-2 text-sm text-mutedForeground">({rows.length})</span>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">{description}</p>
        </summary>
        <div className="mt-4">
          <ReviewRows rows={rows} />
        </div>
      </details>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-mutedForeground">{description}</p>
      </div>

      <ReviewRows rows={rows} />
    </section>
  );
}

function ReviewRows({
  rows
}: {
  rows: Awaited<ReturnType<typeof getApolloMatchReviewQueue>>;
}) {
  return rows.length === 0 ? (
    <p className="rounded-md border border-dashed border-border bg-background px-4 py-6 text-sm text-mutedForeground">
      No companies are currently in this state.
    </p>
  ) : (
    <div className="space-y-4">
      {rows.map((row) => (
        <article key={row.latestMatch.id} className="space-y-4 rounded-lg border border-border bg-card p-4">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_2fr]">
            <div>
              <h3 className="font-semibold text-foreground">{row.companyName}</h3>
              <p className="mt-1 text-xs text-mutedForeground">{row.normalizedName}</p>
              <p className="mt-2 text-sm text-mutedForeground">Assigned rep: {row.assignedRep}</p>
              <p className="mt-1 text-sm text-mutedForeground">{row.hunterQualification}</p>
              <Link
                href="/lead-gen/hunter"
                className="mt-2 inline-block text-sm font-semibold text-primary hover:text-primaryHover"
              >
                View Daily Opportunities
              </Link>
            </div>
            <div className="text-sm text-mutedForeground">
              <p>
                <span className="font-medium text-foreground">Last attempt:</span>{" "}
                {formatDate(row.latestMatch.attemptedAt)}
              </p>
              <p className="mt-1">
                <span className="font-medium text-foreground">Result:</span>{" "}
                {formatClassification(row.latestMatch.classification)}
              </p>
              <p className="mt-1">
                <span className="font-medium text-foreground">Score:</span> {row.latestMatch.score}
              </p>
              {row.latestMatch.companyName ? (
                <p className="mt-1">
                  <span className="font-medium text-foreground">Apollo candidate:</span>{" "}
                  {row.latestMatch.companyName}
                </p>
              ) : null}
            </div>
            <div className="rounded-md bg-muted/60 p-3 text-sm leading-6 text-mutedForeground">
              <span className="font-medium text-foreground">Why review is required:</span>{" "}
              {row.latestMatch.reason ?? "Apollo did not return a safe direct-company match."}
            </div>
          </div>

          {row.resolverReview.reason || row.resolverReview.candidates.length > 0 ? (
            <div className="rounded-md border border-border bg-background p-3">
              <p className="text-sm font-semibold text-foreground">Autopilot research</p>
              {row.resolverReview.reason ? (
                <p className="mt-1 text-sm leading-6 text-mutedForeground">
                  {row.resolverReview.reason}
                </p>
              ) : null}
              {row.resolverReview.candidates.length > 0 ? (
                <div className="mt-3 grid gap-2 lg:grid-cols-3">
                  {row.resolverReview.candidates.map((candidate) => (
                    <a
                      key={candidate.organizationId}
                      href={`https://app.apollo.io/#/organizations/${candidate.organizationId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-border px-3 py-2 text-sm hover:border-primary"
                    >
                      <span className="font-medium text-foreground">{candidate.companyName}</span>
                      <span className="mt-1 block text-xs text-mutedForeground">
                        {candidate.domain ?? "No domain"} · score {candidate.score}
                        {candidate.domainMatch ? " · domain verified" : ""}
                      </span>
                    </a>
                  ))}
                </div>
              ) : null}
              {row.resolverReview.sources.length > 0 ? (
                <details className="mt-3 text-sm text-mutedForeground">
                  <summary className="cursor-pointer font-medium text-foreground">
                    Public identity evidence ({row.resolverReview.sources.length})
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {row.resolverReview.sources.map((source) => (
                      <li key={source.url}>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:text-primaryHover"
                        >
                          {source.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}

          <ApolloMatchReviewActions
            companyId={row.companyId}
            companyName={row.companyName}
            confirmedApolloAccountUrl={row.confirmedApolloAccountUrl}
            resolvedApolloOrganizationUrl={row.resolvedApolloOrganizationUrl}
            status={row.status}
            retryAction={retryApolloCompanyReviewFromQueueAction}
            mapAction={mapApolloCompanyUrlAction}
            confirmNoMatchAction={confirmApolloNoMatchAction}
            reopenAction={reopenApolloMatchReviewAction}
            mappedCompanyRecheckAction={recheckHunterCompanyContactsAction}
          />
        </article>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-sm text-mutedForeground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <p className="text-xs text-mutedForeground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto"
  }).format(value);
}

function formatClassification(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}
