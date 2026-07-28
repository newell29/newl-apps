import { ModuleKey } from "@prisma/client";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  confirmApolloNoMatchAction,
  mapApolloCompanyUrlAction,
  reopenApolloMatchReviewAction,
  retryApolloCompanyReviewFromQueueAction
} from "@/modules/lead-gen/actions";
import { ApolloMatchReviewActions } from "@/modules/lead-gen/components/apollo-match-review-actions";
import { getApolloMatchReviewQueue } from "@/modules/lead-gen/queries";
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
  const rows = await getApolloMatchReviewQueue(context, {
    companyId: companyId ?? undefined
  });
  const activeRows = rows.filter((row) => row.status === "NEEDS_REVIEW");
  const confirmedRows = rows.filter((row) => row.status === "CONFIRMED_NO_MATCH");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lead Generation"
        title="Apollo Exceptions"
        description="Resolve current Qwen/Kimi-vetted Hunter opportunities that Apollo could not match safely or that returned zero employees. Historical workflow records stay in the audit trail but do not clutter this active queue."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Needs review" value={activeRows.length} />
        <Metric label="Confirmed no match" value={confirmedRows.length} />
        <Metric label="Protected from bulk retry" value={rows.length} />
      </div>

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
        title="Confirmed no match"
        description="These companies remain visible for audit, but bulk and automatic Apollo searches stay blocked until a rep explicitly reopens them."
        rows={confirmedRows}
      />
    </div>
  );
}

function ReviewSection({
  title,
  description,
  rows
}: {
  title: string;
  description: string;
  rows: Awaited<ReturnType<typeof getApolloMatchReviewQueue>>;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-mutedForeground">{description}</p>
      </div>

      {rows.length === 0 ? (
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

              <ApolloMatchReviewActions
                companyId={row.companyId}
                companyName={row.companyName}
                status={row.status}
                retryAction={retryApolloCompanyReviewFromQueueAction}
                mapAction={mapApolloCompanyUrlAction}
                confirmNoMatchAction={confirmApolloNoMatchAction}
                reopenAction={reopenApolloMatchReviewAction}
              />
            </article>
          ))}
        </div>
      )}
    </section>
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
