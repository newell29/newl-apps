import { CustomerLifecycle } from "@prisma/client";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { requireReadAccess } from "@/modules/customer-intelligence/permissions";
import {
  getIdentityReviewMetrics,
  getUnmatchedCustomerDirectory,
  listCompanyDirectory,
  type CompanyDirectoryEntry
} from "@/modules/customer-intelligence/queries";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Customer Profile directory (CP-PHASE-02B-4): leadership-only (ADMIN /
 * MANAGER / FINANCE) server-rendered matched-company directory plus the
 * unmatched QuickBooks customer view. Every row is assembled from existing
 * tenant-scoped foundation data; unmatched rows show potential contacts only
 * from stored identity-match evidence, and no external system is contacted.
 */
export default async function CustomerIntelligenceDirectoryPage({
  searchParams
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const context = await getAuthenticatedContext();
  await requireReadAccess(context);

  const { view } = await searchParams;
  const showUnmatched = view === "unmatched";

  const [matched, unmatched, metrics] = await Promise.all([
    listCompanyDirectory(context),
    getUnmatchedCustomerDirectory(context),
    getIdentityReviewMetrics(context)
  ]);

  const totalSourceAccounts = matched.reduce(
    (sum, entry) => sum + entry.sourceAccountCount,
    0
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Customer Intelligence"
        title="Company Profiles"
        description="One canonical view per company across operating companies, QuickBooks source accounts, contacts, lifecycle, and match status. Leadership-only; every row comes from tenant-scoped stored data."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Canonical companies" value={matched.length} />
        <Metric label="Pending identity review" value={metrics.proposed} />
        <Metric label="QuickBooks source accounts" value={totalSourceAccounts} />
        <Metric label="Unmatched customers" value={unmatched.length} />
      </div>

      <div className="flex gap-2 border-b border-border">
        <Tab href="/customer-intelligence?view=matched" active={!showUnmatched}>
          Matched companies · {matched.length}
        </Tab>
        <Tab href="/customer-intelligence?view=unmatched" active={showUnmatched}>
          Needs review · {unmatched.length}
        </Tab>
      </div>

      {showUnmatched ? (
        <UnmatchedView entries={unmatched} />
      ) : (
        <MatchedView entries={matched} />
      )}
    </div>
  );
}

function MatchedView({ entries }: { entries: CompanyDirectoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-background px-4 py-8 text-sm text-mutedForeground">
        No matched companies yet. Companies appear here once they have an
        operating-company relationship.
      </p>
    );
  }

  return (
    <section className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <table className="min-w-[900px] divide-y divide-border text-sm">
        <thead className="text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
          <tr>
            {[
              "Company",
              "Lifecycle",
              "Operating companies",
              "QB accounts",
              "Contacts",
              "Opportunities",
              "Last activity"
            ].map((heading) => (
              <th key={heading} className="px-4 py-3">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map((entry) => (
            <tr key={entry.companyId}>
              <td className="px-4 py-3">
                <Link
                  href={`/customer-intelligence/companies/${entry.companyId}`}
                  className="font-semibold text-primary hover:text-primaryHover"
                >
                  {entry.companyName}
                </Link>
                {entry.domain ? (
                  <p className="text-xs text-mutedForeground">{entry.domain}</p>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <LifecycleBadge lifecycle={entry.lifecycle} />
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1.5">
                  {entry.operatingCompanies.map((company) => (
                    <span
                      key={company.id}
                      className="rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-mutedForeground"
                    >
                      {company.displayName}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3 text-mutedForeground">
                {entry.sourceAccountCount > 0 ? (
                  <span>
                    {entry.sourceAccountCount}
                    <span className="ml-1 text-xs">
                      ({entry.activeSourceAccountCount} active)
                    </span>
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3 text-mutedForeground">{entry.contactCount}</td>
              <td className="px-4 py-3 text-mutedForeground">
                {entry.opportunitySignalCount > 0 ? (
                  <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
                    {entry.opportunitySignalCount} signal
                    {entry.opportunitySignalCount === 1 ? "" : "s"}
                  </span>
                ) : entry.leadStage ? (
                  "Pipeline lead"
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3 text-mutedForeground">
                {entry.lastActivityAt ? formatDate(entry.lastActivityAt) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function UnmatchedView({
  entries
}: {
  entries: Array<{
    matchId: string;
    sourceLabel: string | null;
    sourceRecordKey: string | null;
    score: number;
    operatingCompany: { id: string; slug: string; displayName: string } | null;
    candidateCompany: { id: string; name: string; domain: string | null } | null;
    potentialContacts: Array<{ kind: "EMAIL" | "PHONE"; value: string; source: string }>;
  }>;
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-background px-4 py-8 text-sm text-mutedForeground">
        No unmatched QuickBooks customers. Deterministic suggestions never
        approve on name alone, and every unmatched customer stays here for human
        review.
      </p>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">
        Unmatched QuickBooks customers ({entries.length})
      </h2>
      {entries.map((entry) => (
        <article
          key={entry.matchId}
          className="rounded-lg border border-border bg-card p-5 shadow-sm"
        >
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_1.4fr]">
            <div>
              <h3 className="font-semibold text-foreground">
                {entry.sourceLabel ?? entry.sourceRecordKey ?? "Unnamed QuickBooks customer"}
              </h3>
              <p className="mt-1 text-xs text-mutedForeground">
                {entry.operatingCompany?.displayName ?? "Unknown operating company"} · Score{" "}
                {entry.score}
              </p>
            </div>
            <div className="text-sm text-mutedForeground">
              <p>
                <span className="font-medium text-foreground">Suggested company:</span>{" "}
                {entry.candidateCompany ? entry.candidateCompany.name : "None"}
              </p>
              {entry.candidateCompany?.domain ? (
                <p className="mt-1">
                  <span className="font-medium text-foreground">Domain:</span>{" "}
                  {entry.candidateCompany.domain}
                </p>
              ) : null}
            </div>
            <div className="rounded-md bg-muted/60 p-3 text-sm leading-6 text-mutedForeground">
              <span className="font-medium text-foreground">
                Potential contacts from stored evidence
              </span>
              {entry.potentialContacts.length === 0 ? (
                <p className="mt-1 text-xs">
                  No email or phone evidence is stored for this customer.
                </p>
              ) : (
                <ul className="mt-1 space-y-1 text-xs">
                  {entry.potentialContacts.map((contact) => (
                    <li key={`${contact.kind}-${contact.value}`}>
                      <span className="font-medium text-foreground">
                        {contact.kind === "EMAIL" ? "Email" : "Phone"}:
                      </span>{" "}
                      {contact.value}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 border-t border-border pt-2 text-xs">
                Contacts remain suggestions until the company identity is
                approved; they are never derived from external calls.
              </p>
            </div>
          </div>
          <div className="mt-4 border-t border-border pt-3">
            <Link
              href="/customer-intelligence/review"
              className="text-sm font-semibold text-primary hover:text-primaryHover"
            >
              Review in identity queue →
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}

function LifecycleBadge({ lifecycle }: { lifecycle: CustomerLifecycle }) {
  const label = lifecycle
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  const tone =
    lifecycle === CustomerLifecycle.ACTIVE_CUSTOMER
      ? "border-success/30 bg-success/10 text-foreground"
      : lifecycle === CustomerLifecycle.DORMANT_CUSTOMER
        ? "border-amber-500/30 bg-amber-500/10 text-foreground"
        : lifecycle === CustomerLifecycle.FORMER_CUSTOMER
          ? "border-danger/30 bg-danger/10 text-mutedForeground"
          : "border-primary/30 bg-primary/10 text-primary";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}

function formatDate(value: Date): string {
  return value.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function Tab({
  href,
  active,
  children
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-mutedForeground hover:text-foreground"
      }`}
    >
      {children}
    </Link>
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
